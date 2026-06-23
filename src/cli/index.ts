#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerStart } from './commands/start.js';
import { registerStop } from './commands/stop.js';
import { registerStatus } from './commands/status.js';
import { registerRestart } from './commands/restart.js';
import { registerLogs } from './commands/logs.js';
import { registerUi } from './commands/ui.js';
import { registerNuke } from './commands/nuke.js';
import { registerWrap } from './commands/wrap.js';
import { registerSend } from './commands/send.js';
import { registerList } from './commands/list.js';
import { registerTail } from './commands/tail.js';
import { registerPurge } from './commands/purge.js';
import { registerDelete } from './commands/delete.js';
import { registerDoctor } from './commands/doctor.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));

const program = new Command();
program
  .name('cbroker')
  .description('AMQP-based inter-session messaging for Claude Code')
  .version(pkg.version)
  .enablePositionalOptions(true);

registerStart(program);
registerStop(program);
registerStatus(program);
registerRestart(program);
registerLogs(program);
registerUi(program);
registerNuke(program);
registerSend(program);
registerList(program);
registerTail(program);
registerPurge(program);
registerDelete(program);
registerDoctor(program);
registerWrap(program);

await program.parseAsync(process.argv);
