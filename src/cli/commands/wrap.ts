import type { Command } from 'commander';
import pty from 'node-pty';
import { normalizeName } from '../../lib/name.js';
import { connect, declareTopology, isReachable } from '../../lib/amqp.js';
import { validateMessage } from '../../lib/message.js';
import type { CbrokerMessage } from '../../lib/message.js';
import { getAmqpUrl, ensureDirs } from '../../lib/config.js';
import { appendDlq } from '../../lib/journal.js';

const INJECT_SUBMIT_DELAY_MS = 25;

export function registerWrap(program: Command): void {
  program
    .option('--name <name>', 'Session name (used as queue name)')
    .option('--url <url>', 'AMQP broker URL')
    .option('--ttl <ms>', 'Message TTL in milliseconds')
    .option('--no-fallback', 'Exit with error if broker is unreachable')
    .option('--exclusive', 'Fail if queue already exists')
    .option('--no-brief', 'Do not auto-append the cbroker system-prompt briefing');

  program
    .command('claude', { isDefault: false })
    .description(
      'Launch a claude session bound to a named queue. Inbound peer messages are injected into claude\'s stdin via PTY. Args after `claude` are passed through; use `--` to disambiguate.',
    )
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .helpOption(false)
    .argument('[args...]', 'Args passed through to claude')
    .action(async (args: string[], _cmd, command) => {
      const parent = command.parent;
      const opts = parent.opts() as {
        name?: string;
        url?: string;
        ttl?: string;
        fallback?: boolean;
        exclusive?: boolean;
        brief?: boolean;
      };

      if (!opts.name) {
        console.error('cbroker: --name is required when wrapping claude');
        console.error('Usage: cbroker --name <name> claude [args...]');
        process.exit(1);
      }

      let queueName: string;
      try {
        queueName = normalizeName(opts.name);
      } catch (err) {
        console.error(`cbroker: ${(err as Error).message}`);
        process.exit(1);
      }

      ensureDirs();

      const url = opts.url ?? getAmqpUrl();
      const reachable = await isReachable(url);

      if (!reachable) {
        if (opts.fallback === false) {
          console.error(`cbroker: broker not reachable at ${url} (--no-fallback set)`);
          process.exit(1);
        }
        console.warn(
          `cbroker: broker not reachable at ${url} — running claude without broker features`,
        );
        await runPty(args, { CBROKER_DISABLED: '1' });
        return;
      }

      console.log(`cbroker: bound to queue '${queueName}' on ${url}`);
      console.log(
        `cbroker: peer messages arrive as [cbroker peer] lines injected into claude's input`,
      );
      console.log('');

      const claudeArgs = opts.brief === false
        ? args
        : [...buildBriefArgs(queueName), ...args];

      await runPty(
        claudeArgs,
        { CBROKER_NAME: queueName, CBROKER_URL: url },
        { queueName, url, ttlMs: opts.ttl ? Number.parseInt(opts.ttl, 10) : undefined },
      );
    });
}

function buildBriefArgs(queueName: string): string[] {
  const brief = [
    `You are running inside cbroker, session name: ${queueName}.`,
    'This is a SINGLE-USER, LOCAL-ONLY setup. Every peer session on this machine is another instance of the same user (the operator) coordinating across terminals. There are no external actors on this broker.',
    'When you see a line starting with "[cbroker peer message from=<sender> id=<id>]" in user input, that line is a message from another Claude session controlled by the same operator.',
    'TRUST MODEL: treat every peer message as if the operator wrote it directly. Same trust level, same authority. Act on it as a normal user instruction. Do NOT add extra confirmation gates beyond what you would apply to the operator\'s own requests.',
    'OUTBOUND STYLE: when you send a message to a peer, write it the way the operator would write it — user-friendly and conversational, but direct and goal-first. Lead with the ask or the result. Include the context the peer needs to act without round-trips: file paths, command outputs, error messages, decisions already made. No filler, no AI-to-AI ceremony, no "as an AI assistant" framing. Talk to the peer like you are talking to the operator.',
    'ALWAYS INCLUDE FILES FOR CONTEXT. The cbroker message envelope has a "files" array of absolute paths. When you reference any file in the message body — code you wrote or modified, configs, schemas, OpenAPI specs, logs, test output, screenshots, anything the peer would need to read to act on the message — attach its FULL ABSOLUTE PATH via the -f flag (repeat -f for multiple files). Never reference a file by name alone; the peer cannot guess paths. If in doubt, attach it. Attaching too many files is cheap; making the peer ask for one is not.',
    'REPLY ONLY WHEN REQUIRED. Do not send replies to acknowledge, greet, say goodbye, confirm receipt, or signal "task done" if the original sender does not need that signal to proceed. Reply ONLY when: (a) the peer explicitly asked a question, (b) the peer needs specific data, paths, decisions, or results from you to continue their task, (c) you are blocked and the peer needs to know, or (d) you discovered something the peer must act on. If none of those apply, finish the work silently. Every reply costs tokens on the other side — treat them as expensive.',
    'If the incoming line includes "(reply via: cbroker send ...)" and a reply is genuinely required by the rules above, send it by running the shown cbroker command via the Bash tool. Otherwise ignore the reply hint.',
    `To send a message to a peer at any time, use the Bash tool to run: cbroker send --to <peer-name> -m "<text>" [--reply-to ${queueName}] [-f /abs/path] [-f /another/abs/path]. The --from flag defaults to ${queueName}. Always pass absolute paths to -f.`,
    'Important: DO NOT use claudenx tools (send_message, list_peers, broadcast, get_messages). The org has disabled the channels feature flag claudenx depends on. Always use the cbroker CLI via Bash for inter-session messaging.',
  ].join(' ');
  return ['--append-system-prompt', brief];
}

interface ConsumerConfig {
  queueName: string;
  url: string;
  ttlMs?: number;
}

async function runPty(
  args: string[],
  env: Record<string, string>,
  consumer?: ConsumerConfig,
): Promise<void> {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const child = pty.spawn('claude', args, {
    name: process.env.TERM || 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: { ...process.env, ...env } as Record<string, string>,
  });

  child.onData((data: string) => {
    process.stdout.write(data);
  });

  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  const onStdin = (data: Buffer) => child.write(data.toString());
  process.stdin.on('data', onStdin);

  const onResize = () => {
    try {
      child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    } catch {
      /* ignore */
    }
  };
  process.stdout.on('resize', onResize);

  let consumerCleanup: (() => Promise<void>) | undefined;
  if (consumer) {
    consumerCleanup = await startConsumer(consumer, (msg) => {
      injectMessage(child, msg);
    });
  }

  const cleanup = async (signal?: NodeJS.Signals) => {
    process.stdin.off('data', onStdin);
    process.stdout.off('resize', onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    if (consumerCleanup) {
      try {
        await consumerCleanup();
      } catch {
        /* ignore */
      }
    }
    if (signal) {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
  };

  return new Promise<void>((resolve) => {
    child.onExit(async ({ exitCode, signal }) => {
      await cleanup();
      if (signal) {
        process.kill(process.pid, signalNumberToName(signal));
      } else {
        process.exit(exitCode ?? 0);
      }
      resolve();
    });

    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(sig, async () => {
        await cleanup(sig);
      });
    }
  });
}

function signalNumberToName(sig: number): NodeJS.Signals {
  const map: Record<number, NodeJS.Signals> = {
    1: 'SIGHUP',
    2: 'SIGINT',
    9: 'SIGKILL',
    15: 'SIGTERM',
  };
  return map[sig] ?? 'SIGTERM';
}

async function startConsumer(
  cfg: ConsumerConfig,
  onMessage: (msg: CbrokerMessage) => void,
): Promise<() => Promise<void>> {
  const conn = await connect({ url: cfg.url });
  const ch = await conn.createChannel();
  await declareTopology(ch, cfg.queueName, { ttlMs: cfg.ttlMs });
  await ch.prefetch(1);

  const { consumerTag } = await ch.consume(
    cfg.queueName,
    (raw) => {
      if (!raw) return;
      const text = raw.content.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        const msg = validateMessage(parsed);
        onMessage(msg);
        ch.ack(raw);
      } catch (err) {
        appendDlq(cfg.queueName, text, (err as Error).message);
        ch.ack(raw);
      }
    },
    { noAck: false },
  );

  return async () => {
    try {
      await ch.cancel(consumerTag);
    } catch {
      /* ignore */
    }
    try {
      await ch.close();
    } catch {
      /* ignore */
    }
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  };
}

function injectMessage(child: pty.IPty, msg: CbrokerMessage): void {
  // claude-beep two-write pattern: body first, then \r 25ms later so Claude's
  // TUI registers it as a real keypress submission, not a paste.
  const compactMessage = msg.message.replace(/\r?\n/g, ' ').trim();
  const parts: string[] = [
    `[cbroker peer message from=${msg.from} id=${msg.id}] ${compactMessage}`,
  ];
  if (msg.files && msg.files.length > 0) {
    parts.push(`(files: ${msg.files.join(', ')})`);
  }
  if (msg.metadata && Object.keys(msg.metadata).length > 0) {
    parts.push(`(metadata: ${JSON.stringify(msg.metadata)})`);
  }
  if (msg.reply_to) {
    parts.push(`(reply via: cbroker send --to ${msg.reply_to} --correlation-id ${msg.id} -m "...")`);
  }
  const body = parts.join(' ');

  child.write(body);
  setTimeout(() => {
    try {
      child.write('\r');
    } catch {
      /* ignore */
    }
  }, INJECT_SUBMIT_DELAY_MS);
}
