#!/usr/bin/env node
// node-pty 1.x ships prebuilt `spawn-helper` binaries that sometimes land
// without the execute bit on macOS/Linux after npm install. Re-apply it so
// pty.spawn() doesn't fail with `posix_spawnp failed`.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
if (!fs.existsSync(dir)) process.exit(0);

for (const entry of fs.readdirSync(dir)) {
  const helper = path.join(dir, entry, 'spawn-helper');
  if (fs.existsSync(helper)) {
    try {
      fs.chmodSync(helper, 0o755);
    } catch {
      /* ignore */
    }
  }
}
