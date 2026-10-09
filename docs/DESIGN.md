# Control Tower: design

Date: 2026-10-09. Status: implemented in this repo.

## Intent

An engineer runs many Claude Code sessions at once and loses track of them. They want one local page that shows every session and its agents as a graph, lets them read any session's reasoning, and tells them (in the page, never via OS notifications) when a session needs input or has finished. Summaries should make a session understandable at a glance. Portability matters: anyone with Claude Code should be able to run it; a standalone menu bar app is a bonus.

## Data sources

All under the Claude config dir (`CLAUDE_CONFIG_DIR` or `~/.claude`):

1. `sessions/<pid>.json`: registry of live CLIs. Fields used: `pid`, `sessionId`, `cwd`, `name`, `status` (busy/idle), `startedAt`. Liveness is confirmed with `kill(pid, 0)`.
2. `projects/<encoded cwd>/<sessionId>.jsonl`: transcript. `encoded cwd` replaces every non-alphanumeric character with `-`. Lines of interest: `user`, `assistant` (content blocks: thinking, text, tool_use), `ai-title`, `summary`, `system`. Assistant lines carry `message.usage`; context size is `input + cache_read + cache_creation`. `uuid`/`parentUuid` make the file a tree, but Control Tower renders it linearly.
3. `projects/<encoded cwd>/<sessionId>/subagents/agent-<id>.jsonl` and `agent-<id>.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`, `isFork`, `requestShape`). The parent is whichever transcript (main or agent) contains `toolUseId`.
4. Hook spool `control-tower/events/*.json`, written by `hook.sh` from hook stdin. Files are named with a second-resolution timestamp and applied in mtime order.

## Server

Zero-dependency Node (ESM). Modules:

- `paths.mjs`: config dir, project dir encoding.
- `registry.mjs`: read the registry, pid liveness.
- `transcript.mjs`: `parseLine` normalises a raw line into entries (`prompt`, `thinking`, `text`, `tool_use`, `tool_result`, `title`, `notice`, `system`, `summary`). `TranscriptTailer` reads appended bytes by offset, carries an unfinished tail as bytes (UTF-8 safe), and restarts on truncation.
- `model.mjs`: `SessionModel` folds entries into facts (title, prompts, last reply, pending tool calls, counts, context tokens). `resolveState` and `resolveAgentState` are pure.
- `hook-events.mjs`: normalise hook payloads; pure reducer over per-session hook state.
- `hooks-install.mjs` / `hooks-ctl.mjs`: merge/remove hooks in settings.json idempotently, refuse to touch unparseable settings, keep a backup.
- `summarizer.mjs`: digest builder, `claude -p` runner (stripped), serial queue with on-disk cache.
- `store.mjs`: the orchestrator. `tick()` once a second: registry → spool → transcripts → agents → derive. Emits `change` with a snapshot only when something visible changed. Serves timelines by stable `seq`, with a memory cap per transcript.
- `index.mjs`: HTTP + SSE, static files, same-origin guard.
- `start.mjs`: boots everything in-process (used by the CLI and the menu bar app).

## State resolution

Per session, in priority order:

1. process gone or `SessionEnd` → `exited`
2. hook attention (`PermissionRequest`, `Notification:permission_prompt`, `PreToolUse:AskUserQuestion`) → `permission` / `question`
3. transcript shows a pending `AskUserQuestion` → `question`
4. `doneAt` (hook `Stop`, or registry busy→idle flip) newer than the last prompt and not acknowledged → `done`
5. registry busy, or transcript activity within 4 s → `working`
6. otherwise `idle`

Attention clears when a new prompt arrives, or (for permissions) when the transcript moves past the prompt. `done` is a plain status; "seen" (opening the session, clicking its toast or badge item, picking its project) only removes it from the count.

Follow-up: each session summary carries `status` (working / waiting_for_user / complete) and `waitingFor`. A live session that is idle or done with a verdict of waiting_for_user newer than its last reply gets `followUp`, which counts as needing you, renders as "needs you" in amber (soft dashed ring, no pulse), and keeps its project active regardless of the one-hour window.

Display states: the page derives five mutually exclusive states from the server's (`web/format.js` `uiState`): working; needs you (question, permission, or follow-up); finished (done, or a reply within the last hour with nothing asked); idle (over an hour quiet); ended.

Visibility: Active mode shows projects with any live session that is not idle, has a follow-up, or had activity within the last hour. Ended sessions are hidden unless toggled or opened from the recent list.

Agents: `done` on `SubagentStop`, on the parent's tool result (foreground agents only; background launches return immediately), or on a final `end_turn` text with no pending tool calls; `exited` with the session; otherwise `running`.

## Summaries

Triggered automatically when a live session is first seen and whenever it enters `done`/`question`/`permission`; manually from the drawer; never when the mode is `off`. Project headlines are requested whenever the set of live sessions or their summaries change, keyed accordingly, and fall back to session titles. One job at a time, 20 s cooldown per session, cached by `session:entryCount:state`. The digest is bounded (first prompt, last three prompts, last reply, last twelve tool calls, agents). Output is JSON `{headline, progress, needs}` enforced with `--json-schema`.

## Terminal focus

`focus.mjs` maps a session's pid to its tty (`ps`), walks the process tree to find the hosting terminal, and builds a command plan per terminal (WezTerm CLI by tty, AppleScript for iTerm2 and Terminal.app, tmux by pane tty, kitty by env match, otherwise raise the app). A `focusCommand` setting overrides detection.

## Web

Plain ES modules, no build. Visual design per `docs/DESIGN-SYSTEM.md`: top bar, project chip rail, full-bleed canvas, drawer overlay on demand. `app.js` owns state and wiring, `graph.js` lays out and renders the SVG tree (sessions stacked under a project label with its headline, agents to the right, finished agents folded after three), `stream.js` polls the timeline for the open transcript, `format.js` has the small helpers. One SSE stream carries snapshots. Deep links: `#session=<id>&agent=<id>`.

## Menu bar app

`app/main.cjs` (Electron) embeds the server via `start.mjs` unless one is already on the port, subscribes to the SSE stream, and renders a template tray icon whose title is the number of sessions that need you. The window is the same page.

## Tree layout

See `docs/DESIGN-SYSTEM.md` §D: rows are top-pinned (a session's position never depends on its agent count), edges are an orthogonal bus with a neutral trunk and state-coloured stubs, running agents come first, finished ones are dimmed and folded after three, columns wrap after eight.

## Testing

`node --test`: parser, tailer (partial lines, UTF-8 split, vanished file), model, state rules, hook reducer, settings merge, hooks controller, summarizer queue and digest, store integration against a fake config dir, HTTP routes and the origin guard.
