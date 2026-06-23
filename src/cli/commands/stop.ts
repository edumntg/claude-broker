import type { Command } from 'commander';
import { dockerAvailable, dockerComposeSync, containerStatus } from '../../lib/docker.js';

export function registerStop(program: Command): void {
  program
    .command('stop')
    .description('Stop the LavinMQ broker (data volume preserved)')
    .action(async () => {
      if (!dockerAvailable()) {
        console.error('cbroker: docker is not available.');
        process.exit(1);
      }
      if (containerStatus() === 'absent') {
        console.log('cbroker: not running');
        return;
      }
      const r = dockerComposeSync(['down']);
      if (r.status !== 0) {
        console.error('cbroker: docker compose down failed');
        process.exit(r.status ?? 1);
      }
      console.log('cbroker: stopped (data volume preserved)');
    });
}
