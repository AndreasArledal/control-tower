# Header: final design

**Decision:** no counter pill, no per-project counts. The status line gains a third segment, text only, amber, that *is* the attention indicator. Click it (or press `n`) to open a "Needs you" list beneath it. The project rail is a plain text-link filter: dot + name, no numbers — it can't read as a notification if it carries none.

## Row 1 — topbar, 44px, `.topbar`

```
0                                                              960
┌──────────────────────────────────────────────────────────────┐
│ ⊙ Radar ●   3 working · 1 ready                           ⚙  │ (a) nothing needs you
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ ⊙ Radar ●   3 working · 1 ready · 2 need you ⌄             ⚙ │ (b) open
│                                  ┌───────────────────────┐    │
│                                  │ Needs you          ×  │    │
│                                  ├───────────────────────┤    │
│                                  │ ◐ worky · question    │    │
│                                  │   which port to use?  │    │
│                                  │   4m                  │    │
│                                  ├───────────────────────┤    │
│                                  │ ◆ .claude · permission│    │
│                                  │   fix store, rerun…   │    │
│                                  │   1m                  │    │
│                                  └───────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

Row 2 — project rail, 36px, unchanged under both states:
```
│  Active   All   ● worky   ○ .claude   ○ ai-enablement  ›     │
```

## Specs

**Status line** (`#status`): 13px/500 `--text-muted`, segments joined by `·`. "working"/"ready": dot + muted text. "N need you" renders only when count > 0: 13px/600 `--blocking`, no background, `⌄` caret (rotates on open), pointer cursor. Hover: `background: var(--surface-2)`, 4px radius. This is `#attention-badge`, moved inside `#status`, out of `.topbar-right`.

**Needs-you popover** (`#attention-pop`): 280px, anchored via the segment's `getBoundingClientRect()` — `top: bottom+6px`, `left: left`. `--surface` bg, `--border-strong` border, 6px radius. Header "Needs you" 12.5px/600, `×` close. Item: glyph (`?`/`◆`, `--blocking`), `project · reason` 13px/500 `--text`, message 12px/400 `--text-muted` truncated, age 11px mono `--text-faint`. Row hover `--surface-2`. A new unseen item gets one 500ms color flash on arrival (reuse `flash` keyframe, color not scale), then steady — no infinite per-row pulse. **Open:** click segment or `n`. **Close:** `×`, `Escape`, outside click, or picking an item (opens its drawer).

**Project rail** (`.chip`, `#rail`): 13px/500. Unselected `--text-muted`, no border/background. Hover: `--text` + `background: var(--surface-2)` + 4px radius — clickable without a tab look. Selected: same pill, persistent, replacing today's bottom-border tab style. Chip = 6px state dot + name (~110px truncated). No count, no corner badge.

## Implementation (6 steps)

1. `renderStatus()`: add working/ready/needsYou counts; render needsYou as inline `<button id="attention-badge">` inside `#status`, omitted at 0. Remove old `.topbar-right` badge markup.
2. `styles.css .badge`: swap pill rules for inline-text (color + hover background, no `999px` radius, no scale); keep `flash` keyframe but drive color/background.
3. Pop positioning: compute `#attention-pop` `top/left` from `#attention-badge.getBoundingClientRect()`, replacing the fixed corner rule.
4. `renderAttentionPop()`: extend item template with reason/message/age; diff previous vs. new `snap.attention` in `onSnapshot` to add a one-time `unseen-flash` class per new item.
5. `renderRail()`: delete the `<span class="n">` count and `.n.attn` badge markup from the chip template; keep the dot only.
6. `styles.css .chip`: drop `border-bottom` tab styling on `.chip.selected`; use `background: var(--surface-2); border-radius: 4px;` for hover (transient) and selected (persistent).
