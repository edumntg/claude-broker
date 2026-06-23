import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { getMgmtUrl } from '../../lib/config.js';

export function registerUi(program: Command): void {
  program
    .command('ui')
    .description('Open the LavinMQ management UI in a browser')
    .action(async () => {
      const url = getMgmtUrl();
      console.log(`Opening ${url}`);
      const platform = process.platform;
      const cmd =
        platform === 'darwin'
          ? 'open'
          : platform === 'win32'
            ? 'start'
            : 'xdg-open';
      spawnSync(cmd, [url], { stdio: 'inherit', shell: platform === 'win32' });
    });
}
