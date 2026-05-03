/**
 * Cross-layer error attribution (Phase 4 of #51).
 *
 * When a tool call fails, look at recent device transitions and try to
 * explain *why* it failed in terms an agent can act on. The middleware
 * attaches the result to `tool_calls.error.attribution` and to the
 * structured error payload returned to the caller, so an agent reading
 * the error gets "this failed because device R5CR12ATMCB left 'device'
 * state 800ms ago" without needing a separate `device_event_log` call.
 *
 * Pure function — exported for unit testing.
 */

export type Classification =
  | 'physical_disconnect'   // device → (gone), prior state was 'device'
  | 'rsa_revoked'           // → 'unauthorized', or unauthorized → (gone)
  | 'adb_server_confusion'  // → 'offline', or offline → (gone)
  | 'unknown_disconnect';   // failure inside window but transition shape doesn't match

export interface RelatedEvent {
  serial: string;
  prev_state: string | null;
  new_state: string | null;
  ts: Date;
}

export interface Attribution {
  classification: Classification;
  hint: string;
  related_event?: RelatedEvent;
}

/**
 * Time window we'll consider a device event "related" to a tool call.
 * 5s before the call started — catches the case where the device left
 * just before the agent's retry kicked in. 1s after the call's
 * completion — catches transitions caused by the call itself (e.g.
 * wifi_disconnect followed by adb dropping the device).
 */
const PRE_WINDOW_MS = 5000;
const POST_WINDOW_MS = 1000;

/**
 * How many recent events the middleware should pull from the observer
 * ring before passing them to the classifier. Co-located with the time
 * window so high-churn scenarios (e.g. an emulator flapping at ~100ms
 * cadence) don't silently fall outside the count. 64 matches the
 * default ring capacity in DeviceObserver — exhaustive by construction.
 */
export const RECENT_EVENTS_LIMIT = 64;

interface CallWindow {
  started_at: Date;
  completed_at: Date;
}

/**
 * Returns Attribution when a device transition happened near the failed
 * call — i.e. when the failure is likely device-related. Returns null
 * when nothing relevant was observed; callers should not attach an
 * attribution field in that case so DB rows stay clean for tool-internal
 * errors (bad args, timeouts, etc.).
 */
export function attributeFailure(
  call: CallWindow,
  events: readonly RelatedEvent[]
): Attribution | null {
  if (events.length === 0) return null;

  const startMs = call.started_at.getTime() - PRE_WINDOW_MS;
  const endMs = call.completed_at.getTime() + POST_WINDOW_MS;

  // Events are newest-first as returned by DeviceObserver.getRecent.
  const related = events.find((e) => {
    const t = e.ts.getTime();
    return t >= startMs && t <= endMs;
  });

  if (!related) return null;
  // Only transitions that make the device LESS usable count. A device
  // appearing or coming online is correlation noise — Phase 4 is about
  // explaining failures, not co-occurrences.
  if (!isUsabilityLoss(related)) return null;
  return classify(related);
}

function isUsabilityLoss(e: RelatedEvent): boolean {
  if (e.new_state === null) return true;
  if (e.new_state === 'unauthorized' || e.new_state === 'offline') return true;
  return false;
}

function classify(e: RelatedEvent): Attribution {
  // Device went away.
  if (e.new_state === null) {
    if (e.prev_state === 'device') {
      return {
        classification: 'physical_disconnect',
        related_event: e,
        hint:
          `Device ${e.serial} left 'device' state at ${e.ts.toISOString()} — likely physical ` +
          `disconnect, USB autosuspend, or device sleep. Try replug, wake the device, or ` +
          `disable USB autosuspend on the host.`,
      };
    }
    if (e.prev_state === 'unauthorized') {
      return {
        classification: 'rsa_revoked',
        related_event: e,
        hint:
          `Device ${e.serial} disappeared from 'unauthorized' state at ${e.ts.toISOString()} — ` +
          `the RSA fingerprint prompt was likely rejected or timed out. Replug and accept ` +
          `the prompt on the device.`,
      };
    }
    if (e.prev_state === 'offline') {
      return {
        classification: 'adb_server_confusion',
        related_event: e,
        hint:
          `Device ${e.serial} disappeared from 'offline' state at ${e.ts.toISOString()} — ` +
          `adb-server may be confused or an emulator process may have died. Try ` +
          `'adb kill-server && adb start-server', or restart the emulator.`,
      };
    }
    return {
      classification: 'unknown_disconnect',
      related_event: e,
      hint:
        `Device ${e.serial} disappeared from '${e.prev_state ?? 'unknown'}' state at ` +
        `${e.ts.toISOString()}. Cause not classifiable from the prior state alone.`,
    };
  }

  // Device transitioned to a non-usable state.
  if (e.new_state === 'unauthorized') {
    return {
      classification: 'rsa_revoked',
      related_event: e,
      hint:
        `Device ${e.serial} entered 'unauthorized' state at ${e.ts.toISOString()} — ` +
        `the RSA fingerprint needs to be re-accepted on the device.`,
    };
  }
  if (e.new_state === 'offline') {
    return {
      classification: 'adb_server_confusion',
      related_event: e,
      hint:
        `Device ${e.serial} entered 'offline' state at ${e.ts.toISOString()} — ` +
        `adb-server is stale or the device is unreachable. Try 'adb kill-server'.`,
    };
  }

  // Transition into a known-good state during a failed call. Surprising
  // but report it; the agent at least sees the timing correlation.
  return {
    classification: 'unknown_disconnect',
    related_event: e,
    hint:
      `Device ${e.serial} transitioned ${e.prev_state ?? 'unknown'} → ${e.new_state} ` +
      `during the failed call. Tool-level error may be unrelated.`,
  };
}
