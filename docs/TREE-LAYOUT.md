# Tree Layout Spec — Session/Agent Graph

Fixes the "placed randomly" read of the current tidy-tree. Centering a parent on
its children makes its y-position depend on child count, so sessions jump around
with no visible rule. Below, "centered" becomes "pinned," fanned curves become a
schematic bus, and position is predictable before it's read.

## 1. Vertical alignment: top-pinned, not centered

Each session is **top-pinned to its row's baseline**; its agent column starts at
that same top y. Neither moves to accommodate the other's size.

- Row top `y0` is fixed per row.
- Session box: `(x0, y0, 300×110)`. Edge anchor (right-middle) =
  `(x0+300, y0+55)`, constant regardless of agent count.
- Agent column starts at `x0+336` (`300+COL_GAP`), top-aligned at `y0`, agents
  stacked downward with `ROW_GAP` between.
- Row height = `max(110, agent-column-height)`; next row starts at
  `y0 + rowHeight + SESSION_GAP`.

```
0 agents         1 agent              3 agents            8 agents
┌───────────┐    ┌───────────┐┐       ┌───────────┐┌────┐ ┌───────────┐┌────┐
│  SESSION  │    │  SESSION  │┘──┐    │  SESSION  ││ A1 │ │  SESSION  ││ A1 │
└───────────┘    └───────────┘   └───┐└───────────┘├────┤ └───────────┘├────┤
                                  ┌──┐│             │ A2 │              │ A2 │
                                  │A1│┘             ├────┤              ├────┤
                                  └──┘              │ A3 │              │ A3 │
                                                     └────┘              ├────┤
                                                                         │ …  │
                                                                         ├────┤
                                                                         │ A8 │
                                                                         └────┘
```

Nested agents follow the same rule one level deeper — the grandchild column
top-aligns to the parent agent's own top, never centered on grandchildren:

```
SESSION ──▶ A1 (parent) ──▶ B1
                        ──▶ B2
         ──▶ A2
```
A1's position is unaffected by whether B1/B2 exist; A2 never shifts.

## 2. Edge routing: elbows on a shared trunk, not fanned curves

Replace the fanned bezier (curvature changes with sibling count, which reads as
noisy) with an **orthogonal bus**: one vertical trunk per parent, shared by
every child.

Geometry, split symmetrically across `COL_GAP=36`:
- Stub out from the parent: 18px horizontal from its fixed anchor.
- Trunk: vertical line at the gap's midpoint, spanning
  `min(parentAnchorY, topChildAnchorY)` to `max(parentAnchorY, bottomChildAnchorY)`
  — always long enough to pass through the parent's own attach point, so there's
  never a dangling offshoot.
- Stub in to each child: 18px horizontal from trunk to child's left-middle.
- Corners: 6px rounded quarter-circles — engineered, not drafted-with-a-ruler
  sharp, not organically curved either.

Color split: the **trunk is neutral** (`--border-strong`) — it's wiring, not
state. Only the final stub into a child is state-colored: solid `--working`
blue with the existing flow-dash animation for running agents, solid muted
`--text-faint` for finished, 40%-opacity dashed `--text-faint` into the fold
node. Neutral trunk, colored stations — a subway-map convention that keeps many
children reading as organized, not tangled.

## 3. Fold node placement

Move it to the **bottom** of the column, not the top. Putting it first (today's
behavior) puts the least-important item first in reading order. Running agents
should be the first thing hit.

Look: dashed border, no fill, no rail, `224×32`, `--text-faint` text, centered
`"N more finished · show"`.

Expand: folded agents insert in place, most-recent-first, directly above the
fold line. The fold node then either disappears (nothing left) or becomes a
`"show less"` footer in the same dashed style at the same bottom slot —
collapse is the mirror of expand, not a different position.

## 4. Agent ordering & demotion

Top to bottom: **running agents first** (chronological among themselves), then
up to 3 most-recent-finished (most-recent first), then the fold node last. Do
not interleave running and finished by timestamp — that interleaving is a
second source of the current "shuffled" feeling.

Demote finished agents tonally, not structurally: opacity 0.6, border drops to
`--border` (from `--border-strong`), no glyph pulse, rail desaturated. Keep the
node size identical (224×62) so the column's alignment grid never depends on
state — demotion is purely visual weight, not layout.

## 5. Spacing constants

Node sizes unchanged. `COL_GAP=36` (18+18 split by the trunk), `ROW_GAP=10`
between siblings, `SESSION_GAP=24` between session rows (up from 22, since
centering no longer signals a row break), `GROUP_GAP_Y=36` between projects,
`LABEL_H=30`.

## 6. Project groups

Add a 1px `--border` vertical rule at `x=-16` spanning the group's full height
— a quiet spine, not a box. Align the label row's dot to the session rail's x
so label, rail, and spine share one plumbline. Spacing unchanged: first session
starts at `y=LABEL_H`.

## 7. Scaling to many running agents

Running agents can't fold away (they're live): cap a column at **8 rows**,
then wrap into a second column at the *same depth*, feeding the *same trunk*
via a short secondary bus. Use a **tighter 12px gap** between wrapped columns
(vs. 36px between depths), so wrapping reads as "more of the same children,"
not a deeper nesting level.
