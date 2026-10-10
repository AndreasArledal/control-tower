# Control Tower

Local dashboard for Claude Code sessions. Zero-dependency Node server (`server/`, ESM `.mjs`) that tails
`~/.claude` and serves a plain HTML/ES-module page (`web/`) over JSON + SSE. Optional Electron Mac app
in `app/` with a menu bar item. No build step, no linter, no runtime npm dependencies outside `app/`.

Read `docs/DESIGN.md` first: it is the module map, data sources and state-resolution rules. User-facing guides live in
`docs/*.md` (index in `docs/README.md`); keep them in step with behaviour changes, and regenerate their images with the demo script.
`docs/DESIGN-SYSTEM.md` is the visual system with the rationale for every surface; UI work follows it.

## Commands

`node` is installed via mise and is only on the login shell's PATH. From a non-interactive shell:

```sh
zsh -lic 'node --test'                                   # all tests, ~1s, no network
zsh -lic 'node --test test/store.test.mjs'               # one file
zsh -lic 'node bin/control-tower.mjs --no-open --no-summaries --port 4748'   # dev server without browser popups or spend
zsh -lic 'node bin/control-tower.mjs hooks status'
zsh -lic 'node scripts/demo.mjs --docs'                   # regenerate docs/screenshot.png and docs/images/* from invented sessions (--keep serves it on 4749)
```

Mac app: `cd app && npm install && npm start` runs from source; `npm run install-app`
packages and copies to /Applications; `npm run icon` regenerates the tray icons; `TOWER_SMOKE=3000 npm start`
quits after 3 s for a smoke test.

Reload the browser to pick up `web/` changes. Restart the server for `server/` changes.

## Gotchas

- The dev server reads your real Claude config dir (`CLAUDE_CONFIG_DIR` or `~/.claude`) and writes
  `control-tower/{events,summaries.json,state.json,summarizer/}` under it. `hooks install` edits the real
  `settings.json` (backup written beside it). Tests never touch it: build a temp home like `fakeHome()` in
  `test/store.test.mjs`.
- Summaries shell out to `claude -p` with every setting source, MCP server and tool stripped. `childEnv()`
  in `server/summarizer.mjs` drops `CLAUDE*` env vars so this works even when the server is started from
  inside a Claude Code session. Tests inject a fake `runner`; `TowerStore` accepts `summarizer: null` and
  `store._now` can be overridden for clock control.
- Claude Code's JSONL format is parsed in one place, `parseLine` in `server/transcript.mjs`, with fixtures
  in `test/transcript.test.mjs`. Adapt there when the format changes.
- Two state vocabularies: the server resolves `working | question | permission | done | idle | exited`
  (`resolveState` in `server/model.mjs`); the page derives working / needs you / finished / idle / ended in
  `uiState` in `web/format.js`. There is deliberately no model-judged "finished" for sessions; the
  summarizer's `status: waiting_for_user` verdict adds a `followUp` flag instead.
- Keep server and web dependency-free. Only `app/` has (dev) dependencies, for Electron.
- Default port 4747; `PORT` env is honoured. The Electron app attaches to an already-running server on that
  port instead of starting its own.
- Screenshots: Chrome's own `--screenshot` mode hangs on the page because the SSE stream never closes.
  Drive Chrome over the DevTools protocol instead; `screenshot()` in `scripts/demo.mjs` is the working pattern.
  `node scripts/demo.mjs --keep --no-shot --port 4751` serves the fixture for manual or scripted checks; `curl`
  can hit the API (no Origin header passes the same-origin guard), e.g. `POST /api/session/<id>/seen`.
  If the script is killed hard, its `sleep 3600` children are orphaned; kill them.
- The user usually has a real instance on port 4747. Its page picks up `web/` changes on reload, but it runs
  the old `server/` code until restarted. To debug a live session: `GET /api/state`, `GET
  /api/timeline?session=<id>&after=<seq>&limit=100`, and the summary cache at `~/.claude/control-tower/summaries.json`
  (keys `v2:<session>:<entryCount>:<state>`). Snapshot timestamps are milliseconds.
- Store tests use a hand-rolled fake summarizer (`available, lastError, lastRunAt, cached, isQueued, request`).
  It must track in-flight ids as a set: project summaries share the queue and would otherwise overwrite a single slot.

## Style

Dense, single-quoted ESM with semicolons; `.cjs` only for Electron's main process. Comments say why, not
what. Commit messages are one descriptive present-tense line, no conventional-commit prefix
(e.g. "Seen follow-ups stop counting, stricter waiting verdict, fleet beacon on mark, tab icon and tray"). Keep `docs/DESIGN.md` in step
when state rules or module responsibilities change.
