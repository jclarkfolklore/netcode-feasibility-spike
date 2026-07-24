# Design Philosophy — Netcode Feasibility Harness

The governing standard for every screen in this app. Every UI change is checked against this
document; every rule here is written so an engineer can hold it against a screen and get a yes/no.

**What this app is:** a presentation-grade benchmark that answers one question — *"is
host-authoritative multiplayer feasible for this fighting game?"* — for a mixed-expertise team,
live, in a meeting, projected on a wall.

---

## 1. Core principle: the three-second page

**Anyone — including someone who has never heard the word "netcode" — must be able to glance at
any page for three seconds and correctly answer: (1) what is this page measuring, (2) has it run,
and (3) is the answer good or bad.** Everything else is one interaction away, never forced.

This yields a strict three-layer reading model. Every piece of content on every page is assigned
to exactly one layer:

| Layer | Time budget | What lives here | Form |
|---|---|---|---|
| **L0 — Glance** | 3 seconds | Page title, diagram, verdict, band color, the one decisive number | Diagram, verdict banner, stat tiles, band chips |
| **L1 — Skim** | 30 seconds | What this tests (≤3 sentences), control groups, result tiles, one-line caveats | Short prose, labeled groups, callouts |
| **L2 — Depth** | On demand | Why it matters, how to read, methodology, provenance, spec citations, raw tables | Accordions, "Show more" disclosures, tooltips, the PDF |

**Audience model.** Two readers, always both present:
- **The teammate** (product/art/production): reads L0 only, maybe L1. They must never hit
  jargon, internal spec citations, or a wall of prose before understanding the page. If they see
  a red band, they should trust it means "bad" without reading a word.
- **The engineer-skeptic**: needs L2 to believe the numbers — provenance, caveats, config,
  raw cells. L2 must exist and be complete, but *collapsed*. Hiding depth entirely would break
  trust; forcing it breaks comprehension. Progressive disclosure is how both readers win.

**Corollaries (mechanical rules):**
- Nothing at L0/L1 may contain an internal citation (`contracts.md §`, `research.md §`, `F14`,
  `008.x`). Citations live at L2 only.
- A page's decisive number, once measured, appears at L0 as a stat tile with a band color — never
  only inside prose.
- Every state a page can be in (never-run, running, has-data, failed) must *look intentional*.
  Empty is a designed state (see §6 Empty states), not an absence.

---

## 2. The primitive vocabulary

These are the only presentation primitives the app uses. Each has a defined job. When two could
work, use the one higher in this table (less interaction cost wins at equal clarity).

### 2.1 Typed callouts — `.callout[data-kind]`

A callout is a short (1–3 sentence) bordered block with an icon glyph and a tinted left edge.
It interrupts the reading flow on purpose — that is its job, so ration it: **max two callouts
visible per page** in the default state.

| Kind | Color | Means exactly | Canonical example | Do NOT use for |
|---|---|---|---|---|
| `info` | accent blue | Neutral context the reader needs *before* acting | "Both halves run on this page over a loopback pair. Press keys in either canvas." | Findings, warnings |
| `warning` | amber | **A validity caveat — this number is not what a naive reader would assume** | "Loopback — not a real network measurement. Open with `?room=<id>` on two machines for a real sweep." | Generic tips |
| `success` | green | A measured, positive finding | "Encode cost `0.004ms`/frame — far under the `16.67ms` budget." | Run-status (that's a chip) |
| `danger` | red | A measured, negative finding or a broken/failed state | "TCP p99 ballooned to `312ms` under 2% link-loss." | Hypothetical risks (warning) |
| `note` | grey | Aside/provenance a careful reader may want; lowest urgency | "Measured in-browser, not hardware glass-to-glass." | Anything decision-relevant |

Rules:
- The **loopback/solo caveat is always a `warning` callout** (or the amber `solo` mode badge in a
  run row) — never body prose, never italic small text.
- A callout body follows the prose-length rule (§4): ≤3 sentences. Longer → the callout carries
  the summary sentence and a "Show more" opens an accordion.
- Callouts never open pages: a caveat is never the first element in a results column (r04's
  "Fidelity caveat" accordion leading the E2E page is the anti-pattern).

### 2.2 Accordion — `details.section-collapsible` / `details.explainer-collapsible`

For **complete, self-contained secondary content**: methodology, build notes, advanced controls,
full narratives, raw tables. Collapsed by default, always.
- Use when the content is >3 sentences or is only relevant to the engineer-skeptic.
- Do NOT use for anything decision-relevant at L0/L1 (a verdict hidden in an accordion is a bug).
- Do NOT nest accordions more than one level.
- Summary text is a plain-language title (no citations, no sentences ending in periods).

### 2.3 Tooltip — `InfoTip` (ⓘ affix on a label)

For **per-control help**: one or two sentences on hover/focus explaining what a knob does and what
changing it will do to the result. Every interactive control gets one (§7).
- Tooltips are the ONLY primitive allowed to exist on every element — they cost nothing until
  summoned.
- Never put load-bearing caveats only in a tooltip (tooltips are invisible on a projector).
- Content pattern: *"What it is. What increasing it does."* — e.g. "Extra buffering before the
  guest renders a snapshot. Higher = smoother under jitter, but adds directly to felt lag."

### 2.4 Popover

For **click-summoned rich detail on a data element** (e.g. a scoreboard row explaining its
scoring math). Use sparingly; prefer an accordion when the detail is long or must be printable.
This app needs at most one popover pattern: "how was this score computed?" on Summary rows.

### 2.5 Alert (inline status strip)

A full-width one-liner tied to a *live condition* (server unreachable, companion channel
disconnected, run aborted). Appears/disappears with the condition; uses callout colors. Unlike a
callout, an alert reflects *current state*, not authored content. E.g. the Transport loss-proxy
"Unreachable" message becomes a `danger` alert, not a paragraph.

### 2.6 Stat tile — `MetricTile`

The canonical way to show **any measured number**: label (small caps) + big mono value + optional
band tint + source line. If a number matters, it is a tile; if it's in a sentence, it doesn't
matter (or the sentence is wrong — see §4).
- Live readouts (tick, felt lag p50/p95/p99, staleness, bytes) are tiles, not `<li>` lines.
- Tiles come in a `.metric-tile-grid`; never a lone floating tile among prose.

### 2.7 Band / verdict chips — `Band`, `.band-pill`

Traffic-light classification (`good`/`acceptable`/`bad`) and run-status (`completed`/`failed`/
`skipped`/`none`). Chips classify; they never carry the value itself (value lives in the tile
next to it). Status chips and band chips must not be visually identical to mode badges (§2.9).

### 2.8 Inline code — `<code>`

See §3. The rule is strict enough to apply mechanically.

### 2.9 Mode badge — `.run-mode-badge`

The mono pill next to a run button stating the run's provenance: `solo preview · simulated
network` (amber) vs `real · host half` (green). Every run button that can execute in either mode
carries one. This is the L1 version of the loopback warning.

### 2.10 Kbd caps — `<kbd>`

Every literal key name renders as a key cap: `<kbd>A</kbd>`, `<kbd>Shift</kbd>`, `<kbd>←</kbd>`.
Key mappings are presented as a two-row labeled grid (P1 row, P2 row), each binding a
`<kbd>` + tiny action label — never a prose run-on like "P1: A/D/S/F/G/Shift/Q".

### 2.11 Numbered steps — `.how-to-step` / ordered step list

Any procedure with a sequence (two-machine setup) is 1-2-3 numbered cards or an `<ol>` with
copyable code blocks — never paragraph prose with inline URLs.

### 2.12 Empty states — `.canvas-placeholder`, `.ghost-table`

Designed never-run states: a bordered 16:9 frame with a centered hint for canvases; a ghosted
header-only table listing the columns a run will fill for results. An empty region with a label
floating above nothing (r03/r04 canvases today) reads as a rendering failure and is forbidden.

---

## 3. The inline-code rule

Render as `<code>` (mono, tinted background, accent text — the existing `.md code` style,
promoted to a global `code` style so JSX doesn't need the Markdown wrapper):

1. **Identifiers**: class/function/field names — `NetFightScene`, `applySnapshot`, `chargeMs`.
2. **Config keys and values**: `role=guest`, `?room=my-room`, `maxRetransmits:0`, `link-loss`.
3. **Filenames and paths**: `FightScene.ts:163`, `vite.config.ts`.
4. **Metric names**: `p50`, `p95`, `p99`, `RTT`, `jitter`.
5. **Literal measured/limit values with units**: `120ms`, `16.67ms`, `64B`, `60Hz`, `2%`.

Why values too: **numbers in results must read as data, not as words in a sentence.** A p95 of
`48ms` set in mono pops out of a scanning eye's path; "48 milliseconds" in prose vanishes.

Exceptions (do NOT code-style): counts in ordinary prose ("four experiments", "two machines"),
band words (good/acceptable/bad — those are chips), product names (WebSocket, WebRTC, Phaser).

---

## 4. The no-wall-of-text rule

People in a meeting do not read paragraphs. Hard limits:

- **A visible prose block is at most 3 sentences / ~60 words.** Longer content must either be
  chunked (bullets, tiles, steps, labeled rows) or split into *summary + disclosure*.
- **The "summary + Show more" pattern**: first 1–3 sentences stay visible; the remainder moves
  into a `details.prose-more` disclosure directly beneath, whose summary reads "Show more". The
  visible sentences must stand alone (not end mid-thought).
- **A bullet is one sentence.** A bullet with three sentences is a paragraph wearing a disguise.
- **If a prose block contains ≥2 numbers, it should be tiles + one sentence instead.** The
  sentence carries the judgment; the tiles carry the numbers.
- Explainer "What this tests" blocks: exactly the ≤3-sentence summary visible; methodology
  detail goes into the existing "How to read the result" / "Why multiplayer needs it" accordions
  or a new trailing "Show more".

---

## 5. Page skeleton contract

All four experiment pages share one skeleton. Learning one page teaches the others.

```
┌────────────────────────────────────────────────────────────────┐
│ H2 title (plain language + parenthetical qualifier)            │
├───────────────────────┬────────────────────────────────────────┤
│ EXPLAINER (sticky)    │ WORK COLUMN                            │
│ 1. Diagram (framed,   │ 1. Session/mode context (chips or ONE  │
│    caption = moral)   │    warning callout — only if needed)   │
│ 2. "What this tests"  │ 2. LIVE DEMO section (if the page has  │
│    ≤3 sentences       │    one): control groups → run row →    │
│    + Show more        │    canvases/placeholder → readout tiles│
│ 3. ▸ Why multiplayer  │ 3. MEASUREMENT section: run row        │
│    needs it (closed)  │    (primary Run + Abort + mode badge)  │
│ 4. ▸ How to read the  │    → Result block (canonical, below)   │
│    result (closed)    │ 4. ▸ Advanced / diagnostics accordions │
└───────────────────────┴────────────────────────────────────────┘
```

Ordering rules:
- **The page's own primary Run button is the loudest element in the work column** (blue primary).
  Sidebar "Run all" stays secondary.
- Caveats never lead the column. Order is: context → do → see → dig.
- Accordions (advanced sweep, diagnostics, build notes, findings-in-plain-language) always come
  *after* the primary run/result, at the bottom.

**The canonical result block** (identical on all four pages — `ResultView` renders it):
1. **Verdict strip**: status chip + one-sentence verdict (bold judgment, first sentence only) +
   topology/loss as chips.
2. **Stat tiles**: the experiment's decisive numbers (p50/p95/p99, sizes, costs) with bands.
3. **▸ Details** accordion: full verdict prose, sub-score rows with rationale, caveat `note`
   callout, raw table (if any).

A `COMPLETED` chip followed by zero visible numbers is forbidden — if the number was measured
elsewhere (E2E host half), show a placeholder tile stating exactly where it lives ("measured on
guest → merged result").

---

## 6. Empty states & one run-state source of truth

- Run-state semantics are identical everywhere: **idle (grey) / running (amber, pulsing) /
  completed (green) / failed (red)** — driven from `RunStore` only. The sidebar dot, the Summary
  tiles/scoreboard, and any per-page chip must be the *same value rendered three ways*, never
  independently computed. Sidebar dots get `title` tooltips + a one-line legend.
- Canvas areas: `.canvas-placeholder` — bordered, 16:9 (matches `960×540`), dashed border,
  centered "Press **Start live demo** — real fight sim renders here" with the host/guest label
  *inside* the frame's top edge.
- Result areas: `.ghost-table` / ghost tiles — column headers or dimmed tiles with `—` values so
  the reader sees the shape of what a run produces before running.

---

## 7. Control affordance rules

- **Every interactive control** (input, select, checkbox, radio, slider, toggle) has: a visible
  label *above* it (not inline-left, not trailing colon), units in the label where applicable
  ("Simulated latency (ms)"), and an `InfoTip` tooltip (§2.3).
- **Related controls are grouped** into a named `.control-group` (a lightly-bordered fieldset
  replacement with a small-caps title): e.g. E2E gets "Roles", "Input timing", "Simulated
  network". A flat sheet of seven unlabeled inputs is forbidden.
- Option labels are values, not essays: a radio is `link-loss`; its explanation is group helper
  text below the options, or a tooltip. Select options show the value (`50ms`), not spec
  citations.
- Native fieldset/legend/checkbox chrome is restyled to the app's card/chip language — no stock
  UA borders beside styled cards.
- Buttons are **verb phrases ≤3 words** ("Run measurement", "Start live demo"); qualifiers become
  mode badges next to the button, never inside the label.
- Buttons are intrinsic width, side by side in a `.run-row` — never full-width stacked bars
  (r03's stacked full-width Start/Stop/Run/Abort is the anti-pattern).

---

## 8. Spacing & rhythm system

Use only the `--sp-*` scale. Assignments:

| Token | Use |
|---|---|
| `--sp-2` (8px) | Gap inside a chip row; label→input gap |
| `--sp-3` (12px) | Gap between sibling buttons in a `.run-row`; tile grid gap |
| `--sp-4` (16px) | Gap between a control group and the next; run row → result block; padding inside blocks |
| `--sp-5` (24px) | Gap between stacked sections in the work column; card padding |
| `--sp-6` (32px) | Between top-level page sections (Home) |

Hard rules:
- **No bare adjacent interactive elements.** Any two sibling buttons live in a `.run-row`
  (`gap: var(--sp-3)`).
- **A result/status block never touches its controls**: minimum `--sp-4` vertical separation
  (via the parent's flex `gap`, not ad-hoc margins).
- Chips never hug text: the `topology · loss` line and any chip row get `--sp-2` internal gap
  and `--sp-3` from neighbors.
- Every block in a column spans the column edge-to-edge, same corner radius (the consistency
  rule) — watch UA-margin elements (`figure`, `fieldset`, `ul`).
- One rhythm: work-column sections are separated only by the column's `gap: var(--sp-5)`; no
  per-section bottom margins fighting it.

---

## 9. Consistency contract across the four experiences

A user who learns Transport already knows Snapshot, E2E, and Determinism. Concretely, all four
pages must have:
- the identical skeleton (§5), the identical result block, the identical run-row pattern
  (primary Run + Abort + mode badge), the identical control-group pattern, the same
  callout/spacing/type system, the same empty-state treatments;
- diagrams of comparable size (near-square, filling the explainer column) each with a one-line
  "moral" caption (the TCP diagram's "A single lost packet is the whole story" is the model);
- "What this tests" blocks of comparable, ≤3-sentence length.
Any divergence needs a reason a teammate could repeat. "This page grew differently" is not one.

---

## 10. The fight-sim & demo standard

The live loop and every live demo must look like — and *be* — a real match, because the demo is
the emotional proof and the payload is the technical proof.

**On screen ("realistic" defined):** within 10 seconds of starting a demo, an observer sees real
fighters executing real moves — walking, punches (light/heavy), blocking, hits landing with
visible damage, meter building, and eventually a KO — with the HUD (health, confidence, special)
moving. Two idle sprites breathing is a failed demo. When no human touches the keyboard, a
**scripted demo-bot input sequence** drives both fighters through the same input seam a player
would use (E2E: `input` wire messages into `RemoteInput`; Snapshot: the public `Fighter` mutator
script, looped) so the fight sustains itself indefinitely. Human keys always override/join.

**On the wire (the honest payload):** the netcode transfers the real game's authoritative state —
the frozen `Snapshot` (contracts §3) captured from the live `FightScene` every tick:
`tick`, `hostTime`, `p1LastInputSeq`/`p2LastInputSeq`, `round`, `countdown`, `winner`, and per
fighter `x`, `vx`, `health`, `confidence`, `special` (meter), `state`
(idle/walk/attack/block/hitstun/ko), `facingRight`, `attackTimer`, `hitstunTimer`, `chargeMs`.
Demos must route this payload through the real codec path (encode → wire → decode → interp →
apply), so byte counts on screen are bytes actually applied — never a same-process object handoff
presented as networking.

**Honesty about gaps:** state the sim exposes but the schema does not carry (move identity /
`moveId`, damage-per-hit amounts, tween pose) is *documented as a finding* (a `warning` callout +
L2 detail), never silently patched by editing `src/` — that gap is itself a result of the spike.

**Reading the demo:** live readouts render as stat tiles (felt lag `p50/p95/p99`, staleness,
payload bytes, tick) plus per-fighter HUD mini-tiles (HP / meter / state) sourced from the
*received* snapshot on the guest side — visibly proving the wire carries the fight.

---

## 11. The checklist

Hold each screen against these; every answer must be yes.

1. Can a netcode-naive viewer answer "what/has it run/good-or-bad?" in 3 seconds?
2. Is every visible prose block ≤3 sentences, with depth behind a disclosure?
3. Zero internal citations (`contracts.md`, `research.md`, `F1x`, `008.x`) visible by default?
4. Is every measured number a mono `<code>`/tile value, never buried in a sentence?
5. Does every control have a label above it, units, a tooltip, and a named group?
6. Are all sibling buttons in a gapped `.run-row`, results ≥ `--sp-4` from controls?
7. Do never-run areas show designed placeholders (frames/ghost tables), not blank space?
8. Do the sidebar dot, page chip, and Summary agree on run-state (one source of truth)?
9. Is the loopback/solo caveat a `warning` callout or amber badge — present wherever a number
   could be mistaken for a real network measurement?
10. Does the page match the skeleton and canonical result block of the other three?
11. Does the demo show a real fight (moves, damage, KO) with the real `Snapshot` payload on the
    wire, and are payload bytes computed from the encoded form actually applied?
12. Is depth (methodology, provenance, raw cells) fully available within one interaction?
