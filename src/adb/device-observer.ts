import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../log/logger.js';
import { recordDeviceEvent } from '../db/writer.js';
import { getTraceId } from '../log/trace-context.js';

const log = logger.child({ component: 'device-observer' });

export interface DeviceSnapshot {
  serial: string;
  state: string;
}

export interface DeviceTransition {
  serial: string;
  /** State the device left. null = first time we've seen this serial. */
  prev_state: string | null;
  /** State the device entered. null = device disappeared from the list. */
  new_state: string | null;
  ts: Date;
}

/**
 * Parse one length-prefixed `adb track-devices` payload into snapshots.
 *
 * Wire format per device row: `<serial>\t<state>` joined by `\n`.
 * An empty payload means no devices are attached — returns [].
 *
 * Pure function — exported for unit testing.
 */
export function parseTrackDevicesPayload(payload: string): DeviceSnapshot[] {
  if (!payload) return [];
  const out: DeviceSnapshot[] = [];
  for (const line of payload.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf('\t');
    if (tab < 0) continue;
    out.push({ serial: trimmed.slice(0, tab), state: trimmed.slice(tab + 1) });
  }
  return out;
}

/**
 * Diff two snapshots into a list of transitions. A device that changed state
 * is reported once with prev_state and new_state filled. A device that
 * appeared has prev_state=null. A device that disappeared has new_state=null.
 *
 * Pure function — exported for unit testing.
 */
export function diffSnapshots(
  prev: DeviceSnapshot[],
  next: DeviceSnapshot[],
  ts: Date
): DeviceTransition[] {
  const prevMap = new Map(prev.map((d) => [d.serial, d.state]));
  const nextMap = new Map(next.map((d) => [d.serial, d.state]));
  const transitions: DeviceTransition[] = [];

  for (const [serial, newState] of nextMap) {
    const prevState = prevMap.get(serial);
    if (prevState === undefined) {
      transitions.push({ serial, prev_state: null, new_state: newState, ts });
    } else if (prevState !== newState) {
      transitions.push({ serial, prev_state: prevState, new_state: newState, ts });
    }
  }
  for (const [serial, prevState] of prevMap) {
    if (!nextMap.has(serial)) {
      transitions.push({ serial, prev_state: prevState, new_state: null, ts });
    }
  }
  return transitions;
}

/**
 * Stateful framer for the `adb track-devices` byte stream. Each frame is
 * `<4-hex-length><payload>` where payload is exactly `length` bytes. We buffer
 * incoming chunks until at least one complete frame is available, yield it,
 * and keep the remainder.
 *
 * Exported for unit testing.
 */
export class FrameDecoder {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames: string[] = [];
    for (;;) {
      if (this.buf.length < 4) break;
      const lenStr = this.buf.subarray(0, 4).toString('ascii');
      const len = parseInt(lenStr, 16);
      if (Number.isNaN(len)) {
        // Stream is corrupt; drop everything we have and resync on next chunk.
        // adb shouldn't send non-hex prefixes; if it does we'd rather lose
        // data than spin in a parse loop.
        this.buf = Buffer.alloc(0);
        return frames;
      }
      if (this.buf.length < 4 + len) break;
      frames.push(this.buf.subarray(4, 4 + len).toString('utf8'));
      this.buf = this.buf.subarray(4 + len);
    }
    return frames;
  }
}

const DEFAULT_RING_CAPACITY = 64;
const RESTART_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Long-lived subscriber to `adb track-devices`. Each device-list change is
 * diffed into transitions, recorded to `device_events`, and kept in an
 * in-memory ring so callers (e.g. the "no device connected" error handler)
 * can show last-seen state without a DB round-trip.
 *
 * Subprocess death is handled with exponential backoff; the observer stays
 * resilient to `adb kill-server` and similar host-side accidents.
 */
export class DeviceObserver {
  private proc: ChildProcess | null = null;
  private decoder = new FrameDecoder();
  private prev: DeviceSnapshot[] = [];
  private ring: DeviceTransition[] = [];
  private subscribers: Array<(t: DeviceTransition) => void> = [];
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private backoffMs = RESTART_BACKOFF_MS;

  constructor(
    private readonly adbPath: string = 'adb',
    private readonly ringCapacity: number = DEFAULT_RING_CAPACITY
  ) {}

  start(): void {
    if (this.proc || this.stopping) return;
    this.spawn();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 1000);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Subscribe to live transitions. Returns an unsubscribe function. */
  onTransition(fn: (t: DeviceTransition) => void): () => void {
    this.subscribers.push(fn);
    return () => {
      const i = this.subscribers.indexOf(fn);
      if (i >= 0) this.subscribers.splice(i, 1);
    };
  }

  /** Most recent N transitions, newest first. */
  getRecent(limit = 32): DeviceTransition[] {
    return this.ring.slice(-limit).reverse();
  }

  /**
   * Last transition for a specific serial, or null if we've never seen it.
   * Used by ensureDevice's enriched error to answer "where did the device go?"
   */
  getLastSeen(serial: string): DeviceTransition | null {
    for (let i = this.ring.length - 1; i >= 0; i--) {
      if (this.ring[i].serial === serial) return this.ring[i];
    }
    return null;
  }

  /** Last detach (new_state=null) for any serial — useful when no device is currently attached. */
  getMostRecentDetach(): DeviceTransition | null {
    for (let i = this.ring.length - 1; i >= 0; i--) {
      if (this.ring[i].new_state === null) return this.ring[i];
    }
    return null;
  }

  private spawn(): void {
    // Guard against two races:
    //   1. `stop()` flips `stopping=true` and clearTimeout's the restart timer,
    //      but a timer that has already fired sits queued in the event loop and
    //      its callback would still call us.
    //   2. `start()` is called while a restart is pending (proc is null because
    //      the subprocess died); the pending timer would then race a second spawn.
    // Re-checking here closes both.
    if (this.stopping || this.proc) return;
    log.info({ adb: this.adbPath }, 'starting device observer');
    const proc = spawn(this.adbPath, ['track-devices'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.stdout.on('data', (chunk: Buffer) => this.handleChunk(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) log.warn({ stderr: text }, 'adb track-devices stderr');
    });
    proc.on('error', (err) => log.warn({ err }, 'adb track-devices spawn error'));
    proc.on('exit', (code, signal) => {
      this.proc = null;
      this.decoder = new FrameDecoder();
      if (this.stopping) return;
      log.warn({ code, signal }, 'adb track-devices exited; scheduling restart');
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.spawn();
      }, this.backoffMs);
    });

    // Reset backoff once we've successfully read the first frame (in handleChunk).
  }

  private handleChunk(chunk: Buffer): void {
    const frames = this.decoder.push(chunk);
    if (frames.length === 0) return;
    this.backoffMs = RESTART_BACKOFF_MS;

    for (const frame of frames) {
      const next = parseTrackDevicesPayload(frame);
      const ts = new Date();
      const transitions = diffSnapshots(this.prev, next, ts);
      this.prev = next;
      for (const t of transitions) this.emit(t);
    }
  }

  private emit(t: DeviceTransition): void {
    this.ring.push(t);
    if (this.ring.length > this.ringCapacity) this.ring.shift();

    log.info(
      { serial: t.serial, prev_state: t.prev_state, new_state: t.new_state },
      'device transition'
    );

    const traceId = getTraceId();
    void recordDeviceEvent({
      trace_id: traceId ?? null,
      layer: 'adb',
      serial: t.serial,
      state: t.new_state,
      raw: { prev_state: t.prev_state, new_state: t.new_state },
      occurred_at: t.ts,
    });

    for (const sub of this.subscribers) {
      try {
        sub(t);
      } catch (err) {
        log.warn({ err }, 'device transition subscriber threw');
      }
    }
  }
}
