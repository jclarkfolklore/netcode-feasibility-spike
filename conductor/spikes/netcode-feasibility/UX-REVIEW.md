# UX Review & Execution Spec — Netcode Feasibility Harness

**Status: PRESCRIPTIVE EXECUTION SPEC (round 2).** The governing standard is
[`DESIGN-PHILOSOPHY.md`](./DESIGN-PHILOSOPHY.md) — every work item below cites the rule(s) it
satisfies (referenced as `DP §n`). Reviewed against fresh full-page screenshots
`.ux-shots/r01-home.png` … `r06-summary.png` (2026-07-23) and the current source.

Audience: an Opus engineer executing directly. No item here is optional or exploratory; where a
choice existed, it has been made. Work ONLY inside `conductor/spikes/netcode-feasibility/`;
`src/game/**` is imported read-only (the `NetFightScene extends FightScene` /
`SnapshotHostScene` seams are the only bridge). Gates per commit: `npm run build` +
`npm run lint` (0 err) + `npm test` (all pass) + re-screenshot into `.ux-shots/`.

---

## PROGRESS / HANDOFF

Implementation lives in the isolated spike repo (own git). Commits `ux-1`…`ux-5` done. Dev
server: `npm run dev` → localhost:5173.

### ✅ DONE & committed (round 1 — preserve, do not regress)
- **#1 Purge internal jargon from titles/labels** — `contracts.md §`, `research.md §`, `F14–F16`,
  `008.x` removed from accordion titles, control labels, headings (ux-1). *(Body prose still
  contains them — see W5.2.)*
- **#2 E2E control cluster** — rebuilt as a labeled `.field-grid` (ux-2).
- **#5 Diagrams** — all four rewritten/enlarged near-square; caption clipping and overlap fixed
  (ux-2, ux-3, ux-5). The four diagrams are now GOOD — do not rework them this round.
- **Completed/status chips** — `completed` = green success chip, distinct from grey (ux-3).
- **Accordion gaps** — `.experience-layout-controls` flex-gap (ux-3).
- **Quick wins** — primary blue page Run buttons; shortened run labels + solo/real mode badge;
  nav label "Remote input (E2E)"; duplicate Summary "Download PDF" removed; Summary
  eyebrow/weights copy trimmed (ux-1, ux-4).

### 🔁 CONSISTENCY RULE (unchanged, applies everywhere — now DP §8/§9)
Containers and items inside each column must have consistent widths — every block fills the
column edge-to-edge, same corner radius. Watch UA-margin elements (`figure`, `fieldset`, `ul`).

### 🔲 SPACING AUDIT (unchanged, now formalized as DP §8 — executed in W6.1)
No bare adjacent interactive elements; every button pair in a gapped `.run-row`; ≥`--sp-4`
between a run row and its result/status block; chips never hug text.

### 🥊 FIGHT-SIM REQUIREMENT (unchanged, now formalized as DP §10 — executed in W1)
Live loop & demos run a REAL fight (real moves, damage, KO) and the netcode transfers the REAL
game-state payload. Constraint reconciliation unchanged: no edits outside the spike dir,
read-only `src/game/**`, everything via the harness-side subclass seam. Gaps the frozen schema
can't carry (move identity, per-hit damage amounts, tween pose) are documented findings, never
silent `src/` patches.

---

## EXECUTION SPEC — waves

Execute waves in order; each wave ends with build+lint+test green and fresh screenshots.
Later waves depend on Wave 0's primitives.

### ✅ EXECUTED (round 2) — verified, do not regress
- **W0 — primitives** (commit `ef8483b`): `Callout`, `InfoTip`, `ControlGroup`, global `code`/`kbd`,
  `.canvas-placeholder`/`.ghost-tile`/`.ghost-table`, native-control restyle, canonical `ResultView`
  (verdict strip + `tiles?` prop + Details accordion).
- **W1 — realistic fight sim** (commits `f39c202`, `673d3eb`): `demoBot.ts` drives both demos with a
  looping real fight (moves/blocks/damage/meter/KO, self-sustaining, human keypress pauses it 5s).
  Snapshot honesty fix (`encodeBinary→decodeBinary→apply`; bytes shown = bytes applied). Both demos
  show felt-lag / payload stat tiles + a "from wire" per-fighter HUD. **Two latent bugs fixed:**
  (1) `GuestInputScene` was never started by Phaser → the solo E2E demo never sent guest input at all
  (now started in `bootE2EGuestGame`; also fixes real two-machine guest input); (2) input ingestion
  now gated on `host.isFighting` so countdown-era inputs don't drain as multi-second stale felt-lag.
  Verified in-browser: both fighters fight, E2E felt lag ~60ms p50 / n>300, 0 console errors.
- **W2 — demo modal** (commit `9966072`): `useDemoModal` + `.demo-modal`; Expand ⤢ promotes the
  mounted canvases into a fixed stacked overlay; Esc/backdrop/✕ close. Verified canvas never lost.
- **W3 — Summary scoreboard** (commit `818f340`): 4-row scoreboard (name · banded score · chip ·
  takeaway · status), narrative demoted to collapsed accordion (still in print), caveat → note
  Callout, headline empty → ghost strip, clear confirms. Verified empty + filled.
- **W4 — run-state SoT + empty states** (commit `d176be4`): `RunStore.runState` consumed by Nav +
  scoreboard; dot legend; canvas-frame hints + ghost result strips on all four pages.
- **W5/W6 (partial)** (commit `864cca7`): E2E rebuilt into 3 `ControlGroup`s + 6 tooltips, solo→
  warning / provenance→note Callouts, fidelity caveat moved to bottom; Snapshot demo controls
  grouped + tooltips + fidelity chunked w/ move-identity warning Callout; Snapshot/Determinism
  run-rows + mode badges; all results in `.result-block`.

### 🐛 FIX — Snapshot demo: make characters MOVE so the round trip + latency are visible (user-reported)

**Clarified purpose (user):** this demo exists to *visually* show the **round trip** — two clients
(host = authoritative "now"; guest = render-only, ~RTT + interp behind) depicting the **same fight
state**, and the **latency between them**. The viewer should see the guest doing the same thing as
the host, just slightly later — that "same state, offset in time" is the whole point.

**What's wrong now:** the host canvas is busy but the guest **looks dead**. The guest IS applying
every snapshot (confirm via the "from wire" HUD updating), but `driveSnapshotDemo`'s choreography is
almost all **pose/animation** (attack lunges, blocks, charge rings, hit-flashes) with almost **no
horizontal movement** — and pose/tween is exactly what `state-only` can't carry. So the transferable
state barely changes → the guest has nothing visible to mirror → reads as broken, and the round-trip
/ latency story never lands. User also notes **`redrive-mutators` mode looks correct** (it re-runs
the pose functions, so the guest animates too) — the confusion is really the `state-only` default.

**Fix:**
- **Drive real transferable MOVEMENT.** Make `driveSnapshotDemo` walk the fighters around the stage
  (advance/retreat, cross, reposition), plus knockback on hits and clear HP-bar drain / meter fill —
  so BOTH canvases show fighters moving, and the guest visibly reproduces that movement a beat later.
  Movement (X position) is the field that transfers, so it's what makes mirroring + latency legible.
- **Make latency visible, not just present.** The guest already renders ~interp+RTT behind; surface
  it so the viewer *sees* the offset — e.g. the existing staleness readout tied to the movement
  ("guest is 55ms / ~3 frames behind"), and consider a subtle marker (ghost of the host position, or
  a "now vs rendered" indicator) so the time gap is observable during motion. Let the interp-delay
  control visibly widen/narrow the gap.
- **Default the demo to `redrive-mutators`** (user confirms it looks right) so pose animates on the
  guest too, and keep `state-only` as the explicit "watch what's lost" toggle. Caption the difference
  under the guest frame: "Guest = same fight, rendered ~RTT+interp later. state-only mirrors
  position/health but not the attack animation; redrive-mutators approximates the pose."

**Acceptance:** with the demo running, both canvases show fighters moving around; the guest clearly
mirrors the host's movement slightly delayed (the round trip is visible), the interp-delay knob
visibly changes the lag, and the state-only vs redrive-mutators difference reads as the *finding*,
not a broken render.

### ✅ EXECUTED (round 2 continued) — verified
- **Snapshot demo movement fix** (`b2aa9fa`): input-seam-driven fight; fighters walk, guest mirrors
  a beat later; caption names the latency; defaults to `redrive-mutators`.
- **W5.2** (`d5b62d5`): four "What this tests" walls → ≤3-sentence summary + "Show more".
- **W6.7** (`236169d`): Determinism cost → L0 three-tile strip + magnitude bars + cheap/structural chips.
- **W6.4 / W6.8 / W6.5** (`ce704f8`): sidebar Run-all demoted; Transport session chips + warning
  Callout; Home retitle + full-width Summary card + numbered two-machine steps + note Callout.
- **W6.6** (`ee3b711`): `<kbd>` key legend (verified bindings) replaces the garbled key string.
- **W5.1** (`bf3e146`): result blocks lead with banded sub-score stat tiles (canonical block, all pages).
- **W6.9**: cross-experience reconciliation screenshot pass — all six pages coherent, 0 console errors.

### ⬜ REMAINING (minor — optional next session)
1. **W5.1 (deeper)** — page-specific raw tiles (E2E felt-lag `p50/p95/p99` in ms+frames as the
   biggest tiles; Transport RTT ms; Snapshot bytes/encode-ms) in place of the generic sub-score
   tiles, where the raw shape makes the ms/bytes numbers more decision-relevant than the 0–100 score.
2. **W5.3** — final inline-code sweep on any lingering L2 accordion prose (most surface prose done).
3. Optional: capture a filled Summary PDF as the presentation deliverable.

---

### WAVE 0 — Foundation primitives (new CSS + components; no page behavior changes)

Everything below lands in `src/index.css` plus small new components in `src/components/`.
Satisfies DP §2, §3, §7, §8. All later waves consume these — build them first, exactly as named.

**W0.1 — `Callout` component + `.callout` CSS** (DP §2.1)
- New `src/components/Callout.tsx`:
  `<Callout kind="info|warning|success|danger|note" testId?>{children}</Callout>`.
- CSS: `.callout { display:flex; gap:var(--sp-3); padding:var(--sp-3) var(--sp-4); border:1px
  solid; border-left-width:3px; border-radius:var(--radius-md); font-size:var(--fs-sm); }` with
  `[data-kind]` variants mapping to the existing token pairs (`info`→accent/accent-dim,
  `warning`→acceptable, `success`→good, `danger`→bad, `note`→none). Icon glyphs: `ℹ`, `⚠`, `✓`,
  `✕`, `※` in the kind color.
- Done when: all five kinds render distinctly in dark theme; body text is `--text-dim`.

**W0.2 — `InfoTip` tooltip component** (DP §2.3, §7)
- New `src/components/InfoTip.tsx`: `<InfoTip text="…" />` renders a `ⓘ` glyph
  (`.info-tip`, `--text-faint`, `cursor:help`) inside a label; on hover AND keyboard focus shows
  a `.info-tip-bubble` (absolute, `--bg-raised`, border, `--radius-md`, max-width `18rem`,
  `z-index` above cards). Pure CSS `:hover/:focus-visible` + `aria-label` is sufficient — no
  positioning library.
- Done when: usable inside `.field-grid` labels and `.control-group` titles without clipping
  (bubble may overflow the card).

**W0.3 — `ControlGroup` component** (DP §7)
- New `src/components/ControlGroup.tsx`: `<ControlGroup title="Input timing" tip?>{children}
  </ControlGroup>` → `.control-group { border:1px solid var(--border); border-radius:
  var(--radius-md); padding:var(--sp-3) var(--sp-4); background:var(--bg-raised); }` with
  `.control-group-title` (small-caps like `.explainer-block h3`) and a `.field-grid` body.
- Restyle native controls globally while here: `input[type=number], select { background:
  var(--card); border:1px solid var(--border-strong); border-radius:var(--radius-sm); color:
  var(--text); padding:0.35rem 0.5rem; font:inherit; }`, `accent-color: var(--accent)` for
  checkbox/radio.
- Done when: a group of three inputs reads as one named unit; no stock UA fieldset chrome
  anywhere.

**W0.4 — Global inline-code style + `<kbd>` caps** (DP §2.10, §3)
- Promote `.md code`'s style to a bare `code { … }` rule (same look) so JSX `<code>` matches
  Markdown output. Add `kbd { font-family:var(--font-mono); font-size:var(--fs-xs); padding:
  0.1rem 0.45rem; border:1px solid var(--border-strong); border-bottom-width:2px; border-radius:
  var(--radius-sm); background:var(--card); }`.
- Done when: `<code>` and `<kbd>` used anywhere match the design system with no wrapper.

**W0.5 — Empty-state primitives** (DP §2.12, §6)
- `.canvas-placeholder { aspect-ratio:16/9; width:100%; border:1px dashed var(--border-strong);
  border-radius:var(--radius-md); display:grid; place-items:center; color:var(--text-faint);
  font-size:var(--fs-sm); background:var(--bg-raised); }` with a `.canvas-placeholder-label`
  slot (small caps, top-left inside the frame).
- `.ghost-tile` variant of `.metric-tile` (`opacity:.55`, value `—`).
- Done when: a placeholder + labeled frame can replace today's "label above nothing".

**W0.6 — `.run-row` adoption + rhythm tokens** (DP §8; closes the SPACING AUDIT pattern)
- Keep `.run-row` as-is; add `.result-block { margin-top: var(--sp-4); }` wrapper class used
  around every `ResultView` + table. Remove any full-width default on buttons (buttons are
  intrinsic width unless `data-block`).
- Done when: no two sibling `<button>`s exist outside a `.run-row` anywhere in `src/pages/`.

**W0.7 — Canonical `ResultView` upgrade** (DP §5 "canonical result block")
- Rework `src/components/ResultView.tsx` to render:
  1. Verdict strip: status `Band` chip + **first sentence of `result.verdict` only** (bold) +
     `topology`/`lossMode` as two small chips (reuse `.band-pill[data-band=none]` look, mono).
  2. `MetricTileGrid` of headline tiles — new optional prop `tiles?: {label, value, band?,
     source?}[]` supplied by each page (each page knows its decisive numbers; see W5.1).
  3. `<details class="section-collapsible">` "Details" containing: full verdict Markdown,
     sub-score rows (existing), `measuredCaveat` as a `note` Callout.
- Done when: all four pages + Summary render results through this shape; no page shows a
  COMPLETED chip with zero visible numbers (E2E host-half shows a ghost tile reading
  "felt lag — measured on guest → merged result", DP §5).

---

### WAVE 1 — Realistic fight sim in live loop & demos (DP §10)

The demo is the emotional proof; the payload is the technical proof. Files:
`src/experiences/e2e/*`, `src/experiences/snapshot/*`, `src/pages/E2EPage.tsx`,
`src/pages/SnapshotPage.tsx`. No `src/game` edits.

**W1.1 — Demo-bot input driver (new `src/experiences/demoBot.ts`)**
- One shared module exporting a deterministic, looping scripted fight choreography usable by
  both demos, expressed at the *input* level where an input seam exists:
  - `demoBotFrame(tick, player): {buttons: ButtonState, edges: EdgeState}` — a ~12-second loop
    (720 ticks) per player, phase-offset so the two fighters trade: walk in (`left/right` holds),
    P1 `light` edge, P2 `block` hold over the hit window, P2 `heavy` counter, P1 `charge` hold
    ~900ms then `special` edge, disengage, repeat. Edges fire exactly one frame (JustDown
    semantics per contracts §2).
  - Gate on `NetFightScene.isFighting` — never queue during countdown (existing pitfall,
    documented in `netFightScene.ts`).
- **E2E live loop** (`E2EPage.tsx` / `useE2EDemo`): add `Demo bot` toggle (default ON, in the
  new "Roles" control group). When ON in solo mode: host-local side feeds bot frames through
  `DelayedLocalInput`'s underlying provider path is NOT reachable without src edits — instead
  drive the *guest* side by synthesizing real `input` WireMessages (seq, tick, buttons, edges,
  tSent) sent over the same transport into `RemoteInput` (the identical path
  `e2eExperience.ts`'s automated scripted pass already uses — reuse its press-scheduling helper,
  extract it into `demoBot.ts` rather than duplicating), and drive the host-local fighter with a
  page-side `requestAnimationFrame` bot that dispatches through the same synthesized-provider
  approach the automated experience uses. Human keypresses always take precedence: any real
  `keydown` in a canvas pauses the bot for that side for 5s (simple last-human-input timestamp).
- **Snapshot demo** (`SnapshotPage.tsx`): no input seam exists (008.4 scope) — loop the existing
  public-mutator choreography: generalize `snapshotExperience.ts`'s `driveScript` into an
  exported, loopable `driveDemoScript(scene, tick)` (extend it to a fuller ~720-tick loop with
  both fighters attacking, blocking, taking damage, meter gain, and an eventual KO + rematch via
  `takeDamage` to zero), called from the page's `onSnapshot` tick handler while a `Demo bot`
  toggle (default ON) is set.
- Done when: pressing **Start live demo** with no keyboard input shows, within 10s, moves being
  executed and health/meter visibly changing on BOTH canvases; the fight sustains indefinitely;
  a KO + round reset occurs within ~30s (DP §10 "realistic" definition).

**W1.2 — Real encoded payload on the demo wire** (DP §10 "On the wire")
- **Snapshot demo honesty gap (fix):** `useLiveSnapshotDemo.onSnapshot` currently pushes the
  live `Snapshot` object straight into `InterpolationBuffer` — a same-process object handoff.
  Change to: `encodeBinary(snapshot)` → `decodeBinary(bytes)` → `interp.push(decoded)`; keep
  `measureEncodeCost` for the ladder readout. The bytes shown are now the bytes applied.
- **E2E solo demo:** already sends the real `Snapshot` over `LoopbackTransport` — verify the
  simulated-network wrapper stays in the path; no change beyond W1.3 readouts.
- The wire payload is the full frozen `Snapshot` (contracts §3): `tick`, `hostTime`,
  `p1LastInputSeq`, `p2LastInputSeq`, `round`, `countdown`, `winner`, and per fighter `x`, `vx`,
  `health`, `confidence`, `special`, `state`, `facingRight`, `attackTimer`, `hitstunTimer`,
  `chargeMs`. This list is the spec — nothing is stubbed out of the demo path.
- **Documented gap, not a patch:** move identity (`moveId` / attack kind) and per-hit damage
  amounts are NOT in the frozen schema (the `startAttack` kind is a `Fighter` argument, not
  state; see `snapshotCodec.ts` FINDING comment). Surface as a `warning` Callout inside the
  Snapshot page's "fidelity" accordion: "The snapshot doesn't carry *which* attack is playing —
  the guest can see `state: attack` + timers but must guess the move. A production schema needs
  a move-identity field." Do not modify `src/`.
- Done when: Snapshot demo readout's byte figures are computed from the encoded buffer actually
  decoded and applied; grep shows no demo path pushing an unencoded live snapshot to a guest.

**W1.3 — Demo readouts as HUD stat tiles** (DP §2.6, §10 "Reading the demo")
- Replace both pages' `<ul>` readouts (`page-sim-snapshot-live-readout`, `page-e2e-live-readout`)
  with a `MetricTileGrid`:
  - E2E: `felt lag p50` / `p95` / `p99` (value `48.2ms`, sub-line frames `2.9f`, band via the
    existing `frameBandLabel` thresholds), `staleness`, `host tick`.
  - Snapshot: `json` / `binary` / `delta` bytes (sub-line encode ms), `staleness`, `tick`.
  - BOTH: two per-fighter HUD mini-tile clusters sourced from the **received/applied** snapshot:
    `P1 HP`, `P1 meter`, `P1 state` and same for P2 — labeled "from wire" — proving on screen
    that the payload carries the fight.
- Done when: no live readout renders as list prose; all values mono; bands color felt-lag tiles.

---

### WAVE 2 — Demo modal (canvases stay mounted) (DP §5, §6; user request)

**W2.1 — `.demo-modal` wrapper-class overlay** — `src/pages/E2EPage.tsx`
(`page-e2e-canvases`, ~L397) and `src/pages/SnapshotPage.tsx` (`page-sim-snapshot-canvases`).
- CRITICAL: the canvas parent `<div ref>`s must **stay mounted permanently**. Never
  conditionally unmount; toggle a class on the always-rendered wrapper.
- Implementation: wrap each canvases block in `<div className={"demo-stage" + (expanded ? "
  demo-modal" : "")}>`. CSS:
  - `.demo-stage` — the inline state: current flex row, but canvases live inside
    `.canvas-placeholder`-sized frames (16:9, W0.5) whether running or not.
  - `.demo-modal { position:fixed; inset:0; z-index:50; background:rgba(11,14,20,0.92);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:var(--sp-4); padding:var(--sp-6); }` — host and guest **stacked vertically**, each
    `.demo-modal .demo-canvas-frame { width:min(88vw, calc((100vh - 12rem) * 16/9 / 2 * 1))
    ; }` — practical rule: each frame `max-height: calc((100vh - 10rem)/2)`, `aspect-ratio:16/9`,
    and `canvas { max-width:100%; height:auto; display:block; }` so both `960×540` clients fit
    without overflow (Phaser `Scale.FIT` already handles internal letterboxing).
  - Backdrop click and a `✕ Close` button (top-right, `.run-row` with the existing Stop button)
    collapse it; `Esc` too (keydown listener while expanded).
- Add an `Expand ⤢` button to each demo's `.run-row` (enabled only while running).
- Done when: expanding/collapsing mid-fight never restarts or blanks a canvas (verify: health
  values persist across toggles); both clients fully visible at 1440×900; `Esc`, backdrop, and
  ✕ all close; Stop remains reachable inside the modal.

---

### WAVE 3 — Summary → scoreboard (`src/pages/SummaryPage.tsx`) (DP §1, §2.6, §4, §5)

Current state (r06): below the two verdict tiles sits an italic caveat, then five paragraphs of
"Cumulative finding" prose with `research.md` refs, a mis-wrapped empty-state ("No results yet —
run an…" broken into a 3-line narrow column inside the tile grid), and "Not run yet." prose rows.
The decision page reads as a memo. Rebuild top-to-bottom as:

**W3.1 — Keep the two `Verdict` tiles** (concept is right). Fixes: on the rollback tile the
em-dash score and `/100` unit currently sit apart oddly (r06, right tile) — render `— /100` as
one unit in `.verdict-banner-score` when score is null. Give the left tile's meta counts the
same one-source run-state as W4.1.

**W3.2 — 4-row experiment scoreboard** — new `.scoreboard` section directly under the verdicts.
- One row per experiment: `name` (plain title) · big mono score (`xx.x` or `—`) · band chip ·
  one-line takeaway (first sentence of `result.verdict`, or the ghost text "Not run — expected:
  <one-line working hypothesis>") · status chip (idle/running/completed/failed from W4.1).
- CSS `.scoreboard-row { display:grid; grid-template-columns: 1fr 5rem auto 2fr auto;
  gap:var(--sp-3); align-items:center; padding:var(--sp-3) var(--sp-4); }` in a bordered card,
  rows divided by `--border`.
- Rows are buttons navigating to the experiment page.

**W3.3 — Headline distribution stat tiles** — keep `headlineMetrics` tiles; additionally
surface `findDistributions` results as `p50`/`p95`/`p99` `MetricTile`s per experiment (label =
distribution path, mono values, `p95`→acceptable-tint, `p99`→bad-tint as in `DistributionBar`).
Fix the empty state: when nothing has run, render ONE full-width `.ghost-table` strip ("Run all
to fill p50 / p95 / p99 for each experiment") — never a wrapped paragraph inside the tile grid
(the r06 narrow-column artifact).

**W3.4 — Demote the prose narrative** — "Cumulative finding" becomes
`<details class="section-collapsible">` titled **"Full narrative"**, collapsed, below the
scoreboard; still rendered expanded in the print report (`.print-only` path unchanged). The
measurement caveat moves from its current first-body-element position (r06) to a `note` Callout
*below* the scoreboard (DP §2.1 "callouts never open pages").

**W3.5 — Controls cleanup** — page `Run all` stays (it is this page's primary action; demote the
sidebar's to secondary styling W6.4); `Clear stored results` gets a confirm. Weights + Export
sections unchanged except spacing via W0.6.

- Done when: with zero runs the page shows verdict tiles + a 4-row ghost scoreboard + ghost
  distribution strip + collapsed narrative — no visible paragraph longer than 3 sentences; with
  all four run (capture `.ux-shots/r06b-summary-filled.png` — REQUIRED before calling done) every
  row has score+band+takeaway and tiles are populated.

---

### WAVE 4 — Run-state source of truth + empty states (DP §6)

**W4.1 — One derivation** — add to `RunStore` a selector `runState(id): "idle"|"running"|
"completed"|"failed"` (exactly `Nav.dotState`'s logic, moved into the store). Consume it in
`Nav` (dots + `title` tooltip "Transport — completed"), Summary (verdict meta counts, scoreboard
status chips, per-experience list), and each page's result block. Delete all local
re-derivations.
- Done when: grep shows `results[...]?.status` compared only inside the store; sidebar dot,
  scoreboard chip, and page chip cannot disagree.

**W4.2 — Sidebar dot legend** — under the nav "Experiments" group, a one-line
`.nav-dot-legend` (three dots + "idle / running / done") in `--fs-xs` `--text-faint`.

**W4.3 — Empty states everywhere** (uses W0.5):
- Snapshot + E2E canvases: labeled `.canvas-placeholder` frames always rendered (canvas mounts
  into the frame; placeholder hint hidden while running) — kills the r03/r04 "label above
  nothing" failure.
- Transport default run: ghost results table (headers `transport · rate · payload · p50 · p95 ·
  p99 · jitter · loss%` with one `—` row) before first run.
- Determinism: ghost tiles for the result (`seeded-run hash match`, `RNG call sites`,
  `retrofit estimate`) before first run — the r05 column currently dead-ends after two accordions.
- E2E: ghost felt-lag tiles (`p50 — · p95 — · p99 —`).
- Done when: no page region can be mistaken for a rendering failure before the first run.

---

### WAVE 5 — Prose → data + copy passes (DP §3, §4)

**W5.1 — Result prose → tiles** (uses W0.7's `tiles` prop):
- Transport: `p50/p95/p99` (best cell), `jitter`, `loss% obs.` tiles; keep `CellTable` inside
  the Details accordion.
- Snapshot: `binary B/frame`, `delta B avg`, `encode ms/frame`, `fidelity` (good/partial chip).
- E2E: `felt lag p50/p95/p99` tiles (frames sub-line) — THE decisive number, biggest tiles in
  the app; host-half placeholder tile per W0.7.
- Determinism: `RNG sites: 3 · cheap`, `repro hash: match`, `retrofit: months · structural`.

**W5.2 — Trim the "What this tests" walls** (r02 ~80 words w/ "008.2 relay"; r03 ~120 words w/
`contracts.md §3`; r04 ~200 words — the worst, on the page that most needs a short one; r05 ~70
words). In `src/experiences/*` experience definitions, split `whatItTests` into ≤3 plain
sentences visible + remainder into a trailing `details.prose-more` ("Show more") rendered by
`ExperienceLayout`. Replacement L1 copy (use verbatim):
- Transport: "Sends the same stream of game-sized packets over WebSocket (TCP) and WebRTC
  DataChannel (UDP-like), while a proxy injects real packet loss. Reports round-trip `p50` /
  `p95` / `p99`, `jitter`, and observed loss for each. The question: does TCP's head-of-line
  blocking actually show up in the tail?"
- Snapshot: "Captures the real fight state every tick, serializes it three ways (`JSON`, packed
  binary, delta), and renders it on a second, sim-free client. Measures bytes per tick and
  encode cost against the `16.67ms` frame budget. The question: is a snapshot cheap, and does it
  look right?"
- E2E: "Wires the whole loop: a guest button-press travels the wire to the host sim, and the
  result travels back as a snapshot. Measures the guest's **felt input lag** — the decisive
  number for whether this feels playable. Everything else in this app supports this page."
- Determinism: "Counts every source of non-determinism in the sim (verified `file:line`) and
  demonstrates the cheap part headlessly: same seed + same inputs = identical outcome. The
  question: would rollback netcode be cheap to retrofit? (Separate axis — not part of the
  feasibility score.)"
- All removed sentences (with their citations) go into the `prose-more` body — citations are
  legal there (L2).

**W5.3 — Inline-code styling pass** (DP §3) — with W0.4 in place, sweep all JSX prose and
labels: `?room=`, `role=guest`, `p50/p95/p99`, `16.67ms`, `50ms`, `link-loss`,
`maxRetransmits:0`, byte/Hz/ms literals, identifier mentions → `<code>`. Screens to hit
explicitly: Transport session line + advanced legends, Snapshot live-body + fidelity text, E2E
live-body + caveat, Home two-machine block (already partial), Summary narrative.

**W5.4 — Typed-callouts pass** (DP §2.1) — replace with `Callout`:
- Every solo/loopback validity sentence → `warning` (Transport session note's second half; E2E
  live-body's "No ?room= set…" half; Home's solo/loopback caveat paragraph → `note`).
- `LinkLossPanel` unreachable message → `danger` alert; reachable state → plain chip row.
- E2E measurement provenance caveat (`page-e2e-live-caveat`) → `note`.
- Snapshot move-identity gap (W1.2) → `warning`.
- Max two visible per page — audit after placement.

**W5.5 — Per-control tooltips + grouped sets** (DP §7; uses W0.2/W0.3):
- **E2E** (`page-e2e` field-grid → three `ControlGroup`s):
  - "Roles": host-role select (options shortened to `Guest controls P2 (default)` / `Guest
    controls P1` — the current option text truncates in r04), Demo bot toggle (W1.1).
  - "Input timing": remote input-delay, symmetric host delay, guest interp buffer.
  - "Simulated network" (solo only): latency, jitter, payload-drop.
  - Tooltip copy (verbatim): interp buffer — "Extra buffering before the guest renders a
    snapshot. Higher = smoother under jitter, but adds directly to felt lag."; symmetric delay —
    "Delays the host's OWN input by the same amount as the guest's, so neither player has a
    hometown advantage."; remote input-delay — "Holds guest inputs briefly so they apply on a
    consistent tick instead of arriving ragged."; latency/jitter/drop — "Applied to the loopback
    wire so a solo run behaves like a real network."
- **Snapshot**: one "Demo controls" `ControlGroup` (interp delay, render mode — option text
  `state-only (default)` / `redrive-mutators (experimental)`, drop the `F6` token; Demo bot
  toggle). Tooltips: render mode — "state-only applies snapshot fields directly; redrive-mutators
  additionally re-calls the host's public move functions to approximate pose."
- **Transport advanced sweep**: convert the five native fieldsets to `ControlGroup`s
  ("Transports", "Send rate", "Payload size", "Loss injection", "Sampling"); radio label
  `link-loss (real HOL…)` → option label `link-loss` + group helper text "link-loss drops
  packets at the relay — the only mode that exercises real TCP head-of-line blocking."; the
  pathological-payload warning becomes an `InfoTip` on the `16384B` checkbox.
- Done when: every control on all pages has label-above + tooltip + named group (checklist DP
  §11.5).

---

### WAVE 6 — Spacing, consistency reconciliation, per-page polish

**W6.1 — Spacing audit fixes** (DP §8; uses W0.6) — sweep all pages:
- Transport default run, Snapshot run, Determinism run: wrap Run+Abort in `.run-row` + mode
  badge (Snapshot/Determinism currently render full-width stacked bars — r03/r05 — make
  intrinsic-width, side by side, matching E2E's r04 run row, which is the model).
- Snapshot `Start live demo`/`Stop` (r03: two full-width grey bars) → `.run-row` with Start as
  secondary-primary (`data-variant="primary"` only while not running), + `Expand ⤢` (W2).
- Every `ResultView` wrapped in `.result-block` (`--sp-4` off the run row).
- `topology · loss` chip line: chips, `--sp-3` from the status chip (W0.7 covers).

**W6.2 — Page-order fix on E2E** (DP §5 ordering; r04): the "Fidelity caveat — the input seam"
accordion currently LEADS the work column. Move it below the measurement section, next to the
other L2 accordions. Column order becomes: live loop section → measurement run row + result →
fidelity-caveat accordion.

**W6.3 — Snapshot page order** (r03): fidelity accordion currently sits between the demo and
the Run button. Order becomes: demo section → measurement run row + result → fidelity accordion
(retitle stays "The fidelity-gap finding, in plain language"; body gets the W5.2 3-sentence +
Show-more treatment — the current 13-line paragraph with `raw.fidelity` tokens is not "plain
language").

**W6.4 — Sidebar demotion** — page-level primary Run is the loudest element (DP §5): sidebar
"Run all" drops `data-variant="primary"` (bordered secondary), keeps position.

**W6.5 — Home polish** (r01):
- Section header "THE FOUR EXPERIMENTS" over five cards with an orphaned 05 card → retitle
  **"Four experiments + the verdict"** and make the Summary card full-width
  (`grid-column: 1 / -1`) with an accent left border so it reads as the roll-up, not a fifth
  experiment.
- "Running across two machines" prose block → 3 numbered `.how-to-step` cards: 1 "Open this app
  on the host machine — no params needed", 2 "Open `?room=my-room&role=guest` on the second
  machine", 3 "Run any experiment — results tag themselves `LAN`/`WAN` automatically", with the
  two URLs as copyable full-width `<code>` blocks; solo-validity caveat → `note` Callout.
- Keyboard-drivable mention stays off Home; it lives on Snapshot/E2E as the W6.6 kbd grid.

**W6.6 — Keyboard map → `<kbd>` grid** (DP §2.10; r03 "P1: A/D/S/F/G/Shift/Q, P2:
arrows/./,/Up//Special: Enter" is unparseable): new small `KeyLegend` component used by Snapshot
+ E2E demo sections — two labeled rows ("P1", "P2"), each a wrap-flex of `<kbd>` caps with tiny
action sublabels (Move `A`/`D`, Duck `S`, Light `F`, Heavy `G`, Block `Shift`, Special `Q`; P2:
arrows, `.`, `,`, `Enter`). Verify the real bindings against `src/game/systems/InputManager.ts`
(read-only) before writing the legend — do not trust the current prose (its "Up//Special"
garbling is exactly why).

**W6.7 — Determinism visual cost tiers** (r05 hides the app's most persuasive content):
- Inside "Retrofit cost estimate": each `COST_TABLE` row becomes a `.cost-row` with a
  green/amber chip (`cheap` / `structural`) leading, the part name, a **magnitude bar**
  (`.cost-bar` — Hours ▮ / Weeks ▮▮▮ / Months ▮▮▮▮▮▮ as a proportional fill, `--good` for
  cheap, `--acceptable` for structural) and the anchor sentence as `--fs-xs` below.
- "Non-determinism sources": `file:line` as `<code>`, cheap/structural italics → the same chips.
- Promote ONE L0 artifact: a three-tile strip visible by default (`RNG seeding — hours · cheap`,
  `Fixed timestep — weeks · structural`, `Restorable physics — months · structural`) so the
  page answers its question at a glance; accordions keep the detail.

**W6.8 — Transport session line** (r02: a prose sentence): → one `.chip-row` of three mono chips
(`room (none)` · `role host` · `topo loopback`) + the `warning` Callout from W5.4. Delete the
sentence. This chip row + callout combo is the shared session pattern for any page that needs it.

**W6.9 — Cross-experience reconciliation sweep** (DP §9) — final pass with the DP §11 checklist
against fresh screenshots of all six pages; fix any page diverging from the skeleton, result
block, run-row, control-group, callout, or empty-state patterns. Record each checklist item
pass/fail per page in the commit message.

---

## Definition of done (whole round)

1. Every DP §11 checklist item answers **yes** on all six pages (screenshot-verified).
2. Live demos: a no-keyboard observer sees a real fight (moves, damage, meter, KO) within 10s;
   HUD tiles labeled "from wire" track the received snapshot; Snapshot demo applies
   binary-decoded snapshots only.
3. Demo modal: expand/collapse mid-fight without canvas loss; both clients fit, stacked.
4. Summary: filled-state screenshot (`r06b-summary-filled.png`) shows verdicts + 4-row
   scoreboard + distribution tiles + collapsed narrative; empty state is fully ghosted.
5. One run-state source of truth: dot = chip = scoreboard, everywhere.
6. Zero internal citations visible at L0/L1; zero prose blocks >3 sentences visible; zero bare
   adjacent buttons; zero label-above-nothing regions.
7. Gates green: `npm run build`, `npm run lint` (0 err), `npm test`; fresh `.ux-shots/r1x-*.png`
   set captured (default + running + filled states for each page).

## Wave ordering & checkpoints

| Wave | Contents | Checkpoint |
|---|---|---|
| W0 | Primitives (Callout, InfoTip, ControlGroup, code/kbd, placeholders, ResultView) | Storybook-style scratch page or visual spot-check; gates green |
| W1 | Fight-sim realism + real payload + HUD tiles | Screencast/screenshot of self-running fight on both demo pages |
| W2 | Demo modal | Mid-fight expand/collapse persistence check |
| W3 | Summary scoreboard | Empty + filled screenshots |
| W4 | Run-state SoT + empty states | All-pages never-run screenshot pass |
| W5 | Prose→tiles, copy, code, callouts, tooltips, groups | Per-page copy diff review |
| W6 | Spacing, ordering, polish, reconciliation sweep | Full DP §11 checklist matrix, final shots |

Open questions Opus must resolve before W1 (answer in-code with a comment, or flag):
1. Whether `e2eExperience.ts`'s existing scripted press scheduler can be extracted cleanly into
   `demoBot.ts` without changing the automated measurement's numbers (it must not — the
   automated pass is a published result path; extraction must be behavior-identical).
2. Exact P2 key bindings for the `KeyLegend` (read `src/game/systems/InputManager.ts`).
3. Whether the E2E host-local bot can reuse the same synthesized-provider path the automated
   experience uses for the host side without touching `DelayedLocalInput`'s keyboard source; if
   not, bot-drive the guest side only and note it — a one-sided bot still produces a real
   exchange since the host player can be scripted via the automated path's technique.

---

## Appendix — prior review (round 1, resolved items removed)

The full original top-5 analysis and per-page notes from round 1 are superseded by the spec
above; everything still-valid was folded into waves W1–W6. What remains true and should not be
regressed: the Home question-first framing, the Transport packet diagram (the model for
explanatory assets), the two-column sticky-explainer layout, the two-axis verdict concept, the
dark observability palette, and the determinism `file:line` evidence (now surfaced by W6.7).
