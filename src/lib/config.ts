import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

export const EXCHANGE_NAME = 'claudeBroker';
export const DEFAULT_AMQP_URL = 'amqp://localhost:5672';
export const DEFAULT_MGMT_URL = 'http://localhost:15672';
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_QUEUE_LEN = 1000;

export const CBROKER_HOME = join(homedir(), '.cbroker');
export const JOURNAL_DIR = join(CBROKER_HOME, 'journal');
export const DLQ_DIR = join(CBROKER_HOME, 'dlq');
export const LOG_DIR = join(CBROKER_HOME, 'logs');

export function ensureDirs(): void {
  for (const d of [CBROKER_HOME, JOURNAL_DIR, DLQ_DIR, LOG_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function getAmqpUrl(): string {
  return process.env.CBROKER_URL || DEFAULT_AMQP_URL;
}

export function getMgmtUrl(): string {
  return process.env.CBROKER_MGMT_URL || DEFAULT_MGMT_URL;
}

export function getMgmtAuth(): { user: string; pass: string } {
  return {
    user: process.env.CBROKER_MGMT_USER || 'guest',
    pass: process.env.CBROKER_MGMT_PASS || 'guest',
  };
}
