import pg from 'pg';
import { logger } from '../log/logger.js';

const log = logger.child({ component: 'db' });

let pool: pg.Pool | null = null;
let initialized = false;

export function getPool(): pg.Pool | null {
  if (initialized) return pool;
  initialized = true;

  const url = process.env.DATABASE_URL;
  if (!url) {
    log.warn('DATABASE_URL unset — structured logging disabled (Phase 0b is opt-in)');
    return null;
  }

  pool = new pg.Pool({ connectionString: url });
  pool.on('error', (err) => {
    log.error({ err }, 'pg pool error');
  });
  log.info({ url: url.replace(/:[^:@]*@/, ':***@') }, 'pg pool initialized');
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end().catch((err) => log.warn({ err }, 'pg pool close failed'));
  pool = null;
  initialized = false;
}
