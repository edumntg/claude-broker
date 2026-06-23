import type { Command } from 'commander';
import { dockerAvailable, dockerComposeSync, containerStatus } from '../../lib/docker.js';

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the LavinMQ broker (Docker, idempotent)')
    .option('--port <port>', 'AMQP port', '5672')
    .option('--mgmt-port <port>', 'Management UI port', '15672')
    .action(async (opts) => {
      if (!dockerAvailable()) {
        console.error('cbroker: docker is not available. Install Docker Desktop.');
        process.exit(1);
      }

      const state = containerStatus();
      if (state === 'running') {
        console.log(`cbroker: already running on :${opts.port}`);
        return;
      }

      process.env.CBROKER_AMQP_PORT = opts.port;
      process.env.CBROKER_MGMT_PORT = opts.mgmtPort;

      const r = dockerComposeSync(['up', '-d']);
      if (r.status !== 0) {
        console.error('cbroker: docker compose up failed');
        process.exit(r.status ?? 1);
      }

      console.log(`cbroker: running on amqp://localhost:${opts.port}`);
      console.log(`cbroker: management UI at http://localhost:${opts.mgmtPort}`);
    });
}
