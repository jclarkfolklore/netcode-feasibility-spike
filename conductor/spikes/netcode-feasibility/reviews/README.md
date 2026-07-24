# Netcode Spike — Review & Decision Record

A consolidated record of the multi-pass review of the netcode-feasibility spike, assessing it
against the real problem: whether/how to build online multiplayer for the rock-em-sock-em fighting
game. Start with the synthesis.

| Doc | What it is |
|---|---|
| [`00-SYNTHESIS.md`](./00-SYNTHESIS.md) | **Start here.** Consolidated verdict across all passes, the four-way corruption of the flagship measurement, netcode-model options, gaps, and the prioritized action plan (next steps). |
| [`01-relevance-and-coverage.md`](./01-relevance-and-coverage.md) | Strategic review — does the spike measure the right things for THIS game; ranked gaps (Sonnet). |
| [`02-findings-and-decision.md`](./02-findings-and-decision.md) | Strategic review — what can be honestly concluded, at what confidence; the re-measurement list (Sonnet). |
| [`03-path-to-production.md`](./03-path-to-production.md) | Strategic review — concrete plan to ship multiplayer: model, `src/game` diff list, transport/TURN, roadmap (Sonnet). |
| [`04-diagnosis-and-deployment.md`](./04-diagnosis-and-deployment.md) | Root-cause of the reported paired-path failure + a prioritized accuracy/correctness/resource/deployment report (Fable). |
| [`05-independent-review-and-reconciliation.md`](./05-independent-review-and-reconciliation.md) | Unbiased run-the-app review + reconciliation of all passes (Opus). |

## TL;DR
- **Keep host-authoritative** (state-relay). Confirmed across all passes; nothing reopens rollback.
- **Don't commit the multiplayer track on the current numbers.** The decisive real-hardware felt-lag
  doesn't trustworthily exist yet.
- The scary `Not feasible / 49.1` is a **config artifact** (default RTT is 2× the project's target),
  not a verdict; at the project's target the (simulated) number is ~2–3.5 frames — leans feasible.
- The flagship felt-lag is corrupt **four independent ways** (presence barrier, clock skew, rAF
  throttling, thin samples) — fix all or trust none.
- **Next step:** make the felt-lag measurement decision-grade + stop the dashboard misleading, then
  take one real two-machine reading. See `00-SYNTHESIS.md` §6.
