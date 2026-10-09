# Claude Radar

Local mission control for [Claude Code](https://code.claude.com). One page that shows every Claude Code session on your machine, the agents each one has spawned, what each of them is doing and thinking right now, and which ones are waiting for you.

Nothing leaves your machine. Radar only reads the files Claude Code already writes under `~/.claude`.

```
┌─ Needs you ─────────┬───────────────────────────────────────────┬─ Detail ─────────────────┐
│ worky · finished    │  [session: Hemnet strategy]──[agent]       │ title, state, stats      │
│ hub · has a question│                             ├─[agent]     │ one-line summary         │
├─ Projects ──────────┤  [session: Radar build]─────[agent]       │ reasoning stream:        │
│ ● ai-enablement 2/3 │                                            │  you / thinking / tools  │
│ ○ dotfiles      1   │                                            │  / replies, live         │
└─────────────────────┴───────────────────────────────────────────┴──────────────────────────┘
```

## What you get

- **Project list** on the left with the overall status of each directory that has sessions: how many are working, waiting for you, finished, idle. Click one to see its sessions; shift-click to add more; `all` shows everything.
- **Graph** in the middle: each session is a node, each subagent hangs off the session (or off the agent that spawned it). Colour is state: blue working, amber waiting for you, mint finished, grey idle. Running agents' edges flow. Sessions with many finished agents fold them into one node you can expand.
- **Detail panel** on the right: title, state, context size, turns, tool calls, model, a short written summary, and the live reasoning stream of the selected session or agent: your prompts, Claude's thinking, every tool call with its arguments and result, and replies. Filter by kind, follow the tail, load earlier.
- **Needs you** tray plus in-page toasts (no OS notifications) when a session asks a question, waits for a permission, or finishes its turn. Press `n` to jump to the next one, `Esc` to clear, `f` to fit the graph.
- **Summaries**: a small model (Haiku, run through your own `claude` login) writes a headline, progress and "what you need to do" for a session when it finishes or needs you. Automatic, on request only, or off; switch in the top bar. About a fifth of a cent per summary.
- **Recent sessions** per project, so you can open a finished session and read what happened.
- **Menu bar app** (macOS, optional): the same thing living in your top bar with a count of sessions that need you.

## Requirements

- Claude Code installed and logged in (that is the only real prerequisite; it is also what powers summaries).
- Node.js 20 or newer. No npm dependencies for the server or the web page.

## Run it

```sh
git clone <this repo> claude-radar
cd claude-radar
node bin/claude-radar.mjs            # opens http://localhost:4747
```

Options: `--port 4747`, `--no-open`, `--no-summaries`, `--model haiku`.

### Hooks (recommended)

Radar sees sessions, transcripts and agents without any setup. To learn the *exact* moment a session asks you something, waits for a permission, or finishes, let it register a few Claude Code hooks:

```sh
node bin/claude-radar.mjs hooks install     # or click "Install hooks" in the page
node bin/claude-radar.mjs hooks status
node bin/claude-radar.mjs hooks uninstall
```

This adds command hooks to `~/.claude/settings.json` (a backup is written next to it) that run `~/.claude/claude-radar/hook.sh`, a four-line POSIX shell script that copies the hook's JSON into a spool directory. The hooks are async and always exit 0, so they can never slow down or block a session. Existing hooks are preserved. Sessions started after installing pick them up; running ones need `/hooks` reload or a restart.

Without hooks, Radar falls back to Claude Code's own busy/idle flag and the transcript, which still catches "finished" and "asked a question" but a few seconds later and with less certainty.

### Summaries and cost

Summaries are produced by `claude -p` with every setting source, MCP server, tool and plugin stripped, a tiny system prompt and `--max-turns 1`. Measured cost is about $0.002 and 2 to 3 seconds per summary on Haiku. They are cached on disk by session and transcript position, so a session is never summarised twice for the same state. Set the top bar to *on request* or *off* if you want zero spend.

### Menu bar app (macOS)

```sh
cd app && pnpm install     # or npm install; downloads Electron
pnpm start                 # or npm start
```

The tray item shows `2 need you` or the number of working sessions, lists sessions in its menu, and opens the dashboard in a window. If a `claude-radar` server is already running on the port, the app attaches to it instead of starting another.

## How it works

Claude Code writes everything Radar needs:

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` | Live registry: session id, cwd, derived name, busy/idle |
| `~/.claude/projects/<cwd>/<session>.jsonl` | Full transcript, appended live: prompts, thinking, tool calls, results, usage |
| `.../<session>/subagents/agent-*.jsonl` + `.meta.json` | Each subagent's transcript, description, type, spawn depth, parent tool call |
| Hooks (optional) | `UserPromptSubmit`, `Stop`, `Notification`, `PermissionRequest`, `AskUserQuestion` pre/post, `Subagent*`, `Session*` |

The server (`server/`) tails those files incrementally once a second, keeps a small model per transcript, and resolves each session to one state: `working`, `question`, `permission`, `done`, `idle` or `exited`. The page (`web/`) is plain HTML, CSS and ES modules, fed by one server-sent-events stream and a small JSON API. No build step.

Run the tests with `node --test`.

## Privacy

Radar binds to `127.0.0.1` only and rejects cross-origin requests, so other web pages cannot read your sessions or trigger actions. Transcripts are read from disk and served only to the page. Summaries send a bounded digest (prompts, last reply, recent tool names) to Anthropic through your own Claude login, the same place the session itself runs.

## Roadmap

- Package the menu bar app as a signed `.app` so it needs no Node at all.
- Windows and Linux tray.
- Per-session cost from transcript usage.
