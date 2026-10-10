# Hooks

Control Tower works without any setup by reading the files Claude Code already writes. Hooks add the exact moment a session asks you something, waits for a permission, or finishes, instead of inferring it a few seconds later.

## Install

```sh
node bin/control-tower.mjs hooks install     # or click "Install hooks" in the page's settings
node bin/control-tower.mjs hooks status
node bin/control-tower.mjs hooks uninstall
```

Sessions started after installing pick the hooks up. Sessions already running need `/hooks` reload or a restart.

## What the hooks tell Control Tower

| Hook event | What Control Tower learns |
|---|---|
| `UserPromptSubmit` | A new turn started: any "needs you" or "finished" state is cleared |
| `Stop` | The turn ended, with the last message: the session is ready for a new prompt |
| `StopFailure` | The turn ended with an API error |
| `Notification` | A permission prompt, or a request for input, is showing in the terminal |
| `PermissionRequest` | Which tool is waiting for permission, or that a question dialog is open |
| `PreToolUse`, `PostToolUse` (matched to `AskUserQuestion`) | A question dialog opened or closed |
| `SubagentStart`, `SubagentStop` | An agent started or finished |
| `SessionStart`, `SessionEnd` | A session began or ended |

## What gets written

Install adds command hooks for those events to `~/.claude/settings.json` (or the settings under `CLAUDE_CONFIG_DIR`). Every hook runs the same script, `~/.claude/control-tower/hook.sh`: four lines of POSIX shell that copy the JSON Claude Code passes on stdin into a spool directory, writing a temp file and renaming it so every event lands atomically. The hooks are asynchronous and always exit 0, so they can never slow down or block a session.

The installer is careful with your settings: it refuses to touch a settings file it cannot parse, writes a backup next to it, keeps every hook you already had, and is idempotent, so installing twice leaves exactly one Control Tower hook per event. Uninstall removes only Control Tower's hooks.

## Without hooks

Control Tower falls back to Claude Code's busy/idle flag and the transcript. That still catches "finished" and "asked a question", a few seconds later and with less certainty, and it cannot see a permission prompt until the transcript moves on.
