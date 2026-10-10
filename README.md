# Control Tower

Air traffic control for [Claude Code](https://code.claude.com): every session on your machine, the agents each one has spawned, what they are doing right now, and which ones are waiting for you. One local page. Nothing leaves your machine.

![Control Tower: three projects, five sessions, a nested agent tree, and the drawer open on one session](docs/screenshot.png)

## Quickstart

You need Node.js 20 or newer and Claude Code installed and logged in. No npm install, no build step.

```sh
git clone git@github.com:AndreasArledal/control-tower.git
cd control-tower
node bin/control-tower.mjs                 # opens http://localhost:4747
node bin/control-tower.mjs hooks install   # optional: exact "needs you" and "finished" signals
```

Options: `--port 4747`, `--no-open`, `--no-summaries`, `--model haiku`.

## Menu bar app (macOS)

The quickest way to keep an eye on things: a standalone app in the menu bar, no terminal needed, optional start at login. Its icon is the tower, and the beacon on top is the fleet: hollow when nothing is running, filled while sessions are live, a halo when one needs you, with the count in the title.

```sh
cd app && npm install      # downloads Electron (about 100 MB), one time
npm run install-app        # builds Control Tower.app and copies it to /Applications
```

It is a normal app: it opens its window on launch, closing the window keeps it running, and the Dock icon, ⌘-Tab or the tray item bring it back; ⌘Q quits. The tray item lists sessions in its menu and has "Start at login" and "Menu bar only" toggles, the latter for a pure menu bar presence without a Dock icon. The app embeds the server, or attaches to a `control-tower` server already running on the port. It borrows your login shell's PATH so `claude` resolves when launched from the Dock. The build is unsigned, so it is meant for the machine it was built on; `npm start` runs it from source instead.

## What you see

- **One graph of everything live.** Each session is a node. Agents branch off it, and an agent's own agents off that. Sessions are grouped by project, each with a one-line headline of what the project is working on.
- **Four states.** Working (blue). Needs you (amber): a question or permission prompt is blocking the terminal, or the last reply left something with you. Ready (grey): the turn ended and it is waiting for a new prompt. Ended. Finished agents fold away after the three most recent.
- **Needs you, in the page only.** The status line counts sessions that need you; click it or press `n` for the list with reason and age. Those nodes get an amber ring and a quiet toast appears. No OS notifications.
- **Forgotten sessions do not get lost.** Every summary judges whether the last reply asked you something, offered options, or wants an approval. Such sessions read "needs you" however old they are, so a session you walked away from stays visible.
- **Drawer on demand.** Click a node for the summary (headline, goal, done so far, now, next, agents and their latest result), the stats (context used, turns, tool calls, model, effort), and the transcript one button away: a story view, or the raw log.
- **Resume anything.** Copy `cd <dir> && claude --resume <id>` for a session, or pick from the recent sessions of a project.
- **The beacon is the fleet.** The dot on the tower mark, and the tab icon, go hollow when no session runs, grey when all are ready, blue while anything works, amber when something needs you. Hover it for the counts.
- **Project filter.** Active (default) shows projects with something going on or used in the last hour. All shows everything. Click a project for just that one, shift-click to add.

## Hooks

Control Tower works without setup by reading the files Claude Code already writes. Hooks add the exact moment a session asks you something, waits for a permission, or finishes:

```sh
node bin/control-tower.mjs hooks install     # or click "Install hooks" in the page
node bin/control-tower.mjs hooks status
node bin/control-tower.mjs hooks uninstall
```

This adds command hooks to `~/.claude/settings.json` (a backup is written next to it) that run `~/.claude/control-tower/hook.sh`, a four-line POSIX script that copies the hook's JSON into a spool directory. The hooks are async and always exit 0, so they can never slow down or block a session. Existing hooks are preserved. Sessions started after installing pick them up; running ones need `/hooks` reload or a restart.

Without hooks, Control Tower falls back to Claude Code's busy/idle flag and the transcript, which still catches "finished" and "asked a question", a few seconds later and with less certainty.

## Summaries and cost

Haiku, through your own `claude` login, writes a structured summary when a session is first seen, when it finishes or needs you, and every few minutes while it works, plus the project headlines. It runs `claude -p` with every setting source, MCP server, tool and plugin stripped, a tiny system prompt and `--max-turns 1`. Measured cost is about $0.002 and 2 to 3 seconds per summary. Summaries are cached on disk by session and transcript position, so no state is summarised twice. Settings (⚙) switch between automatic, on request and off, set the refresh interval, and show what summaries have cost today and in total, from Claude's own accounting.

## Keys

`n` next session that needs you · `f` fit the graph (or toggle follow when the transcript is open) · `Esc` close · `+` `-` zoom · `r` raw transcript · `t` thinking · double-click empty canvas to fit · drag to pan, ⌘/ctrl-wheel to zoom.

## How it works

Claude Code writes everything Control Tower needs:

| Source | What it gives |
|---|---|
| `~/.claude/sessions/<pid>.json` | Live registry: session id, cwd, derived name, busy/idle |
| `~/.claude/projects/<cwd>/<session>.jsonl` | Full transcript, appended live: prompts, thinking, tool calls, results, usage |
| `.../<session>/subagents/agent-*.jsonl` + `.meta.json` | Each subagent's transcript, description, type, spawn depth, parent tool call |
| Hooks (optional) | `UserPromptSubmit`, `Stop`, `Notification`, `PermissionRequest`, `AskUserQuestion` pre/post, `Subagent*`, `Session*` |

The server (`server/`, zero dependencies) tails those files once a second, keeps a small model per transcript, and resolves each session to one state. The page (`web/`) is plain HTML, CSS and ES modules, fed by one server-sent-events stream and a small JSON API. Terminal focusing (WezTerm, iTerm2, Terminal.app, tmux, kitty) exists on the API but not in the UI. The module map and state rules are in `docs/DESIGN.md`; the visual system, with the rationale for every surface, is `docs/DESIGN-SYSTEM.md`.

Tests: `node --test`. The screenshot above comes from invented sessions, generated by `node scripts/demo.mjs`.

## Privacy

Control Tower binds to `127.0.0.1` only and rejects cross-origin requests, so other web pages cannot read your sessions or trigger actions. Transcripts are read from disk and served only to the page. Summaries send a bounded digest (prompts, last reply, recent tool names) to Anthropic through your own Claude login, the same place the session itself runs. That digest is untrusted text, so the summarizer runs with no tools and a single turn: the worst a malicious transcript can do is produce a wrong summary.

## Roadmap

- Other providers: the server only needs a reader per tool's on-disk format; the page and the state model are provider-neutral.
- Sign and notarize the menu bar app so a built copy can be shared.
- Per-session cost from transcript usage (the tokens are parsed already, nothing is priced yet).
- Several Claude configs at once: watch more than one `CLAUDE_CONFIG_DIR`, for example a work and a personal profile, in the same tower.
