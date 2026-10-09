#!/bin/sh
# claude-radar hook: copy the event JSON Claude Code gives us on stdin into a spool directory.
# The radar server tails that directory. Writing a temp file and renaming keeps every event atomic,
# so many sessions can fire at once. Always exits 0 so it can never block Claude.
d="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/claude-radar/events"
[ -d "$d" ] || mkdir -p "$d" 2>/dev/null || exit 0
t=$(mktemp "$d/.ev.$(date +%s).XXXXXX" 2>/dev/null) || exit 0
cat > "$t" 2>/dev/null && mv "$t" "$t.json" 2>/dev/null
exit 0
