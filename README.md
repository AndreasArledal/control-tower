# Control Tower

Air traffic control for [Claude Code](https://code.claude.com). One page that shows every Claude Code session on your machine, the agents each one has spawned, what each of them is doing and thinking right now, and which ones are waiting for you.

Nothing leaves your machine. Control Tower only reads the files Claude Code already writes under `~/.claude`.

```
┌ ▲ Control Tower  4 live · 2 agents running                          ⬤2  ⚙ ┐
├ [All] [● .claude 2] [● worky 1] [○ ai-enablement 1] [○ dotfiles 1] ┤
│                                                                    │
│  worky   Improving market strategy and package pricing             │
│  ┌ session ───────────┐──┌ agent ────────┐                         │
│  │ title              │  │ code-reviewer │                         │
│  │ what it does now   │──└───────────────┘                         │
│  │ ? question · 2m    │──┌ agent ────────┐   ┌ drawer, on demand ┐ │
│  └────────────────────┘  │ click-test UI │   │ title · state     │ │
│                          └───────────────┘   │ summary · stats   │ │
│  ai-enablement   Developing the AI strategy  │ reasoning stream  │ │
│  ┌ session ───────────┐                      │ you / thinking /  │ │
│  │ ...                │                      │ tools / replies   │ │
└──└────────────────────┘──────────────────────└───────────────────┘─┘
```

## What you get

- **The graph owns the page.** Two thin strips on top (status, project chips), then the canvas. Each session is a node; subagents branch off it, nested agents off their parent. The page speaks four states: working (blue), needs you (amber: a `?` or `◆` with a pulsing ring when a prompt blocks the terminal, a dashed ring when the last reply asked you something), ready (grey: the turn ended and it is ready for a new prompt; the summary says where it stands) and ended. There is deliberately no "finished" for sessions, since a model reading one reply cannot know whether you intend to continue. Agents do read finished, which is a fact. Finished agents fold into one "N more" node after the three most recent.
- **Project headlines.** Each project gets a one-line "what is this project working on" above its sessions, written by the summariser from its live sessions (or built from session titles when summaries are off). The project filter under the status line is plain text: `Active` (the default) shows projects with something going on or used in the last hour, `All` shows everything, click a project name for just that one, shift-click to add. The dot next to a name is its worst state; the filter carries no counts.
- **Drawer on demand.** Click a node and a panel slides over the right edge, without reflowing the graph. It leads with the summary: headline, goal, done so far, now, next, and the agents with their latest result, refreshed every few minutes while the session works. Stats (context used, turns, tool calls, model and effort) sit under the title. The transcript is one button away: a story view with your prompts and Claude's replies in full and the tool work folded into one line per step, or the raw log (`r`); thinking on request (`t`). Click the node again or press `Esc` to close.
- **Forgotten sessions.** Every summary also judges whether the last reply left something with you (a question, options, an approval). Such sessions read "needs you" in amber even when they look idle, count in the badge, and keep their project in Active however old they are, so a session you started and walked away from does not quietly get left.
- **Copy resume command** (`cd <dir> && claude --resume <id>`) and **recent sessions** per project, so a finished session can be reopened or read.
- **Needs you**, in the page only: the status line grows an amber "N need you" segment; click it (or press `n`) for the list of sessions with the reason and age, and pick one to open it. New items flash once. Nodes that need you get an amber ring, and a quiet toast appears when a session turns to you. Opening a session, clicking its item, or picking its project marks it seen, which only stops the pulse.
- **Summaries**: Haiku, run through your own `claude` login, writes the structured summary for a session when it is first seen, when it finishes or needs you, and every few minutes while it works, plus the project headlines. Automatic, on request, or off, and the refresh interval, in settings. Settings also shows what summaries have cost today and in total, from Claude's own accounting. About a fifth of a cent each.
- **Menu bar app** (macOS, optional): the same thing in your top bar with the count of sessions that need you.

## Requirements

- Claude Code installed and logged in (that is the only real prerequisite; it is also what powers summaries).
- Node.js 20 or newer. No npm dependencies for the server or the web page.

## Run it

```sh
git clone <this repo> control-tower
cd control-tower
node bin/control-tower.mjs            # opens http://localhost:4747
```

Options: `--port 4747`, `--no-open`, `--no-summaries`, `--model haiku`.

### Hooks (recommended)

Control Tower sees sessions, transcripts and agents without any setup. To learn the *exact* moment a session asks you something, waits for a permission, or finishes, let it register a few Claude Code hooks:

```sh
node bin/control-tower.mjs hooks install     # or click "Install hooks" in the page
node bin/control-tower.mjs hooks status
node bin/control-tower.mjs hooks uninstall
```

This adds command hooks to `~/.claude/settings.json` (a backup is written next to it) that run `~/.claude/control-tower/hook.sh`, a four-line POSIX shell script that copies the hook's JSON into a spool directory. The hooks are async and always exit 0, so they can never slow down or block a session. Existing hooks are preserved. Sessions started after installing pick them up; running ones need `/hooks` reload or a restart.

Without hooks, Control Tower falls back to Claude Code's own busy/idle flag and the transcript, which still catches "finished" and "asked a question" but a few seconds later and with less certainty.

### Summaries and cost

Summaries are produced by `claude -p` with every setting source, MCP server, tool and plugin stripped, a tiny system prompt and `--max-turns 1`. Measured cost is about $0.002 and 2 to 3 seconds per summary on Haiku. They are cached on disk by session and transcript position, so a session is never summarised twice for the same state. Set the top bar to *on request* or *off* if you want zero spend.

### Menu bar app (macOS)

```sh
cd app && npm install      # downloads Electron (about 100 MB)
npm start
```

The tray item shows `2 need you` or the number of working sessions, lists sessions in its menu, and opens the dashboard in a window. If a `control-tower` server is already running on the port, the app attaches to it instead of starting another.

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

The server (`server/`) tails those files incrementally once a second, keeps a small model per transcript, and resolves each session to one state: `working`, `question`, `permission`, `done`, `idle` or `exited`, plus a follow-up flag from the summariser's verdict. Terminal focusing is available on the API (`POST /api/session/<id>/focus`, WezTerm/iTerm2/Terminal.app/tmux/kitty, `focusCommand` setting) but not in the UI, since WezTerm cannot switch workspaces from the CLI. The page (`web/`) is plain HTML, CSS and ES modules, fed by one server-sent-events stream and a small JSON API. No build step. The design system, with the rationale for every surface, is `docs/DESIGN-SYSTEM.md`.

Run the tests with `node --test`.

## Privacy

Control Tower binds to `127.0.0.1` only and rejects cross-origin requests, so other web pages cannot read your sessions or trigger actions. Transcripts are read from disk and served only to the page. Summaries send a bounded digest (prompts, last reply, recent tool names) to Anthropic through your own Claude login, the same place the session itself runs.

## Roadmap

- Other providers: the server only needs a reader per tool's on-disk format; the page and the state model are provider-neutral, which is why the name no longer says Claude.

- Package the menu bar app as a signed `.app` so it needs no Node at all.
- Windows and Linux tray.
- Per-session cost from transcript usage.
