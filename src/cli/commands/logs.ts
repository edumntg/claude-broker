import type { Command } from 'commander';
import { dockerComposeSync } from '../../lib/docker.js';

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Tail broker logs')
    .option('-f, --follow', 'Follow log output')
    .action(async (opts) => {
      const args = ['logs'];
      if (opts.follow) args.push('-f');
      dockerComposeSync(args);
    });
}
