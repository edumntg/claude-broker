import type { Command } from 'commander';
import { normalizeName } from '../../lib/name.js';
import { connect } from '../../lib/amqp.js';
import { getAmqpUrl } from '../../lib/config.js';

export function registerDelete(program: Command): void {
  program
    .command('delete <name>')
    .description('Delete a queue entirely')
    .requiredOption('--yes', 'Confirm deletion')
    .action(async (name: string, opts, cmd) => {
      if (!opts.yes) {
        console.error('cbroker: refusing to delete without --yes');
        process.exit(1);
      }
      const url = (cmd.parent?.opts() as { url?: string })?.url ?? getAmqpUrl();
      const queue = normalizeName(name);
      const conn = await connect({ url });
      try {
        const ch = await conn.createChannel();
        const result = await ch.deleteQueue(queue);
        await ch.close();
        console.log(`cbroker: deleted '${queue}' (had ${result.messageCount} pending)`);
      } finally {
        await conn.close();
      }
    });
}
