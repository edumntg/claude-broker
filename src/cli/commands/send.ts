import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeName } from '../../lib/name.js';
import { publishOne } from '../../lib/amqp.js';
import { getAmqpUrl } from '../../lib/config.js';

export function registerSend(program: Command): void {
  program
    .command('send')
    .description('Publish a message to a session\'s queue')
    .requiredOption('--to <name>', 'Recipient session name')
    .option('--from <name>', 'Sender name (default: $CBROKER_NAME or "cli")', process.env.CBROKER_NAME || 'cli')
    .option('-m, --message <text>', 'Message text')
    .option('--message-file <path>', 'Read message text from file')
    .option('-f, --file <path>', 'Attach a file path (repeatable)', collect, [])
    .option('--reply-to <name>', 'Where the recipient should reply')
    .option('--correlation-id <id>', 'Correlation ID for request/response')
    .option('--priority <p>', 'low | normal | high', 'normal')
    .option('--meta <k=v>', 'Metadata key=value (repeatable)', collect, [])
    .action(async (opts, cmd) => {
      const url = (cmd.parent?.opts() as { url?: string })?.url ?? getAmqpUrl();
      const to = normalizeName(opts.to);
      const from = normalizeName(opts.from);

      let message: string;
      if (opts.message) {
        message = opts.message;
      } else if (opts.messageFile) {
        message = readFileSync(resolve(opts.messageFile), 'utf8');
      } else if (!process.stdin.isTTY) {
        message = await readStdin();
      } else {
        console.error('cbroker: --message, --message-file, or piped stdin required');
        process.exit(1);
      }

      if (!message.trim()) {
        console.error('cbroker: message is empty');
        process.exit(1);
      }

      const metadata: Record<string, string> = {};
      for (const kv of opts.meta as string[]) {
        const idx = kv.indexOf('=');
        if (idx <= 0) {
          console.error(`cbroker: invalid --meta entry "${kv}", expected key=value`);
          process.exit(1);
        }
        metadata[kv.slice(0, idx)] = kv.slice(idx + 1);
      }

      const files = (opts.file as string[]).map((f) => resolve(f));
      const replyTo = opts.replyTo ? normalizeName(opts.replyTo) : undefined;

      try {
        const msg = await publishOne({
          from,
          to,
          message,
          files,
          reply_to: replyTo,
          correlation_id: opts.correlationId,
          priority: opts.priority,
          metadata: Object.keys(metadata).length ? metadata : undefined,
        }, url);
        console.log(`cbroker: sent ${msg.id} -> ${to}`);
      } catch (err) {
        console.error(`cbroker: send failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
