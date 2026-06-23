import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { dockerComposeSync, VOLUME_NAME } from '../../lib/docker.js';

export function registerNuke(program: Command): void {
  program
    .command('nuke')
    .description('Stop the broker AND delete the data volume (destroys all messages)')
    .requiredOption('--yes', 'Confirm destructive action')
    .action(async (opts) => {
      if (!opts.yes) {
        console.error('cbroker: refusing to nuke without --yes');
        process.exit(1);
      }
      dockerComposeSync(['down', '-v']);
      const r = spawnSync('docker', ['volume', 'rm', '-f', VOLUME_NAME], {
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        // Volume may have been removed by `down -v`; not fatal
      }
      console.log('cbroker: nuked. Data volume and all messages destroyed.');
    });
}
