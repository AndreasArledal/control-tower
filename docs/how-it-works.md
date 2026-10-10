# How it works

Claude Code writes everything Control Tower needs. Control Tower only reads.

## Data sources

All under the Claude config dir, `~/.claude` or `CLAUDE_CONFIG_DIR`:

| Source | What it gives |
|---|---|
| `sessions/<pid>.json` | Live registry: session id, cwd, derived name, busy/idle |
| `projects/<cwd>/<session>.jsonl` | Full transcript, appended live: prompts, thinking, tool calls, results, usage |
| `.../<session>/subagents/agent-*.jsonl` + `.meta.json` | Each subagent's transcript, description, type, spawn depth, parent tool call |
| `control-tower/events/*.json` | The hook spool, when [hooks](hooks.md) are installed |

Control Tower keeps its own state under `control-tower/` in the same dir: the hook spool, the summary cache, settings and what you have seen.

## The server

`server/` is zero-dependency Node. Once a second it reads the registry, drains the hook spool, tails every transcript from where it left off, scans for new agents, and resolves each session to one state: `working`, `question`, `permission`, `done`, `idle` or `exited`, plus the follow-up verdict from the summarizer. A cheap fingerprint decides whether anything could have changed before a snapshot is built; a snapshot is pushed to the page only when it differs from the last one.

Memory is bounded for processes that run for days: a window of entries per transcript, a cap on the ids kept for matching tool results and agent parents, a capped summary cache, and expiry of exited sessions after six hours.

Terminal focusing exists on the API (`POST /api/session/<id>/focus`, for WezTerm, iTerm2, Terminal.app, tmux and kitty, with a `focusCommand` setting to override) but not in the page, since WezTerm cannot switch workspaces from the CLI.

## The page

`web/` is plain HTML, CSS and ES modules with no build step. One server-sent-events stream delivers snapshots; a small JSON API serves transcripts on demand, in pages by a stable sequence number. The page binds only to the local server, which accepts API calls from its own origin alone.

## Tests and the demo fixture

`node --test` runs the suite: parser, tailer, state rules, hook reducer, settings merge, summarizer queue and digest, store integration against a fake config dir, HTTP routes and the origin guard.

`node scripts/demo.mjs` builds a throwaway config dir with invented projects, sessions and agents, serves it with a stub summarizer, and captures `docs/screenshot.png`. `--docs` also regenerates every image under `docs/images/`, driving headless Chrome over the DevTools protocol. `--keep` leaves it serving for a look around. Nothing in it touches your real `~/.claude`.

## Going deeper

[DESIGN.md](DESIGN.md) is the module map and the exact state-resolution rules. [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) is the visual system, with the rationale for every surface and the motion and interaction rules.
