# Control Tower - Design System

**This document replaces `docs/UI-REVAMP.md`, `docs/TREE-LAYOUT.md` and `docs/HEADER.md`. Delete them.** Their good decisions (no sidebar, drawer overlay, top-pinned tree, bus edges, text-only needs-you segment, no counter pills) are carried here; everything else is superseded.

Owner feedback 1-10 is honoured throughout: seen by clicking, no button; recent sessions and copy-resume stay; summary first, transcript on demand; model and effort on every node; one column; nothing moves on refresh; four session states; no "paused"; working is the loudest thing on screen; no count badges.

---

## A. Review of the current UI

It reads as patchwork because three rounds each added a component with its own rules. Specifics:

**Ten font sizes, two families, no scale.** 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 17. A session node alone uses four treatments (Sans 600 title, Sans 400 activity, Mono 11 faint model line, Sans 500 footer with a Mono percent). Mono is sprinkled on counts, model names, ages and stats, so it means nothing.

**One blue means six things.** `--working` is the brand mark, the working state, every link, the "Now" paragraph, the Bash tool category, the focus ring and the primary button. In the drawer, "Now" and "Activity" are both blue and both look like links.

**Five radii** (3, 4, 6, 8, 999) across controls that sit 40px apart: 4px chips, 6px popover, 8px drawer corner, 999px state pills, 3px kbd.

**The working node is a different component, not a state.** Tinted fill, 2px blue stroke, 6px rail, glow, blue activity text, white title, spinner: seven signals. Needs-you uses a separate amber ring at -3px. Ready drops to 70% opacity and looks disabled rather than calm.

**Nodes are cramped at the top and empty in the middle.** The title wraps to two lines because the "6 agents" pill steals 70px; a one-line title leaves a 30px hole between activity and model line. The `context ▬ 61%` cluster is Mono 11 at 50% contrast, so the number the owner asked about is the least legible thing on the card.

**Finished agents at 62% opacity** make 90% of the canvas look disabled. The dotted-grid background is a generic node-editor tell and adds noise under 11px text.

**Drawer header is a chip wall.** Seven boxed stats in two ragged rows; "5 errors" in red is the loudest element for a session that is working fine. The footer wraps into two rows (two buttons, then "Transcript" alone right-aligned). With the transcript open there are four rows of chrome between summary and stream. Recent sessions renders inside the summary slot with a "back" link inside a heading, under stats that belong to a different view, and prints "13596 KB".

**Filter row** has a 12px grey "Show" label, two modes (Active/All) styled identically to project picks, and a native checkbox "ended" floating in the canvas tool cluster. Three dot sizes (6, 7, 8) appear in the status line, chips and group labels.

**Settings** uses native OS `<select>` elements and prints "$0.948" and "$0.95" in one sentence.

**Fit** clamps zoom to 0.5: in `header-needs-you.png` the whole graph is 9px text.

---

## B. Design intent

Control Tower should feel like a quiet instrument panel beside a terminal: monochrome and still by default, where colour only ever means a state and motion only ever means Claude is doing something right now. The one memorable element is the **light rail**: a state-coloured bar on the left edge of every node that, on a working session, is wider, breathes, and spills light into the card and down the edges to its running agents, the one lit window on a dark street. Everything else is text on one flat background.

---

## C. Tokens

### Colour

Dark is the default and follows the system; a light theme with the same roles exists (`@media (prefers-color-scheme: light)` and `[data-theme="light"]`), and settings has a theme switch (follow system / light / dark, stored in the browser). Both palettes keep text at or above 4.5:1 on their surfaces; `--text-3` is `#808A99` dark and `#6B7585` light for that reason, and `--ended` is `#6B7383` dark so ended labels stay legible.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0D1117` | page and canvas, one flat colour, no grid |
| `--surface` | `#1B212B` | nodes, drawer, popovers, toasts |
| `--surface-2` | `#252D38` | hover, selected chip, prompt bubble, selects |
| `--line` | `#313B49` | hairlines, node stroke |
| `--line-strong` | `#485363` | bus trunk, popover border, buttons |
| `--text` | `#E8E6E1` | primary |
| `--text-2` | `#9AA3B2` | secondary |
| `--text-3` | `#808A99` | tertiary, labels, ages |
| `--working` | `#5EA2E6` | working / running; the only blue |
| `--needs` | `#F0A93B` | needs you (question, permission, follow-up) |
| `--ready` | `#52B08E` | ready for a prompt; finished agents |
| `--ended` | `#6B7383` | ended sessions and agents |
| `--error` | `#E5655F` | tool errors, disconnected |
| `--thinking` | `#A394D9` | thinking rows only |
| `--link` | `#B9C3D3` | text links, underlined; never blue |

Rule: a state colour appears only on rails, glyphs, dots, edge stubs, state labels and the needs-you text. Never on fills, titles or body text, with one exception: the activity line of a needs-you node is `--needs`.

### Type

IBM Plex Sans for everything; IBM Plex Mono only for session ids, paths, the resume command, tool names in story rows, raw bodies and `kbd`. **No mono on the canvas.** Numbers use `font-variant-numeric: tabular-nums`.

| Step | Size / line | Weight | Use |
|---|---|---|---|
| xs | 11 / 16 | 500 | labels, ages, footers, counts |
| s | 12 / 16 | 400 | activity lines, meta, story steps |
| m | 13 / 20 | 400 · 600 | body, chips, node titles (600) |
| l | 15 / 20 | 600 | drawer title, headline, empty-state title |
| xl | 18 / 24 | 600 | brand only |

Letter-spacing 0 everywhere. No caps. No half-pixel sizes.

### Spacing, radii, elevation

Spacing: 4, 8, 12, 16, 24, 32, 40. Radii: **3** (kbd, context bar), **6** (everything else), **10** (drawer top-left corner only). No pills; the only round shapes are 6px state dots and the 12px glyph circles.

Elevation: canvas flat; drawer `border-left: 1px --line` + `box-shadow: -8px 0 24px rgba(0,0,0,.45)`; popovers and toasts `1px --line-strong` + `0 8px 24px rgba(0,0,0,.5)`.

### Motion

| What | Spec |
|---|---|
| hover / colour | 120ms ease |
| drawer, popover, toast enter | 160ms `cubic-bezier(.2,.8,.2,1)`, translate 12px + opacity |
| canvas pan/zoom (fit, centre) | 200ms ease-out |
| working rail breathe | 2.4s ease-in-out infinite, opacity .55 to 1, rail and glow only |
| running edge flow | 1.2s linear infinite, dash offset |
| spinner glyph | 1.2s linear infinite |
| needs-you arrival | one 600ms ring expand on the node; one 500ms background flash on the status segment |
| state change | one 400ms stroke flash (`.changed`) |

Nothing else loops. Needs-you never pulses continuously; working is the only thing alive. `prefers-reduced-motion: reduce`: every infinite animation off (rail static at full opacity, static arc, solid edges); enters are instant; `animateTo` already snaps.

---

## D. Surfaces (960 wide)

### Top bar 44px, status line, needs-you list

```
x:0  16   38      112                                                 916 944
┌────────────────────────────────────────────────────────────────────────┐ 0
│  ▲ Control Tower  ● 1 working  ·  ○ 2 ready  ·  ● 2 need you ⌄         ⚙  │
└────────────────────────────────────────────────────────────────────────┘ 44  border-bottom 1px --line
   mark 18px; its beacon IS the fleet: hollow --text-3 ring when no session runs, --ready filled when all are ready, --working with the 2.4s breathe while anything works,
   --needs when something waits for you, --error (name in --text-3) when the connection is lost. Precedence in that reverse order. The tooltip spells it out ("2 working · 1 ready").
   The favicon carries the same beacon colour; the macOS tray carries it as shape (hollow, filled, haloed).
   "Control Tower" xl. Status: m/500 --text-2; dot 6px in state colour; "·" --text-3 with 12px gaps.
   "2 need you": m/600 --needs, 28px tall hit area, radius 6, hover --surface-2, caret rotates when open.
   The number is what still needs you: blocking prompts plus unseen follow-ups. Unseen: its dot is filled; all seen: hollow 1px ring.
   When nothing needs you but seen follow-ups remain, the segment reads "asked you" in --text-2/500 with a --text-3 ring, so the list stays reachable.
   Settings: 28×28 icon button, --text-2, hover --text.

Needs-you list (click the segment), left-anchored to it, top = segment bottom + 6, width 320:
┌──────────────────────────────────────────┐
│ Needs you                              × │ head 36px, m/600, hairline below
├──────────────────────────────────────────┤
│ ?  ai-enablement · has a question    1m  │ row 48px, padding 8 12; glyph = 12px filled --needs circle (◆ for permission, hollow ? for follow-up)
│    Which port should the server use?     │ title m/500; message s --text-2 one line; age xs --text-3
│ ?  worky · in the last reply         4m  │ hover --surface-2; seen rows: title --text-2
│ SEEN                                     │ divider xs/500 uppercase --text-3, only when seen follow-ups exist
│ ?  atlas · in the last reply        1h   │ seen follow-ups live here: read notifications, out of the count
└──────────────────────────────────────────┘ radius 6, elevation 2
```

### Project filter row 36px

```
x:0  16                                                                  944
┌────────────────────────────────────────────────────────────────────────┐ 44
│ ┌──────┬─────┐ │ ┌● .claude┐ ┌● ai-enablement┐ ┌● worky┐        ┌○ ended┐│
│ │Active│ All │ │ └─────────┘ └───────────────┘ └────────┘        └───────┘│
└────────────────────────────────────────────────────────────────────────┘ 80  border-bottom 1px --line
   Segmented control 24px tall, 1px --line-strong box, selected half --surface-2 --text, other --text-2.
   Separator 1px × 16px --line, 12px each side. No "Show" label.
   Chip: 24px tall, 1px --line border, radius 6, padding 0 10, gap 6, m/500 --text-2, 6px dot (project's worst state).
   Hover: border --line-strong, --text. Selected: --surface-2 fill, border --line-strong, --text.
   The border at rest is what says "clickable". Max width 160, truncate. No counts. Overflow: edge fade, no scrollbar.
   "ended" is the same chip at the far right: hollow dot off, --ended dot on. Replaces the canvas checkbox.
```

### Canvas

Flat `--bg`, 24px margin, projects in one column, groups 40px apart, no spine. Fit clamps zoom to **[0.75, 1]**; the canvas scrolls instead of shrinking. Constants: `SESSION_W 300, SESSION_H 104, AGENT_W 224, AGENT_H 64, FOLD_H 28, COL_GAP 40, ROW_GAP 8, SESSION_GAP 24, GROUP_GAP_Y 40, LABEL_H 28`. Canvas tools bottom-right: `−  +  fit` in one 28px cluster, `--surface`, 1px `--line`.

```
Group label row 28px                                                        x=24
● .claude   Redesigning the dashboard UI                      2 sessions
8px dot (worst state) · name m/600 · headline m --text-2 truncated · count xs --text-3 only if >1

Session node 300×104 (rail 4, text x=16, right padding 16)
x: 0 4 16                                         212   284 300
   ┌─┬──────────────────────────────────────────────────────┐ 0
   │▌│ Claude process monitoring dashboard        6 agents  │ 24  title m/600 ONE line, ellipsis; count xs --text-3 ("2 of 6" when running)
   │▌│ Bash: capture a full set of current screensh…        │ 44  activity s --text-2
   │▌│ fable 5.1 · high effort                              │ 66  xs/500 --text-3 (sans)
   │▌│ ◠ working · 2m                context ▬▬▬▭▭  61%     │ 90  glyph 12px at x=22; label xs/500 state colour; "context" xs --text-3; bar 56×4 radius 3 at x=212; % xs --text tabular
   └─┴──────────────────────────────────────────────────────┘ 104  radius 6, 1px --line, fill --surface; context tooltip "61% of 200k"

WORKING                      NEEDS YOU                    READY                        ENDED
┏━┳━━━━━━━━━━━━━━━━━━━━━━━┓  ┌─┬───────────────────────┐  ┌─┬───────────────────────┐  ┌╌┬╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
┃▌┃ Title           3 of 6┃  │▌│ Title         5 agents│  │▌│ Title         3 agents│  ╎▌╎ Title                 ╎
┃▌┃ Bash: run the tests   ┃  │▌│ Asks: which port?     │  │▌│ v0.5 artifact is final│  ╎▌╎ Ended 36m ago         ╎
┃▌┃ fable 5.1 · high      ┃  │▌│ opus 5.5 · xhigh      │  │▌│ fable 5.1 · high      │  ╎▌╎ opus 5.5 · xhigh      ╎
┃▌┃ ◠ working · 2m  ▬▬ 61%┃  │▌│ ? needs you · 4m ▬ 57%│  │▌│ ○ ready · 12m   ▬ 26% │  ╎▌╎ ◌ ended · 36m   ▬ 57% ╎
┗━┻━━━━━━━━━━━━━━━━━━━━━━━┛  └─┴───────────────────────┘  └─┴───────────────────────┘  └╌┴╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
rail 6px --working,          rail 4px --needs,            rail 4px --ready,            rail 4px --ended,
breathes; stroke 1.5px       stroke 2px --needs solid,    stroke --line, opacity 1,    stroke dashed 4 3,
--working 60%; drop-shadow   no glow, no pulse; glyph     hollow 10px --ready circle;  whole node opacity .55,
0 0 14px --working 35%;      "?" in filled 12px circle    activity = summary headline  dashed hollow glyph.
fill --surface + 5%          (permission ◆, follow-up     or "Ready for a new prompt".
--working; spinner glyph.    hollow ?); activity --needs.
Selected (any state): extra 1.5px --text ring at -3px, radius 8. Arrival into needs-you: ring expands once, 600ms.

Agent node 224×64 (rail 4, text x=14)
   ┌─┬───────────────────────────────────┐ 0
   │▌│ Redesign the header strip       │ 20  m/600 one line
   │▌│ Bash: run eslint                  │ 38  s --text-2; finished: "finished · 38m"
   │▌│ ◠ 21 tool calls      ⑂2  sonnet 5 │ 54  xs/500 --text-3; glyph at x=19; "⑂N" only with children; model right-aligned
   └─┴───────────────────────────────────┘ 64
   running: rail --working, stroke --working 50%, spinner. finished: rail --ready, ✓ glyph, opacity .75. ended: dashed, opacity .5.

Fold node 224×28: no fill, 1px dashed --line-strong, radius 6, xs/500 --text-3 "3 more finished · show" / "show less". Always last in its column.

Edges: parent stub 20px, trunk at COL_GAP/2, --line-strong 1.5px, 6px corners. Child stub: --working + flow when running,
--line-strong when finished, dashed 50% into the fold. Anchor y = node top + 32 at both ends.
```

### Drawer 400px (`clamp(360px, 42vw, 440px)`, y=80 to bottom, radius 10 top-left)

```
┌──────────────────────────────────────────────┐ 0   padding 16
│ Claude process monitoring dashboard        × │ 20  l/600 one line; × 28px icon button
│ ◠ working · 48s · fable 5.1 · high effort    │ 44  s/500 state colour, then --text-2
│ claude-f5 · ~/.claude                        │ 60  s --text-3, mono
│ 61% context · 16 turns · 187 tools · 7h 30m  │ 84  xs --text-2, numbers --text tabular; "· 5 errors" in --error only if >0. One row, no boxes.
├──────────────────────────────────────────────┤ 96  hairline
│ Dashboard header redesigned; click bug found │ 120 headline l/600, max 2 lines
│                                              │
│ now                                          │ label xs/600 --text-3, 16 above, 4 below
│ Header redesign committed; bug in node       │ body m --text
│ selection identified by click-tester.        │
│ ◠ Bash: capture screenshots for the review   │ live activity s --text-2 + spinner, working only; not blue
│                                              │
│ next                                         │ label and body --needs when needsYou
│ Decide whether to fix the selection bug…     │
│                                              │
│ done so far                                  │
│ • Initial dashboard built                    │ m --text-2, show 4, then "+3 more" link
│ • Header redesigned per spec                 │
│                                              │
│ goal                                         │ last; it rarely changes
│ Build a local service to monitor Claude…     │
│                                              │
│ agents · 2 of 6 running                      │
│ ● Redesign the header strip        38m     │ rows 28px: 6px dot, m --text truncated, age xs --text-3 right
│ ● Design the session tree layout     5h      │ hover --surface-2; click opens agent view; all agents, scrolls
│ ○ Critique UI screenshots      6h      │
│ summary from 4m ago · refresh                │ xs --text-3; "refresh" / "write one now" = --link
├──────────────────────────────────────────────┤ hairline
│ [⧉ Copy resume]  [⟲ Recent]      [≡ Transcript] │ footer 48px, one row; buttons 28px, 1px --line-strong, radius 6, s/500
└──────────────────────────────────────────────┘
No summary yet: "latest request" / "latest reply" sections in the same style, then "write one now".
Agent view: header type · fork · in <session>; stats "12k context · 21 tools · 4m"; sections now / result; footer [← Session] [↑ Parent] [≡ Transcript].

Transcript open: summary pane keeps headline + now only (max-height 120, scrolls), footer stays, then:
│ ┌Story┬Raw┐   thinking                 follow ●│ toolbar 36px: same segmented control as the filter row; "thinking" and "follow" are chips (on = --surface-2 fill)
├──────────────────────────────────────────────┤
│ you · 1m                                     │ label xs --text-3
│ ┃ The header is better, but we need a full   │ prompt: --surface-2 box, 2px --text-2 left bar, radius 6, padding 8 12, m
│ claude · 38s                                 │
│ Understood. Piecemeal fixes have left a…     │ reply m --text, markdown
│ 4 steps · Bash ×2, Read · 24s                │ work group: label xs --text-3; 2px --line left bar; --error bar on error
│   Bash   capture screenshots for review  24s │ step: tool mono xs --text-3 (Write/Edit --needs, error --error), what s --text-2, age xs; Agent steps get an "open agent" --link
│   Read   read web/app.js                 23s │ click expands args/result in --bg boxes, mono xs
│ Load earlier                                 │ --link, top of list
Raw rows: 2px left bar by kind (prompt --text-2, thinking --thinking, tool --line-strong, error --error, notice none); label xs --text-3; body mono xs, 4 lines, click expands.

Recent sessions view (replaces body; stats hidden; footer = [← Back]):
│ ← Recent in .claude                          │ l/600; arrow is the back button
│ Claude process monitoring dashboard   ● live │ rows 48px: title m/500 + 6px --working dot + "live" xs; hover --surface-2
│ 23 min ago · 16 turns · 13.3 MB              │ xs --text-3, human-formatted sizes
```

### Settings popover 320px, under ⚙, right-aligned

```
│ Settings                                   × │ head 36px
│ Summaries                     [automatic ⌄]  │ rows 32px; label m; select: appearance none, --surface-2, 1px --line, radius 6, 28px, chevron icon
│ Refresh while working         [every 4 min⌄] │
│ Haiku via your claude login. Today: 104, $0.95 │ xs --text-3; always two decimals
│ ● Hooks installed: exact "needs you" signals. │ xs --text-3, --ready dot; or sentence + [Install hooks] 28px button --surface-2
│ n next needs you   f fit   e ended   t think │ two-column grid, kbd + xs --text-2
│ r raw   1–9 project   0 active   Esc close   │
```

### Toasts (bottom-left, 300px, stack ≤3, gap 8)

```
┃ worky · needs you                          × │ 3px state bar, --surface, 1px --line-strong, radius 6, padding 8 12
┃ Approve or select which of the eight…        │ title s/500; message s --text-2 one line
needs-you: persists until clicked or seen. ready: auto-dismiss 15s. Click = focus session + seen.
```

### Empty states

Centred, max-width 360: title l/500 `--text`, body m `--text-2`, `code` in `--surface-2`. "No Claude Code session is running / Start one with `claude` in any project…". "Nothing running in this project / Pick another project above, or turn on ended."

---

## E. Interaction rules

**Selection.** Click a node: open its drawer; click the selected node or empty canvas: close. Switching nodes swaps the drawer in place. `Esc` closes a popover first, then the drawer. Selection never changes layout.

**Seen.** A needs-you item is seen when its node is opened, its toast is clicked, it is picked from the needs-you list, or its project chip is clicked exclusively. There is no button. For a blocking prompt, seen only affects the status-line dot, the toast and the list row tint: the terminal is still stuck, so it keeps counting. For a follow-up, seen means read: it leaves the count and the Active rule, moves under the list's "seen" divider, and its node returns to ready with an "Asked you: …" line. A new ask from the same session is a new item, unseen again. Marking seen never animates anything.

**What moves a row.** Sessions keep their first-seen order within a project; urgency is shown by colour, not position. New sessions append at the bottom of their project.

**What moves the canvas.** Only: fit (`f`, double-click, button), filter change, opening a session that is off-screen (from `n`, the list, a toast, or recent sessions), and zoom. **Never:** snapshot refresh, selection, seen, drawer open/close, agent state change, fold expand (nodes insert in place; the user pans).

**Keyboard.** `n` opens the next unseen needs-you session directly (cycles; the list is mouse-only). `f` fit, always. `Shift+F` follow. `+`/`-` zoom. `e` toggle ended. `1`-`9` pick the nth project, `0` Active. `t` thinking, `r` story/raw (drawer open). `Enter`/`Space` on a focused node opens it; `Tab` walks nodes. `Esc` as above.

---

## F. Implementation order

### Rewrite `web/styles.css` from scratch

1. `:root` tokens from §C only (`--bg` … `--link`, `--font`, `--mono`, `--ease`, `--topbar-h: 44px`, `--rail-h: 36px`, `--drawer-w`). Delete the light-theme block and `--surface-agent`, `--idle`, `--exited`, `--blocking`, `--border*`.
2. Base: `body` m/20, `tabular-nums`; `code, .mono, kbd`; `button.link` as `--link` underline; focus ring `--working`; `select` with `appearance: none` and an inline chevron.
3. `.topbar`, `.brand .mark-dot` driven by `.live-on/.live-off`, `.status .st`, `.status button.needs` (filled/hollow dot via `.unseen`), `.icon-btn` 28px.
4. `.rail`: `.seg` + `.seg-btn` (shared with the transcript toolbar), `.rail-sep`, `.chip` bordered, `.chip.selected`, `.chip.ended`.
5. `.canvas-wrap` flat (no `background-image`), `.canvas-tools` three buttons.
6. Graph: `.group-label`, `.gdot`, `.bus`, `.edge.running/.finished/.more`, `.node rect.box/.rail/.ring`, session classes `.working .needs .ready .ended`, agent classes `.running .finished .ended`, `.node.selected`, `.node.changed`, `.node.arrived`, `.node.more`, `.ctx-bar/.ctx-fill`, text classes `.title .sub .meta .foot .count`. Keyframes: `breathe`, `flow`, `spin`, `arrive`, `notice` only.
7. `.drawer`, `.drawer-head` (`.row`, `.meta`, `.where`, `.stats` as one inline row), `.drawer-summary` (`.headline`, `.sec h3`, `.sec.now`, `.sec.next.attn`, `ul.agents` rows, `.when`), `.drawer-foot` single row, `.act` 28px, `.drawer.transcript-open .drawer-summary { max-height: 120px }`.
8. `.stream-tools` (reuse `.seg`, `.chip`), `.stream`, `.story` + `.step` + `.thought`, `.entry` raw rows, `.history` view, `.popover`, `.pop-head`, `.att-item`, `.toast`.
9. `@media (prefers-reduced-motion)` disabling the five keyframes and the three enter animations.

### Markup changes

10. `web/index.html`: remove `#live-dot`; give `.mark-dot` `id="live-dot"`. Remove the `ended` label from `.canvas-tools` (the rail renders it). Replace the `#follow` checkbox with `<button class="chip" id="follow">follow</button>`; make `#thinking-toggle` a `.chip`. Settings popover: add a `.pop-head`, a hooks dot, and a `.keys` grid.
11. `web/graph.js`: constants from §D. `sessionNode`: drop `pill()`; render the count as `<text class="count">` right-aligned at y=24; title one line via `fit()`; activity y=44; model row y=66 as `.meta` (sans); footer y=90 with the `context` label, 56px bar at x=212, `%` in `.foot`. Map `uiState` to `working/needs/ready/ended` (`paused` → `ready`, `exited` → `ended`); `glyph()` cases `working, question, permission, followup, ready, ended, running, finished`. `.ring` only for `.selected` and the one-shot `.arrived`. `agentNode`: rows at y=20/38/54, model right-aligned, `⑂N` before it; classes `running/finished/ended`. `moreNode` h=28. `anchorIn` y = top + 32. Remove the `spine` line and the dotted grid from the group template.
12. `web/app.js`: `renderStatus()`: dot markup per segment, `.unseen` on the needs button; `setConnected()` toggles `.live-on/.live-off` on the mark. `renderRail()`: segmented Active/All, no "Show" label, bordered chips, trailing `ended` chip bound to `state.showExited`. `renderSessionHead()`: meta row = state · age · model · effort; where row = id · path; stats as inline spans; summary order headline, now (with the live activity line inside), next, done (4 + "more"), goal, agents (all, no cap), when. `renderAgentHead()` same structure. `showHistory()`: own `.history` view with `← Recent in …` head, `[← Back]` footer, hidden stats, `formatBytes()`. Spend string: `toFixed(2)` everywhere. Keyboard: `n` opens the next unseen attention session directly; `f` always `fitView()`; `F` follow; `e` ended; digits select chips. `fitView` clamp `[0.75, 1]`. `focusSession()` already centres only when off-screen; keep.
13. `web/stream.js`: story step classes reduce to `cat-write` (Write/Edit) and `cat-agent`; drop `cat-shell/cat-read/cat-ask`. Raw `renderEntry` unchanged apart from classes.
14. Delete `docs/UI-REVAMP.md`, `docs/TREE-LAYOUT.md`, `docs/HEADER.md`.
