# Claude Radar — UI Revamp

Design brief response. No application code here — specs for the developer to implement in `web/`.

---

## 1. What's wrong with the current layout

- **The chrome outweighs the content.** A fixed 272px sidebar + 440px detail panel reserve ~710px of a 960–1280px-wide half-monitor before a single graph node is drawn. On the narrow target viewport that's 60–75% of the width gone to things that aren't the visualization.
- **The detail panel is open by default and heavy.** Even with nothing selected it shows an empty-state block; once something is selected it's a full second dashboard (head, summary, 8-stat grid, 3 filter checkboxes, scrolling stream) competing for attention with the canvas at all times, not just when asked for.
- **The sidebar duplicates the graph.** Per-project state dots and counts already exist (or should exist) on the nodes themselves; maintaining them twice costs width and a second place to scan.
- **"Mark as seen" is an interaction the owner explicitly doesn't want.** The ack button, "mark all as seen," and the done→acked lifecycle add UI and a decision ("have I dealt with this?") that isn't needed — a finished session should just read as finished.
- **Nodes try to say too much at too small a size.** Title, activity, state label, context bar, token count and model id are crammed into a 300×80 box while the canvas around it is empty — not because nodes need more room, but because the surrounding chrome stole the room that should have gone to layout breathing space.
- **Attention has no single unmistakable focal point.** A pulsing node border, a toast stack bottom-right, and an "needs you" list top-left all compete; from across a room none of them reliably reads as "look now."

---

## 2. New layout

Principle: **two header strips, then the graph owns everything else.** No persistent side columns. Project selection moves into a compact horizontal chip rail. The detail/stream surface becomes an overlay drawer that only exists while something is open.

### 960×1080 (primary target)

```
0                                                              960
┌──────────────────────────────────────────────────────────────┐ 0
│ ● Radar   3 live · 1 agent running              ⬤12  ⚙        │  topbar, 0–44
├──────────────────────────────────────────────────────────────┤ 44
│ [ All ] [●.claude 2] [●worky 1] [○ai-enabl 1] [○dotfiles 1]›  │  project rail, 44–80
├──────────────────────────────────────────────────────────────┤ 80
│                                                                │
│                                                                │
│                        GRAPH CANVAS                           │  canvas, 80–1080
│                  (pan / zoom / the hero)                       │  = 1000px tall
│                                                                │
│                                                      [fit -+]  │  tools, floating
│                                                                │  bottom-right 12px
└──────────────────────────────────────────────────────────────┘ 1080

When a node is opened, a drawer overlays the right edge
(canvas stays rendered and visible underneath, no scrim):

0                                              560        960
┌───────────────────────────────────────────────┬──────────┐ 80
│                                                 │  DRAWER  │
│         graph still visible & pannable         │  400px   │
│         (560px remaining)                      │  wide,   │
│                                                 │  flush   │
│                                                 │  right + │
│                                                 │  bottom  │ 1080
└───────────────────────────────────────────────┴──────────┘
```

Pixel budget: topbar 44px, project rail 36px, canvas = remaining 1000px × full 960px width = **96% of vertical space, 100% of width** is graph when nothing is open. Drawer, when open, takes a fixed 400px slice (42% of width) and never changes canvas layout underneath it — the canvas doesn't resize or reflow, the drawer simply floats on top.

### 1600×1000 (must still work wide)

```
0                                                                                1600
┌────────────────────────────────────────────────────────────────────────────────┐ 0
│ ● Radar   3 live · 1 agent running                                    ⬤12  ⚙    │ topbar 0–44
├────────────────────────────────────────────────────────────────────────────────┤ 44
│ [All] [●.claude 2] [●worky 1] [○ai-enablement 1] [○dotfiles 1] [○another 0]     │ rail 44–80
├────────────────────────────────────────────────────────────────────────────────┤ 80
│                                                                                  │
│                                                                                  │
│                                GRAPH CANVAS — 1600×920                          │
│                                                                                  │
│                                                                                  │
│                                                                      [fit - +]   │
└────────────────────────────────────────────────────────────────────────────────┘ 1000

With drawer open, it caps at 460px max (doesn't keep growing with viewport),
so wide screens keep the graph dominant:

0                                                            1140         1600
┌─────────────────────────────────────────────────────────────┬──────────┐
│                graph, 1140px — plenty of room                │ DRAWER   │
│                                                                │ 460px   │
└─────────────────────────────────────────────────────────────┴──────────┘
```

Rule: `drawer width = clamp(360px, 42vw, 460px)`. On the 960px target that's ~400px; it never exceeds 460px, so extra width always goes to the canvas, not the drawer.

No breakpoint collapses the sidebar below the graph or stacks things vertically — because there is no sidebar left to collapse. The same three-region layout (topbar / project rail / canvas) works from 900px to 1600px+; only the drawer width and node density change.

---

## 3. Node design

Two node kinds: **session** (the hero object) and **agent** (subordinate, visually quieter). A third, minimal **fold** node represents collapsed finished agents.

### Session node — 256 × 96px

```
┌──────────────────────────────────────────┐ 0
┃ Claude process monitoring dashboard       ┃ 10   title, 13px/600, 1 line, truncated
┃ Bash: fix the fake store, rerun tests…    ┃ 30   activity, 12px/400, muted (or state
┃                                            ┃      color when blocking)
┃                                            ┃
┃ ● working · 2m     ▬▬▬▭▭ 61%  ⑂ 2         ┃ 80   footer, 11px/500 mono-ish
└──────────────────────────────────────────┘ 96
↑4px rail, full height, state color
```
Width budget: 12px padding each side → 232px of text room. Footer is three fixed slots: **state** (left, icon+label+age), **context** (center, 36px bar + %), **agent count** (right, only rendered if `agents.length > 0`, omitted entirely otherwise to recover room for sessions with no subagents — the common case).

Per-state mockups (rail + icon shown as `[x]`):

```
WORKING                              QUESTION (blocking)
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓       ╔══════════════════════════════╗  ← 2px pulsing
┃ Review claude-radar server… ┃       ║ Claude process monitoring…   ║    outer ring,
┃ ◐ Bash: running test suite  ┃       ║ ? Asks: which port to use?   ║    2.4s breathe
┃                              ┃       ║                               ║
┃ ● working · 36m   ▬▭▭ 61% ⑂2┃       ║ ? question · 4m    ▬▬▭ 72%  ║
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛       ╚══════════════════════════════╝
rail: blue #5B9BD9                    rail+ring: amber #E8A33D, "?" glyph
small rotating arc next to ◐           in a filled circle, card itself steady

PERMISSION (blocking)                 DONE (ready, calm — not urgent-red)
╔══════════════════════════════╗      ┌──────────────────────────────┐
║ Fix the fake store, rerun…   ║      │ Click-test the radar UI      │
║ ◆ Needs a permission decision║      │ Added screenshots, filed…    │
║                               ║      │                               │
║ ◆ permission · 1m  ▬▬▭ 50%   ║      │ ✓ finished · 6m    ▬▬▬ 88%  │
╚══════════════════════════════╝      └──────────────────────────────┘
rail+ring: same amber, "◆" glyph       rail: teal #4FAE8C, "✓" glyph,
(diamond, not "?") to read as a         NO pulse — finished is calm,
different kind of block at a glance     not an alarm. Stays this way
                                         until the user types again.

IDLE                                  EXITED
┌──────────────────────────────┐      ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ Hemnet AI strategy           │      ╎ Organization structure redes ╎  dashed border,
│ Waiting for your next prompt │      ╎ Session ended                ╎  70% opacity,
│                               │      ╎                               ╎  no rail glow
│ ○ idle · 28m       ▬▭▭ 42%   │      ╎ exited              ▬▬▭ 100%╎
└──────────────────────────────┘      └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
rail: gray #6B7585, hollow dot         rail: #454E60, hollow dashed dot
```

Why "question" and "permission" share a color family but different glyphs: both block the agent and deserve the same urgency tier and the same pulsing ring, but a developer glancing over should be able to tell "it's asking me something" from "it's stuck on a permission prompt" without opening anything — hence `?` vs `◆`, same amber.

Why "done" doesn't pulse: pulsing forever for a state that has no more urgency than "go read this when you want" trains the eye to ignore pulses. Reserve pulsing exclusively for the two states that block forward progress (question, permission). Done gets a steady ring and a calm, specifically non-green teal so it never reads as "success/go" (avoiding the acid-green-on-black AI-dashboard tell) — it reads as "available."

### Agent node — 192 × 60px

```
┌────────────────────────────────┐ 0
┃ code-reviewer                  ┃ 8    type/description, 12.5px/600
┃ Bash: running eslint           ┃ 24   activity or "finished 4m ago",
┃                                 ┃      11.5px/400 muted
┃ ◐ 18 tools · fork              ┃ 52   footer, 11px mono, muted
└────────────────────────────────┘ 60
↑3px rail
```
Agent states: **running** (blue rail, small rotating arc, same mechanism as session "working" but no pulse ring — nested work shouldn't compete visually with its parent session's state), **done** (teal rail, `✓`, steady), **idle / ended with session** (gray rail, whole node dropped to 70% opacity so a long list of ended agents visually recedes). Agents never get the amber blocking treatment — a sub-agent can't ask the user anything; if it needs a decision, that decision surfaces on its session.

If an agent has spawned further agents, append a small `⑂N` to the footer, matching the session's agent-count glyph, so nesting is visible without opening the node.

### Fold node (collapsed finished agents) — 192 × 32px

```
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
┆  121 more finished · show      ┆
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
```
Dashed, no fill, no rail — deliberately the quietest element on the canvas. Click expands in place (see §6).

---

## 4. Project selector & attention indicator

### Project chip rail (replaces the sidebar)

Single row, 36px tall, horizontally scrollable (momentum scroll, no visible scrollbar; a soft edge fade + small `›` affordance appears only when the rail overflows at 960px with 5+ projects).

```
┌────────┐ ┌────────────────┐ ┌───────────────┐ ┌────────────────────┐
│  All   │ │ ● .claude    2 │ │ ● worky     1 │ │ ○ ai-enablement  1 │ ›
└────────┘ └────────────────┘ └───────────────┘ └─────────────────────┘
 32×28       selected: filled   dot = worst-case   unselected: outline
 pinned      surface + strong   state color in     only, low-contrast
 first       border, not just   that project       border
             a color change     (amber>blue>teal>
             (accessibility:    gray)
             shape differs,
             not just hue)
```

Each chip: `● name  N` — dot (project's worst-case state, same color ramp as nodes), truncated name (max ~110px), session count. A small corner badge (filled amber circle, count if >1) appears on a chip only if that project has a session needing attention — same visual language as the topbar badge, so the eye already knows what it means before reading it.

Interaction: click = exclusive select (replaces selection, like today); shift/cmd-click = additive multi-select; "All" clears to show everything. Selecting re-fits the canvas. This is the same mental model as the current sidebar, just 36px tall instead of 272px wide.

### Attention indicator (the "across the room" signal)

Top-right of the topbar, always present, never a separate panel:

```
⬤ 12
```
- 26px filled circle, amber (`--blocking`), white count text, 13px/600.
- Zero attention items → badge isn't gone, it's a neutral hollow ring with no number (keeps the position stable so the eye doesn't have to re-find it when something appears) — or simplest: hide it entirely when 0 and let its absence be the signal; recommend **hide when 0**, since a dead/neutral badge sitting there at all times is itself a bit of generic-dashboard noise, and its sudden appearance is more noticeable than its sudden color change.
- **Steady pulse** while count > 0: scale 1 → 1.05 → 1 and shadow bloom, 2.4s ease-in-out loop (same rhythm as node blocking rings, so the whole UI "breathes" in sync).
- **Flash on increment**: when the count goes up while the page is open, a single sharp burst (scale 1 → 1.3 → 1, opacity ring expanding outward, 500ms, once) — this is the "notice it from across the room" cue; a one-off burst is far more detectable in peripheral vision than a constant pulse.
- Browser tab title keeps the existing `(N) Claude Radar` behavior — free extra channel, keep it.
- Click opens a **popover** (not a panel): anchored below the badge, ~320px wide, lists each attention item (project · state · title · one-line message · age), click jumps the canvas to that node and opens its drawer. Escape or outside-click dismisses. This replaces today's permanent "needs you" sidebar section with the same information, on demand.
- Keyboard `n` still cycles through attention items directly without opening the popover (fastest path for a developer who already knows the drawer-open workflow).

Toasts (kept, slimmed): one line, state-colored left edge only (no border box), max width 300px, bottom-right, stack max 3. "Blocking" toasts persist until dismissed or the session is opened; "done" toasts auto-dismiss after 20s, same as today. No "mark as seen" button anywhere — dismissing a toast only removes the toast, it does not change the node's state.

---

## 5. On-demand detail / stream surface

- **Open:** click (or `Enter`/`Space` when focused via keyboard) on any session or agent node. Clicking a different node while the drawer is open swaps its content in place — no need to close/reopen.
- **Size:** `clamp(360px, 42vw, 460px)`, full height from below the project rail to the bottom of the viewport, flush to the right and bottom edges, rounded top-left corner (8px) only, lifted off the canvas with a soft left-edge shadow — not a modal, not a scrim. The canvas underneath keeps rendering and is still pannable/zoomable; the drawer is a floating layer, not a layout column.
- **Close:** `Escape`, the `×` button top-right of the drawer header, or clicking empty canvas. Clicking the same (already-open) node again also closes it (toggle).
- **Contents, top to bottom** (condensed vs. today — no 8-cell stat grid, no three separate checkbox rows):
  1. Header: title, state pill (icon + label + age, same visual language as the node), compact meta line (`claude-f5 · pid 84070 · ~/.claude`), icon-only actions (resume-command copy, history) top-right next to the close button.
  2. One-line summary (or a small "Summarize" link if summaries are on but none exists yet). Never a multi-line block — if the model wrote more than one line, truncate with a tooltip, the full digest isn't worth drawer space.
  3. A single compact stat strip, one row, small caps-free labels under numbers: `260k context · 2 turns · 61 tools · 2 agents · fable 5.1 · 48m`. No grid, no borders — just inline `·`-separated groups, 12px.
  4. Stream filters as three small icon toggle buttons (thinking / tools / replies) + a follow toggle, one row, 28px tall total (down from the current 3-row checkbox block).
  5. The stream itself: identical entry model to today (prompt/thinking/tool_use/tool_result/text/notice, click-to-expand truncated bodies, "load earlier," agent links), flex-grows to fill remaining drawer height.
- **Agent view inside the drawer** mirrors the session view but drops the resume-command/history actions and adds "back to session" / "parent agent" links, same as current behavior — keep that logic, just inside the narrower drawer chrome.

Keyboard shortcuts (drawer-aware):

| Key | When drawer closed | When drawer open |
|---|---|---|
| `Escape` | clear canvas selection | close drawer |
| `Enter` / `Space` | open drawer for focused node | — |
| `f` | fit graph to view | toggle "follow" on the stream |
| `n` | jump to next attention item (opens its drawer) | same, replaces current drawer content |
| `+` / `-` | zoom canvas | same (canvas still receives these) |
| `t` | — | toggle thinking filter |
| `u` | — | toggle tools filter |
| `r` | — | toggle replies filter |
| arrow keys / `Tab` | move node focus across the graph | — |

---

## 6. Graph layout rules

- **Direction:** left-to-right tree, session → agents → nested agents, same model as today (it reads naturally and already matches "spawned by" causality). Keep per-project horizontal swimlanes (a thin group-label row: dot + project name + path + session count) only when more than one project is selected — with one project selected, drop the label entirely and reclaim the 28px.
- **Ordering:** sessions sort by urgency first — blocking (question/permission) → done → working → idle → exited — then by recency within a tier. This is unchanged from today's rank order and should stay: it means the first thing in reading order (top-left) is always the thing that needs you.
- **Spacing (tightened from current to fit 900–1300px well):** `SESSION_W=256, SESSION_H=96, AGENT_W=192, AGENT_H=60, COL_GAP=36, ROW_GAP=8, SESSION_GAP=24, GROUP_GAP=36`. At 960px width this comfortably fits a session + 2 columns of agents (256+36+192+36+192 = 712px) with margin to spare, and leaves room for a second project's lane below.
- **Folding:** keep running agents always visible; show the most recent **3** finished siblings (down from 4, to save vertical room at the primary viewport); fold the rest into a single dashed "N more finished · show" node (§3). Clicking it expands that subtree in place — it adds nodes to the existing canvas rather than opening a drawer or a separate list, keeping everything in one visual space. Re-fold is implicit: switching project selection or reloading resets to folded.
- **Very deep/wide trees (0–125 agents):** folding handles width (one folded node instead of 100+ siblings); for sessions with many running agents simultaneously (rare but possible), wrap agent columns into additional rows under the same parent rather than growing the column indefinitely tall — cap a single column at ~8 visible rows before wrapping to a second column at the same depth.
- **Fit to viewport:** auto-fit on initial load, on project-selection change, and available on demand via the `fit` button or `f`. Fit animates over 200ms (`ease-out`), clamps zoom to `[0.5, 1.15]` so small graphs don't blow up to an awkward giant single node.
- **Pan/zoom:** click-drag to pan (unchanged), `ctrl/cmd` + wheel or pinch to zoom anchored at the pointer (unchanged), plain wheel scrolls/pans (unchanged). Double-click empty canvas resets to fit. Dragging a node is not supported (layout stays deterministic/automatic) — this keeps the graph legible session over session instead of accumulating manual drift.
- **Nested agents (agent spawned by agent):** rendered as a further column to the right, same node style, same fold rules per parent — a sub-agent's own finished children fold independently of its siblings.

---

## 7. Design tokens

### Color (dark; base, not neon)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#12161F` | page background |
| `--bg-canvas` | `#0D1017` | graph canvas (darker than page so nodes pop) |
| `--surface` | `#1B212C` | session node fill, drawer background |
| `--surface-agent` | `#171C24` | agent node fill (recedes vs. session) |
| `--border` | `#2B3342` | default node/panel border |
| `--border-strong` | `#3C4557` | hover/selected border |
| `--text` | `#ECEAE4` | primary text (warm off-white, not pure white) |
| `--text-muted` | `#9099AC` | secondary text |
| `--text-faint` | `#5B6477` | tertiary / de-emphasized |
| `--working` | `#5B9BD9` | working / running |
| `--blocking` | `#E8A33D` | question, permission, attention badge |
| `--ready` | `#4FAE8C` | done / finished (muted teal, deliberately not green-on-black) |
| `--idle` | `#6B7585` | idle |
| `--exited` | `#454E60` | exited |
| `--error` | `#E8605A` | tool errors |
| `--thinking` | `#9C8CD1` | thinking entries in the stream only |

### Type

Keep **IBM Plex Sans** (UI) / **IBM Plex Mono** (code, ids, stats) — it's already integrated, has a slightly technical/schematic character that suits a process monitor, and distinguishes itself from the generic Inter/system-font look of most AI dashboards. No alternative proposed.

| Role | Size / weight |
|---|---|
| Topbar brand | 15px / 600 |
| Drawer heading (h2) | 16px / 600 |
| Session node title | 13px / 600 |
| Agent node title | 12.5px / 600 |
| Body / activity lines | 12–13.5px / 400 |
| Node footer, meta, stats | 11–11.5px / 500, mono for numbers/ids |
| Project chip | 13px / 500 |

No all-caps labels anywhere (including section/kind labels in the stream — keep them lowercase as today: `you`, `thinking`, `tool`, `result`).

### Spacing & radii

8px base grid with a 4px half-step: `4, 8, 12, 16, 20, 24, 32, 36`. Node internal padding 10–12px. Radii: **4px** on nodes (slightly schematic/technical, not a soft rounded card), **8px** on the drawer's single exposed corner, **999px** (pill) only for the attention badge and state pills — reserving full-round shapes for status indicators makes them stand out from the mostly-square node language instead of blending into generic rounded-card sameness.

### Motion

| What | Duration / easing | Notes |
|---|---|---|
| Blocking ring pulse (question/permission nodes, attention badge) | 2.4s ease-in-out, infinite | opacity/shadow only, never the whole card scaling |
| Attention badge increment flash | 500ms, once | scale + expanding ring, the "notice from across the room" cue |
| Working activity glyph (small arc) | 1.2s linear, infinite | tiny, localized to the glyph, not the card |
| Edge flow (active tool-call edges) | 1.2s linear, infinite | unchanged from today |
| Drawer open/close | 180ms, `cubic-bezier(.2,.8,.2,1)` | transform translateX, no opacity fade needed since there's no scrim |
| Fit-to-view | 200ms ease-out | pan + zoom interpolation |
| Node state-change notice | 400ms, once | brief ring-opacity flash when a node's state actually changes, so live transitions are noticeable even outside the pulse states |

`prefers-reduced-motion: reduce`: disable every `infinite` animation above. Blocking states fall back to a **static 2px solid ring** (instead of pulsing) plus the glyph, which is still unmistakable without motion. The attention-badge increment flash becomes an instant color swap instead of a scale burst.

---

## 8. Implementation priority for the developer

1. **Remove the sidebar and detail columns from the grid**; make `.layout` a single canvas region. Delete "mark as seen" / `ack` / `ack-all` UI and wiring (keep the server endpoints if other things depend on them, but nothing in the UI should call them).
2. **Project chip rail**: build it from the existing `renderProjects` logic, just restyled as a horizontal scroller in the header area; keep the existing click / shift-click multi-select logic in `app.js` as-is, only the markup/CSS changes.
3. **Attention badge + popover**: replace the `.attention` sidebar section with the topbar badge and its popover; port `renderAttention`'s item markup into the popover body; add the increment-flash animation (compare previous vs. new `snap.attention.length` in `onSnapshot`).
4. **Re-skin nodes** in `graph.js`/`styles.css` to the new dimensions and footer layout (state+icon / context bar / agent count); add the glyph markup (`?`, `◆`, `✓`, hollow/dashed circles) and the two-tier pulse rule (ring-only pulse for blocking, no pulse for done).
5. **Drawer**: convert `.detail` from a grid column to a `position: fixed/absolute` overlay panel with the slide transition; trim its internal markup per §5 (single stat strip, icon filter row); keep `stream.js` entirely as-is, it already does the right thing.
6. **Tighten graph spacing constants** in `graph.js` (`SESSION_W/H`, `AGENT_W/H`, gaps) per §6, drop `RECENT_FINISHED` from 4 to 3.
7. **Keyboard shortcuts**: extend the existing `keydown` handler in `app.js` for the drawer-aware bindings in §5 (`t`/`u`/`r` filter toggles, context-sensitive `f`).
8. **Reduced-motion fallbacks**: audit every new `@keyframes` against `prefers-reduced-motion` per §7; this is new work, today's CSS only disables two animations.
9. **Color token swap**: update `:root` to the new hex values in §7 (also update the light-theme media query block with equivalent light equivalents, following the same hue relationships).
10. **Polish pass**: toast restyle (slim, left-edge color only), empty-states copy unchanged, verify the 1600px behavior (drawer max-width clamp) and the 900px lower bound (chip rail horizontal-scroll affordance).
