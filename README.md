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

**Summaries use your Claude account.** Each one is a small Haiku call through your own `claude` login, about $0.002 or a few hundred tokens of your plan's usage, every few minutes while a session works, plus once when it finishes or needs you. Start with `--no-summaries`, or set them to on request or off in settings, if you would rather spend nothing. See [Summaries](docs/summaries.md).

## What you see

- **One graph of everything live.** Sessions grouped by project, agents branching off each session, and a one-line headline per project.
- **Four states, four symbols.** A spinning arc while working, a nudging speech bubble when a session needs you, a blinking cursor when it is ready for a prompt, a dashed square when ended. The same symbols everywhere: nodes, status line, lists. The tab icon and the menu bar show the fleet's state.
- **Needs you, in the page only.** A count in the status line, an amber ring on the node, a quiet toast. Sessions whose last reply asked you something stay visible until you have looked at them. No OS notifications.
- **A summary at a glance.** Click a node for what the session is doing, what it has done, what comes next, its agents, and the full transcript one button away.

## Mac app

A desktop app with the server built in: the dashboard in its own window, a tower in the menu bar whose beacon is the fleet, optional start at login. On first launch it offers to install the hooks.

```sh
cd app && npm install      # downloads Electron (about 100 MB), one time
npm run install-app        # builds Control Tower.app and copies it to /Applications
```

## Docs

- [Using the app](docs/using-the-app.md): states and their symbols, the graph, needs you and seen, the drawer and transcript, filters, keys. The same however you run it.
- [Mac app](docs/mac-app.md): install, the window and the menu bar tower, beacon states, toggles.
- [Hooks](docs/hooks.md): what hooks add, install and uninstall, what is written to settings.json, the fallback.
- [Summaries](docs/summaries.md): what gets summarised and when, the waiting verdict, what it costs in tokens, caching.
- [How it works](docs/how-it-works.md): data sources, server and page, tests, the demo fixture.
- [Design](docs/DESIGN.md) and [design system](docs/DESIGN-SYSTEM.md): the internals and the visual rationale.

## Privacy

Control Tower binds to `127.0.0.1` only and rejects cross-origin requests. Transcripts are read from disk and served only to the page. Summaries send a bounded digest to Anthropic through your own Claude login, the same place the session itself runs, with no tools and a single turn. Details in [Summaries](docs/summaries.md#privacy).

## Roadmap

- Other providers: the server only needs a reader per tool's on-disk format; the page and the state model are provider-neutral.
- Sign and notarize the Mac app so a built copy can be shared.
- Per-session cost from transcript usage (the tokens are parsed already, nothing is priced yet).
- Several Claude configs at once: watch more than one `CLAUDE_CONFIG_DIR`, for example a work and a personal profile, in the same tower.
