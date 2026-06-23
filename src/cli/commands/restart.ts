import type { Command } from 'commander';
import { dockerComposeSync } from '../../lib/docker.js';

export function registerRestart(program: Command): void {
  program
    .command('restart')
    .description('Restart the broker')
    .action(async () => {
      const r = dockerComposeSync(['restart']);
      if (r.status !== 0) process.exit(r.status ?? 1);
      console.log('cbroker: restarted');
    });
}
