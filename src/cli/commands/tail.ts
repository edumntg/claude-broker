import type { Command } from 'commander';
import { normalizeName } from '../../lib/name.js';
import { connect, declareTopology } from '../../lib/amqp.js';

export function registerTail(program: Command): void {
  program
    .command('tail <name>')
    .description('Watch messages on a queue (consumes! use with care)')
    .option('--no-ack', 'Do not ack messages (peek mode, requeues on exit)')
    .action(async (name: string, opts) => {
      const queue = normalizeName(name);
      const conn = await connect();
      const ch = await conn.createChannel();
      await declareTopology(ch, queue);

      console.log(`cbroker: tailing '${queue}' (Ctrl+C to stop)\n`);

      const ackMode = opts.ack !== false;
      const handler = await ch.consume(
        queue,
        (msg) => {
          if (!msg) return;
          const text = msg.content.toString('utf8');
          console.log(text);
          console.log('---');
          if (ackMode) ch.ack(msg);
        },
        { noAck: false },
      );

      const cleanup = async () => {
        try {
          if (!ackMode) await ch.cancel(handler.consumerTag);
          await ch.close();
          await conn.close();
        } catch {
          // ignore
        }
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
}
