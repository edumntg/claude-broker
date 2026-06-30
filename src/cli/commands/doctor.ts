import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dockerAvailable, containerStatus } from '../../lib/docker.js';
import { isReachable } from '../../lib/amqp.js';
import { getAmqpUrl, CBROKER_HOME } from '../../lib/config.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose cbroker installation and broker state')
    .action(async (_opts, cmd) => {
      const explicitUrl = (cmd.parent?.opts() as { url?: string })?.url;
      const url = explicitUrl ?? getAmqpUrl();

      const required: Array<[string, boolean, string?]> = [];

      if (explicitUrl) {
        // Remote/cloud endpoint — Docker checks not applicable
        const reachable = await isReachable(url);
        required.push([`broker reachable at ${url}`, reachable]);
      } else {
        required.push(['docker available', dockerAvailable()]);
        const state = containerStatus();
        required.push([`container state`, state === 'running', state]);
        const reachable = state === 'running' ? await isReachable(url) : false;
        required.push([`broker reachable at ${url}`, reachable]);
      }

      required.push(['~/.cbroker exists', existsSync(CBROKER_HOME)]);
      required.push([
        'claude binary on PATH',
        spawnSync('claude', ['--version'], { stdio: 'pipe' }).status === 0,
      ]);

      const inSession = !!process.env.CBROKER_NAME;
      const info: Array<[string, string]> = [];
      info.push(['CBROKER_NAME', process.env.CBROKER_NAME ?? '(unset — not inside a wrapped session)']);
      info.push(['CBROKER_URL', process.env.CBROKER_URL ?? '(unset — not inside a wrapped session)']);
      if (explicitUrl) info.push(['--url (CLI flag)', explicitUrl]);

      let failures = 0;
      for (const [label, ok, detail] of required) {
        const mark = ok ? '✓' : '✗';
        const suffix = detail ? `  (${detail})` : '';
        console.log(`${mark} ${label}${suffix}`);
        if (!ok) failures++;
      }
      console.log('');
      console.log(inSession ? 'Session env:' : 'Session env (not in a wrapped session):');
      for (const [k, v] of info) console.log(`  ${k} = ${v}`);
      console.log('');
      console.log(failures === 0 ? 'All required checks passed.' : `${failures} required check(s) failed.`);
      process.exit(failures === 0 ? 0 : 1);
    });
}
