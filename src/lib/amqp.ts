import amqplib, { type ChannelModel, type Channel, type GetMessage } from 'amqplib';
import {
  EXCHANGE_NAME,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_QUEUE_LEN,
  getAmqpUrl,
} from './config.js';
import { buildMessage, type BuildMessageInput, type CbrokerMessage } from './message.js';

const CONNECT_TIMEOUT_MS = 2000;

export interface ConnectOptions {
  url?: string;
  timeoutMs?: number;
}

export async function connect(opts: ConnectOptions = {}): Promise<ChannelModel> {
  const url = opts.url ?? getAmqpUrl();
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
  return await Promise.race([
    amqplib.connect(url, { timeout: timeoutMs }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AMQP connect timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

export async function isReachable(url?: string): Promise<boolean> {
  try {
    const conn = await connect({ url, timeoutMs: 1500 });
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

export async function declareTopology(
  channel: Channel,
  queueName: string,
  opts: { ttlMs?: number; maxLength?: number } = {},
): Promise<void> {
  await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
  await channel.assertQueue(queueName, {
    durable: true,
    autoDelete: false,
    arguments: {
      'x-message-ttl': opts.ttlMs ?? DEFAULT_TTL_MS,
      'x-max-length': opts.maxLength ?? DEFAULT_MAX_QUEUE_LEN,
      'x-overflow': 'drop-head',
    },
  });
  await channel.bindQueue(queueName, EXCHANGE_NAME, queueName);
}

export async function publish(
  channel: Channel,
  msg: CbrokerMessage,
): Promise<void> {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const ok = channel.publish(EXCHANGE_NAME, msg.to, body, {
    contentType: 'application/json',
    persistent: true,
    deliveryMode: 2,
    messageId: msg.id,
    timestamp: Math.floor(new Date(msg.ts).getTime() / 1000),
    correlationId: msg.correlation_id,
    replyTo: msg.reply_to,
    priority: msg.priority === 'high' ? 9 : msg.priority === 'low' ? 1 : 5,
  });
  if (!ok) {
    await new Promise<void>((resolve) => channel.once('drain', resolve));
  }
}

export async function publishOne(
  input: BuildMessageInput,
  url?: string,
): Promise<CbrokerMessage> {
  const msg = buildMessage(input);
  const conn = await connect({ url });
  try {
    const ch = await conn.createChannel();
    await declareTopology(ch, msg.to);
    await publish(ch, msg);
    await ch.close();
    return msg;
  } finally {
    await conn.close();
  }
}

export interface DrainResult {
  messages: CbrokerMessage[];
  malformed: { raw: string; error: string }[];
}

export async function drainQueue(
  queueName: string,
  maxMessages = 10,
  url?: string,
): Promise<DrainResult> {
  const out: DrainResult = { messages: [], malformed: [] };
  const conn = await connect({ url });
  try {
    const ch = await conn.createChannel();
    await declareTopology(ch, queueName);

    for (let i = 0; i < maxMessages; i++) {
      const msg = (await ch.get(queueName, { noAck: false })) as GetMessage | false;
      if (!msg) break;

      const text = msg.content.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        const required = ['id', 'from', 'to', 'ts', 'message'];
        for (const key of required) {
          if (typeof parsed[key] !== 'string' || !parsed[key]) {
            throw new Error(`missing required field: ${key}`);
          }
        }
        out.messages.push(parsed as CbrokerMessage);
        ch.ack(msg);
      } catch (err) {
        out.malformed.push({
          raw: text,
          error: (err as Error).message,
        });
        ch.ack(msg);
      }
    }
    await ch.close();
  } finally {
    await conn.close();
  }
  return out;
}

export async function getQueueDepth(queueName: string, url?: string): Promise<number> {
  const conn = await connect({ url });
  try {
    const ch = await conn.createChannel();
    const info = await ch.checkQueue(queueName);
    await ch.close();
    return info.messageCount;
  } finally {
    await conn.close();
  }
}
