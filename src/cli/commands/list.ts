import type { Command } from 'commander';
import { getMgmtUrl, getMgmtAuth, EXCHANGE_NAME } from '../../lib/config.js';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List queues bound to the cbroker exchange (active sessions)')
    .action(async () => {
      const base = getMgmtUrl();
      const { user, pass } = getMgmtAuth();
      const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

      let queues: Array<{
        name: string;
        messages: number;
        consumers: number;
        state: string;
      }>;
      try {
        const res = await fetch(`${base}/api/queues`, { headers: { Authorization: auth } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        queues = (await res.json()) as typeof queues;
      } catch (err) {
        console.error(`cbroker: management API unreachable at ${base}: ${(err as Error).message}`);
        process.exit(1);
      }

      // Filter to queues bound to the cbroker exchange (best effort).
      let bindings: Array<{ source: string; destination: string }> = [];
      try {
        const res = await fetch(`${base}/api/exchanges/%2F/${EXCHANGE_NAME}/bindings/source`, {
          headers: { Authorization: auth },
        });
        if (res.ok) bindings = (await res.json()) as typeof bindings;
      } catch {
        // ignore
      }
      const bound = new Set(bindings.map((b) => b.destination));
      const rows = queues.filter((q) => bound.has(q.name));

      if (rows.length === 0) {
        console.log('No active cbroker queues.');
        return;
      }

      const pad = (s: string, n: number) => s.padEnd(n, ' ');
      console.log(pad('NAME', 24) + pad('CONSUMERS', 12) + pad('PENDING', 10) + 'STATE');
      console.log('-'.repeat(60));
      for (const q of rows) {
        console.log(
          pad(q.name, 24) +
            pad(String(q.consumers), 12) +
            pad(String(q.messages), 10) +
            q.state,
        );
      }
    });
}
