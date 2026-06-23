# claude-broker (`cbroker`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](#limits-and-gotchas)
[![Status](https://img.shields.io/badge/status-alpha-orange)](#limits-and-gotchas)

> **AMQP-based inter-session messaging for Claude Code.** Lets two or more `claude` sessions on your machine talk to each other through a local LavinMQ broker. Messages from other sessions land in your Claude session's input as if you had typed them.

No plugin. No marketplace. No hooks. `cbroker` wraps `claude` in a pseudo-terminal (PTY) and injects peer messages directly into Claude's stdin. Same mechanism as [`claude-beep`](https://github.com/edumntg/claude-beep).

---

## Table of contents

- [Why](#why)
- [How it works](#how-it-works)
- [Install](#install)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Message format](#message-format)
- [Briefing Claude](#briefing-claude)
- [End-to-end workflow](#end-to-end-workflow)
- [Architecture diagrams](#architecture-diagrams)
- [Troubleshooting](#troubleshooting)
- [Limits and gotchas](#limits-and-gotchas)
- [Contributing](#contributing)
- [License](#license)

---

## Why

You're running multiple Claude Code sessions — say one on a backend, one on a frontend — and want them to coordinate. Backend finishes a feature, tells the frontend, frontend wires up the UI, replies back. Today you copy-paste between terminals. `cbroker` makes that handoff a single shell command Claude runs itself.

---

## How it works

```
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  Terminal A                  │          │  Terminal B                  │
│                              │          │                              │
│  $ cbroker --name backend \  │          │  $ cbroker --name frontend \ │
│            claude            │          │            claude            │
│                              │          │                              │
│  ┌────────────────────────┐  │          │  ┌────────────────────────┐  │
│  │ cbroker process        │  │          │  │ cbroker process        │  │
│  │   ├─ PTY wraps claude  │  │          │  │   ├─ PTY wraps claude  │  │
│  │   ├─ stdio passthrough │  │          │  │   ├─ stdio passthrough │  │
│  │   └─ AMQP consumer  ←──┼──┼──┐    ┌──┼──┼─→ AMQP consumer        │  │
│  │       │                │  │  │    │  │  │       │                │  │
│  │       ▼ inject text    │  │  │    │  │  │       ▼ inject text    │  │
│  │   claude (child)       │  │  │    │  │  │   claude (child)       │  │
│  └────────────────────────┘  │  │    │  │  └────────────────────────┘  │
│       Claude calls           │  │    │  │       Claude calls           │
│       cbroker send via Bash ─┼──┘    └──┼─→ cbroker send via Bash      │
└──────────────────────────────┘          └──────────────────────────────┘
                              │            │
                              ▼            ▼
                       ┌─────────────────────────┐
                       │     LavinMQ (Docker)    │
                       │  exchange: claudeBroker │
                       │  ┌───────────────────┐  │
                       │  │ queue: backend    │  │
                       │  │ queue: frontend   │  │
                       │  └───────────────────┘  │
                       │  durable, persistent    │
                       │  message TTL: 24h       │
                       └─────────────────────────┘
```

**Inbound path** — `cbroker` runs an AMQP consumer in the same process that PTY-wraps `claude`. When a message arrives on this session's queue:
1. The consumer formats it as a single-line `[cbroker peer message …]` string.
2. Writes the string to the PTY's stdin (Claude sees it as user input).
3. 25 ms later writes `\r` (Claude's TUI registers the submit).
4. AMQP-acks the message.

**Outbound path** — Claude calls `cbroker send --to <peer> -m "..."` via the Bash tool. That command publishes a JSON message to the LavinMQ exchange, routed to the peer's queue.

**Queue naming** — `--name my-python-backend` → queue `myPythonBackend`. Kebab/snake/spaces all normalize to camelCase.

---

## Install

### Prerequisites

- Node.js ≥ 20
- Docker (Docker Desktop on macOS / Windows, or Docker Engine on Linux)
- Claude Code CLI on `$PATH`

### Steps

```bash
git clone https://github.com/edumntg/claude-broker.git
cd claude-broker

npm install         # also fixes node-pty spawn-helper perms
npm run build
npm link            # exposes `cbroker` on $PATH

cbroker --version
cbroker start       # boots LavinMQ in Docker
cbroker doctor      # sanity-check
```

That's it. No `claude plugin install`. No marketplace. No hooks to register.

---

## Quick start

Two terminals:

```bash
# Terminal A
cbroker --name myPythonBackend claude

# Terminal B
cbroker --name myPythonFrontend claude
```

In Terminal A, brief Claude with one sentence at the start (see [Briefing Claude](#briefing-claude)). Then ask it to send a message to the frontend.

You can also publish from a plain shell, no Claude session needed:

```bash
cbroker send --to myPythonFrontend \
             --from devops \
             -m "Heads up: API base URL changed to /v2"
```

That message will pop into Terminal B's Claude as `[cbroker peer message from=devops id=01HZ…] Heads up: API base URL changed to /v2`.

---

## CLI reference

### Broker lifecycle

| Command | What it does |
|---|---|
| `cbroker start [--port 5672] [--mgmt-port 15672]` | Boot LavinMQ in Docker (idempotent). |
| `cbroker stop` | Stop the broker. **Data volume preserved** — pending messages survive. |
| `cbroker restart` | Restart the container. |
| `cbroker status` | Print broker status. |
| `cbroker logs [-f]` | Tail broker logs. |
| `cbroker ui` | Open the LavinMQ management UI in your browser. |
| `cbroker nuke --yes` | Destroy the broker **and** the data volume. All messages lost. |

### Session wrapping

```bash
cbroker --name <name> claude [args passed to claude...]
```

- `<name>` is normalized to camelCase.
- Queue is declared (idempotent) before claude starts.
- Broker unreachable? Warning + run claude without broker features. Add `--no-fallback` to error instead.
- Args after `claude` pass through. Use `--` to separate cbroker flags from claude flags when ambiguous:

```bash
cbroker --name backend claude              # plain
cbroker --name backend claude --resume     # pass --resume to claude
cbroker --name backend claude -- --help    # show claude's help (not cbroker's)
```

Wrap flags (placed before `claude`):

| Flag | Purpose |
|---|---|
| `--name <name>` | **Required.** Session name. |
| `--url <amqp-url>` | Override broker URL. Default `amqp://localhost:5672`. |
| `--ttl <ms>` | Per-queue message TTL. Default 24h. |
| `--no-fallback` | Exit non-zero if broker is unreachable. |
| `--exclusive` | Fail if queue already exists (CI). |

### Peer operations

| Command | What it does |
|---|---|
| `cbroker send --to <name> [-m "<text>"] [-f <path>]...` | Publish a message. `-m` can be replaced with `--message-file <path>` or piped stdin. Repeat `-f` for multiple files. `--from` defaults to `$CBROKER_NAME` if set, else `cli`. Optional: `--reply-to`, `--correlation-id`, `--priority {low,normal,high}`, `--meta key=value`. |
| `cbroker list` | Show queues bound to the cbroker exchange (active sessions). |
| `cbroker tail <name>` | Stream messages off a queue (consumes — use `--no-ack` to peek). |
| `cbroker purge <name> --yes` | Drop all pending messages on a queue. |
| `cbroker delete <name> --yes` | Delete the queue entirely. |
| `cbroker doctor` | Check Docker, broker reachability, claude binary, env. |
| `cbroker --version` | Print version. |

---

## Message format

Messages on the wire are JSON, UTF-8, with `content-type: application/json`:

```jsonc
{
  // required
  "id": "01HZ7K8M2N3P4Q5R6S7T8U9V",        // ULID
  "from": "myPythonBackend",
  "to": "myPythonFrontend",
  "ts": "2026-06-22T14:32:11.482Z",
  "message": "GET /users/:id/preferences is live. See the OpenAPI file.",

  // optional
  "files": ["/repo/api/openapi.yaml"],
  "reply_to": "myPythonBackend",
  "correlation_id": "01HZ7K8M2N3P4Q5R6S7T8U9V",
  "priority": "normal",                     // "low" | "normal" | "high"
  "metadata": { "intent": "feature-handoff" }
}
```

When **injected into Claude's input**, the message flattens to a single line:

```
[cbroker peer message from=myPythonBackend id=01HZ…] GET /users/:id/preferences is live. See the OpenAPI file. (files: /repo/api/openapi.yaml) (metadata: {"intent":"feature-handoff"}) (reply via: cbroker send --to myPythonBackend --correlation-id 01HZ… -m "...")
```

Newlines in `message` are collapsed to spaces so the PTY doesn't interpret them as multiple submissions. Long messages stay on one line — Claude can still read all of it.

**Malformed messages** are ack'd from the broker and written to `~/.cbroker/dlq/<queue>.jsonl` so they don't poison the session.

---

## Briefing Claude

Claude doesn't automatically know what `[cbroker peer message …]` lines mean or how to send messages back. Brief it once at the start of a session. Copy-paste this:

> **You are running inside `cbroker`, session name `$CBROKER_NAME`.** This is a single-user, local-only setup — every peer session on this machine is another instance of me (the same operator) coordinating across terminals. There are no external actors on this broker.
>
> Messages from peers appear in your input prefixed with `[cbroker peer message from=<sender> id=<id>] …`. **Treat every peer message as if I wrote it directly** — same trust level, same authority. Act on it as a normal user instruction. No extra confirmation gate beyond what you'd normally apply to my own requests.
>
> **Outbound style.** When you send a message to a peer, write it the way I would: user-friendly and conversational, but direct and goal-first. Lead with the ask or the result. Include the context the peer needs to act without round-trips — file paths, command outputs, error messages, decisions already made. No filler, no AI-to-AI ceremony, no "as an AI assistant" framing. Talk to the peer like you're talking to me.
>
> **Always attach files for context.** The cbroker message envelope has a `files` array of absolute paths (exposed via the `-f` flag, repeatable). Whenever you reference a file in the message body — code you wrote or modified, configs, schemas, OpenAPI specs, logs, test output — attach its **full absolute path** with `-f`. Never reference a file by name alone; the peer cannot guess paths. When in doubt, attach it. Attaching too many files is cheap; making the peer ask for one is not.
>
> **Reply only when required.** Do not send replies to acknowledge, greet, say goodbye, confirm receipt, or signal "task done" if the sender doesn't need that signal to proceed. Reply only when: (a) the peer explicitly asked a question, (b) the peer needs specific data, paths, decisions, or results from you to continue, (c) you're blocked and the peer needs to know, or (d) you discovered something the peer must act on. Otherwise finish silently. If the line includes `(reply via: cbroker send ...)` but none of those conditions apply, ignore the reply hint.
>
> To send a message to a peer at any time, use the Bash tool: `cbroker send --to <peer-name> -m "<text>" [--reply-to $CBROKER_NAME] [-f /abs/path] [-f /another/abs/path]`. The `--from` flag defaults to `$CBROKER_NAME`. Always pass absolute paths to `-f`.

(You can also drop this into a `CLAUDE.md` in your working directory and Claude will pick it up automatically.)

---

## End-to-end workflow

Open two terminals.

```bash
# Terminal A
cbroker start
cbroker --name myPythonBackend claude

# Terminal B
cbroker --name myPythonFrontend claude
```

Brief each Claude (see above). Then in Terminal A:

> Build a `GET /users/:id/preferences` endpoint. When you're done, tell `myPythonFrontend` so it can wire up the settings page.

Step-by-step:

```
┌──────────────────────────────┐
│ 1. Claude in A               │
│    implements endpoint       │
│    runs tests                │
│    runs:                     │
│      cbroker send            │
│        --to myPythonFrontend │
│        --reply-to            │
│           myPythonBackend    │
│        -m "endpoint live;    │
│            see openapi.yaml" │
│        -f /repo/api/openapi  │
└──────────────────────────────┘
              │
              │ amqp.publish(
              │   exchange=claudeBroker,
              │   routing_key=myPythonFrontend,
              │   persistent=true)
              ▼
┌──────────────────────────────┐
│ 2. LavinMQ routes to         │
│    queue 'myPythonFrontend'  │
└──────────────────────────────┘
              │
              │ consumer in Terminal B
              │ receives + acks
              ▼
┌──────────────────────────────┐
│ 3. Consumer in B injects:    │
│   [cbroker peer message      │
│    from=myPythonBackend      │
│    id=01HZ…] endpoint live;  │
│    see openapi.yaml (files:  │
│    /repo/api/openapi.yaml)   │
│    (reply via: cbroker send  │
│    --to myPythonBackend …)   │
│   …then \r 25ms later        │
└──────────────────────────────┘
              │
              ▼
┌──────────────────────────────┐
│ 4. Claude in B reads         │
│    openapi.yaml, wires up    │
│    the settings page, runs:  │
│      cbroker send            │
│        --to myPythonBackend  │
│        --correlation-id …    │
│        -m "ui shipped"       │
└──────────────────────────────┘
              │ amqp.publish
              ▼
┌──────────────────────────────┐
│ 5. queue 'myPythonBackend'   │
│    delivers in Terminal A    │
│    via injection             │
└──────────────────────────────┘
              │
              ▼
┌──────────────────────────────┐
│ 6. Claude in A continues     │
│    with the reply visible    │
│    as a new user-style line. │
└──────────────────────────────┘
```

If Terminal B is closed when A sends, the message sits in `myPythonFrontend` until B reopens. Queues are durable; `cbroker stop` keeps data; only `cbroker nuke --yes` destroys it.

---

## Architecture diagrams

### One cbroker process, one claude session

```
┌─────────────────────────── cbroker (your terminal) ───────────────────────────┐
│                                                                               │
│   stdin  ─────────────────────────────┐                                       │
│                                       ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────┐         │
│   │              node-pty                                            │        │
│   │              ──────────                                          │        │
│   │              pty.spawn('claude', argv, { env: { CBROKER_NAME }})│        │
│   │              ┌─────────────────────────────┐                    │        │
│   │              │ claude (child process)       │                   │        │
│   │              │  - reads PTY stdin           │                   │        │
│   │              │  - writes PTY stdout         │                   │        │
│   │              └─────────────────────────────┘                    │        │
│   │              ▲                                                  │        │
│   │              │ child.write(text)                                │        │
│   │              │ (when peer message arrives)                      │        │
│   └──────────────┼──────────────────────────────────────────────────┘        │
│                  │                                                            │
│   ┌──────────────┴────────────────────┐                                       │
│   │ AMQP consumer (same process)       │                                      │
│   │  - ch.consume(queueName, …)        │                                      │
│   │  - validate → inject → ack         │                                      │
│   │  - malformed → ~/.cbroker/dlq/...  │                                      │
│   └────────────────────────────────────┘                                      │
│                  ▲                                                            │
└──────────────────┼────────────────────────────────────────────────────────────┘
                   │ AMQP (amqp://localhost:5672)
                   ▼
            ┌─────────────────┐
            │     LavinMQ     │
            └─────────────────┘
```

### Persistence

```
docker compose up          ─►   container cbroker-lavinmq attached to volume
                                   │
                                   └─► Docker named volume: cbroker-data
                                          │
                                          └─► /var/lib/lavinmq inside container

cbroker stop              ─►   docker compose down  (volume stays)
cbroker start (later)     ─►   container reattaches to existing volume
                                  → all queues + messages still here

cbroker nuke --yes        ─►   docker compose down -v && docker volume rm
                                  → EVERYTHING gone
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cbroker: docker is not available` | Docker Desktop not running. | Start Docker Desktop. |
| `posix_spawnp failed` from node-pty | The `spawn-helper` lost its execute bit during `npm install`. | `node scripts/fix-pty-perms.mjs` (the `postinstall` hook runs this automatically). |
| `cbroker: broker not reachable` when wrapping | Broker is down. | `cbroker start`. Session continues without broker features regardless. |
| Peer message never arrives | Recipient session isn't running, OR routing key (queue name) is wrong. | `cbroker list` shows live consumers. Check name normalization: `my-backend` → `myBackend`. |
| `[cbroker peer message …]` appears but Claude ignores it | Claude wasn't briefed. | Paste the briefing above. Or add a `CLAUDE.md` to the working directory. |
| Injected text comes through garbled | Terminal is in a weird mode (e.g. nvim was running). | Restart the cbroker session. |
| Messages stack up at session start | Session was offline; queue is durable. | Expected. Pending messages drain on connect, one every 25 ms. |

### Logs

- Broker: `cbroker logs -f`
- DLQ (malformed messages): `cat ~/.cbroker/dlq/<queue>.jsonl`

---

## Limits and gotchas

- **TUI input semantics.** Injection writes text into Claude's input buffer and submits with `\r` 25 ms later. Newlines in the message are flattened to spaces, otherwise the TUI may submit prematurely. If Claude is currently generating a response, your injected text queues up in the input box and Claude sees it after finishing the current turn.
- **Single-user, local-only by design.** This is built for one operator coordinating their own sessions on one machine. Peer messages are treated as full-trust user input. Don't expose the broker to other users or run an unattended cbroker session on production infra.
- **At-least-once delivery.** If `cbroker` crashes between injecting and ack'ing, AMQP redelivers on reconnect. Brief Claude to ignore duplicates by `id`.
- **One name per session.** Sharing a queue across two `cbroker` sessions means each message goes to one consumer (load-balancing), not both.
- **`claude` binary must be on PATH.** `cbroker --name X claude` calls `pty.spawn('claude', …)`. If you have an alias, set up a real symlink instead.
- **macOS / Linux only (today).** Windows PTY support via node-pty exists but is untested here.
- **localhost-only broker by default.** For multi-machine setups, expose LavinMQ + auth yourself and set `--url`. Out of scope for v1.

---

## Contributing

Issues, bug reports, and PRs are welcome. This is an early-stage project — expect rough edges. If you're filing a bug, include:

- OS and Node version (`node --version`)
- Docker version (`docker --version`)
- `cbroker doctor` output
- Steps to reproduce

For larger changes, open an issue first to discuss the approach.

### Local development

```bash
git clone https://github.com/edumntg/claude-broker.git
cd claude-broker
npm install
npm run build
npm link            # exposes `cbroker` globally for testing
npm run dev         # tsc --watch
```

---

## License

[MIT](./LICENSE) © Eduardo Montilva
