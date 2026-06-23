import { join } from 'node:path';
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JOURNAL_DIR, DLQ_DIR, ensureDirs } from './config.js';
import type { CbrokerMessage } from './message.js';

function journalPath(name: string): string {
  return join(JOURNAL_DIR, `${name}.jsonl`);
}

function dlqPath(name: string): string {
  return join(DLQ_DIR, `${name}.jsonl`);
}

export function appendJournal(name: string, msg: CbrokerMessage): void {
  ensureDirs();
  appendFileSync(journalPath(name), JSON.stringify(msg) + '\n', 'utf8');
}

export function appendDlq(name: string, raw: string, err: string): void {
  ensureDirs();
  appendFileSync(
    dlqPath(name),
    JSON.stringify({ ts: new Date().toISOString(), error: err, raw }) + '\n',
    'utf8',
  );
}

export function readJournal(name: string): CbrokerMessage[] {
  const p = journalPath(name);
  if (!existsSync(p)) return [];
  const txt = readFileSync(p, 'utf8');
  if (!txt) return [];
  return txt
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as CbrokerMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is CbrokerMessage => m !== null);
}

export function clearJournal(name: string): void {
  const p = journalPath(name);
  if (existsSync(p)) writeFileSync(p, '', 'utf8');
}
