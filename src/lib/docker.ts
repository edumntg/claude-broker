import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// At runtime we live in dist/lib/, so compose file is at ../../docker/lavinmq.compose.yml
export const COMPOSE_FILE = join(here, '..', '..', 'docker', 'lavinmq.compose.yml');

export const CONTAINER_NAME = 'cbroker-lavinmq';
export const VOLUME_NAME = 'cbroker-data';

export function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    stdio: 'pipe',
  });
  return r.status === 0;
}

export function dockerCompose(args: string[], opts: { inherit?: boolean } = {}) {
  const env = { ...process.env };
  return spawn('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    stdio: opts.inherit ? 'inherit' : 'pipe',
    env,
  });
}

export function dockerComposeSync(args: string[]) {
  return spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
}

export function containerStatus(): 'running' | 'exited' | 'absent' {
  const r = spawnSync(
    'docker',
    ['ps', '-a', '--filter', `name=^${CONTAINER_NAME}$`, '--format', '{{.State}}'],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  if (r.status !== 0) return 'absent';
  const state = (r.stdout ?? '').trim();
  if (state === 'running') return 'running';
  if (!state) return 'absent';
  return 'exited';
}
