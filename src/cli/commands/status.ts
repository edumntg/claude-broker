import type { Command } from 'commander';
import { containerStatus } from '../../lib/docker.js';
import { isReachable } from '../../lib/amqp.js';
import { getAmqpUrl } from '../../lib/config.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show broker status')
    .action(async (_opts, cmd) => {
      const explicitUrl = (cmd.parent?.opts() as { url?: string })?.url;
      const url = explicitUrl ?? getAmqpUrl();

      if (explicitUrl) {
        const ok = await isReachable(url);
        console.log(ok ? `cbroker: reachable at ${url}` : `cbroker: not reachable at ${url}`);
        return;
      }

      const state = containerStatus();
      if (state === 'running') {
        const ok = await isReachable(url);
        console.log(
          ok
            ? `cbroker: running on ${url}`
            : `cbroker: container running but ${url} is not reachable`,
        );
      } else if (state === 'exited') {
        console.log('cbroker: container exists but is stopped (run `cbroker start`)');
      } else {
        console.log('cbroker: not running');
      }
    });
}
