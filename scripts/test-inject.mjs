#!/usr/bin/env node
// End-to-end PTY-injection smoke test (no `claude` needed).
// Spawns `sh -c "while read line; do echo GOT: \$line; done"` inside a PTY,
// declares an AMQP queue, publishes a message, runs the same consumer the
// wrap command uses, and verifies the wrapped shell echoes the injected text.

import pty from 'node-pty';
import { publishOne } from '../dist/lib/amqp.js';
import { connect, declareTopology } from '../dist/lib/amqp.js';
import { validateMessage } from '../dist/lib/message.js';

const QUEUE = 'testInjectE2E';
const TIMEOUT_MS = 8000;
const INJECT_DELAY_MS = 25;

function fmt(msg) {
  const compact = msg.message.replace(/\r?\n/g, ' ').trim();
  return `[cbroker peer message from=${msg.from} id=${msg.id}] ${compact}`;
}

async function main() {
  // 1. Publish a test message to a clean queue
  const conn0 = await connect();
  const ch0 = await conn0.createChannel();
  try {
    await ch0.deleteQueue(QUEUE);
  } catch {}
  await declareTopology(ch0, QUEUE);
  await ch0.purgeQueue(QUEUE);
  await ch0.close();
  await conn0.close();

  const expected = await publishOne({
    from: 'tester',
    to: QUEUE,
    message: 'PTY injection works',
  });
  const expectedLine = fmt(expected);
  console.log(`[test] published: ${expectedLine}`);

  // 2. PTY-spawn a child that echoes anything it reads
  const child = pty.spawn(
    'sh',
    ['-c', 'while IFS= read -r line; do echo "GOT: $line"; done'],
    { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env },
  );

  let buf = '';
  const seen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for echo')), TIMEOUT_MS);
    child.onData((d) => {
      buf += d;
      if (buf.includes(`GOT: ${expectedLine}`)) {
        clearTimeout(timer);
        resolve(buf);
      }
    });
  });

  // 3. Start an AMQP consumer (same logic as wrap.ts)
  const conn = await connect();
  const ch = await conn.createChannel();
  await declareTopology(ch, QUEUE);
  await ch.prefetch(1);
  const { consumerTag } = await ch.consume(
    QUEUE,
    (raw) => {
      if (!raw) return;
      try {
        const msg = validateMessage(JSON.parse(raw.content.toString('utf8')));
        const body = fmt(msg);
        child.write(body);
        setTimeout(() => child.write('\r'), INJECT_DELAY_MS);
        ch.ack(raw);
      } catch (err) {
        ch.ack(raw);
        console.error(`[test] malformed: ${err.message}`);
      }
    },
    { noAck: false },
  );

  // 4. Wait for the echo
  try {
    await seen;
    console.log('[test] OK — injected text was echoed by the wrapped shell.');
  } catch (err) {
    console.error(`[test] FAIL: ${err.message}`);
    console.error(`[test] received so far:\n${buf}`);
    process.exitCode = 1;
  }

  // 5. Cleanup
  try {
    await ch.cancel(consumerTag);
    await ch.close();
    await conn.close();
  } catch {}
  child.kill();

  const c2 = await connect();
  const ch2 = await c2.createChannel();
  try {
    await ch2.deleteQueue(QUEUE);
  } catch {}
  await ch2.close();
  await c2.close();
}

main().catch((err) => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
