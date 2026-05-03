import pino, { type Logger } from 'pino';
import { createWriteStream } from 'node:fs';

const level = process.env.LOG_LEVEL ?? 'info';
const dest = process.env.LOG_DEST ?? 'stderr';

const stream =
  dest === 'stderr' || dest === ''
    ? pino.destination(2)
    : createWriteStream(dest, { flags: 'a' });

export const logger: Logger = pino({ level }, stream);
