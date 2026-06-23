import { ulid } from 'ulid';

export type Priority = 'low' | 'normal' | 'high';

export interface CbrokerMessage {
  id: string;
  from: string;
  to: string;
  ts: string;
  message: string;
  files?: string[];
  reply_to?: string;
  correlation_id?: string;
  priority?: Priority;
  metadata?: Record<string, unknown>;
}

export interface BuildMessageInput {
  from: string;
  to: string;
  message: string;
  files?: string[];
  reply_to?: string;
  correlation_id?: string;
  priority?: Priority;
  metadata?: Record<string, unknown>;
}

export function buildMessage(input: BuildMessageInput): CbrokerMessage {
  if (!input.from) throw new Error('from is required');
  if (!input.to) throw new Error('to is required');
  if (!input.message || typeof input.message !== 'string') {
    throw new Error('message is required and must be a string');
  }
  return {
    id: ulid(),
    from: input.from,
    to: input.to,
    ts: new Date().toISOString(),
    message: input.message,
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
    ...(input.reply_to ? { reply_to: input.reply_to } : {}),
    ...(input.correlation_id ? { correlation_id: input.correlation_id } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function validateMessage(raw: unknown): CbrokerMessage {
  if (!raw || typeof raw !== 'object') {
    throw new Error('message is not an object');
  }
  const m = raw as Record<string, unknown>;
  const required = ['id', 'from', 'to', 'ts', 'message'] as const;
  for (const key of required) {
    if (typeof m[key] !== 'string' || !m[key]) {
      throw new Error(`missing or invalid required field: ${key}`);
    }
  }
  if (m.files !== undefined) {
    if (!Array.isArray(m.files) || !m.files.every((f) => typeof f === 'string')) {
      throw new Error('files must be an array of strings');
    }
  }
  return m as unknown as CbrokerMessage;
}

export function formatForClaude(msg: CbrokerMessage): string {
  const lines: string[] = [];
  lines.push(`<cbroker-message from="${msg.from}" id="${msg.id}" ts="${msg.ts}">`);
  lines.push(`The sender asks: ${JSON.stringify(msg.message)}`);
  if (msg.files && msg.files.length > 0) {
    lines.push('');
    lines.push('Attached files (read if relevant):');
    for (const f of msg.files) lines.push(`  - ${f}`);
  }
  if (msg.metadata && Object.keys(msg.metadata).length > 0) {
    lines.push('');
    lines.push(`Metadata: ${JSON.stringify(msg.metadata)}`);
  }
  if (msg.correlation_id) {
    lines.push(`correlation_id: ${msg.correlation_id}`);
  }
  if (msg.reply_to) {
    lines.push(
      `reply_to: ${msg.reply_to}  (use cbroker_send with to="${msg.reply_to}" to reply)`,
    );
  }
  lines.push('</cbroker-message>');
  return lines.join('\n');
}
