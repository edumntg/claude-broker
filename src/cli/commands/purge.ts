import type { Command } from 'commander';
import { normalizeName } from '../../lib/name.js';
import { connect } from '../../lib/amqp.js';
import { getAmqpUrl } from '../../lib/config.js';

export function registerPurge(program: Command): void {
  program
    .command('purge <name>')
    .description('Delete all pending messages on a queue')
    .requiredOption('--yes', 'Confirm purge')
    .action(async (name: string, opts, cmd) => {
      if (!opts.yes) {
        console.error('cbroker: refusing to purge without --yes');
        process.exit(1);
      }
      const url = (cmd.parent?.opts() as { url?: string })?.url ?? getAmqpUrl();
      const queue = normalizeName(name);
      const conn = await connect({ url });
      try {
        const ch = await conn.createChannel();
        const result = await ch.purgeQueue(queue);
        await ch.close();
        console.log(`cbroker: purged ${result.messageCount} message(s) from '${queue}'`);
      } finally {
        await conn.close();
      }
    });
}
