/**
 * 008.5 — the harness-side input seam (contracts.md §7, F2). `NetFightScene
 * extends FightScene`: after `super.create()` it replaces the inherited
 * `keyboard` field with a per-player-routed provider — one slot driven by
 * the HOST's own (optionally symmetric-delayed) keyboard, the other by a
 * `RemoteInput` fed from the guest over a `Transport`. The inherited
 * `update()` (and the rematch poll at `FightScene.ts:163`,
 * `getInput(1).special`) keep working unchanged — they only ever call
 * `this.keyboard.getInput(...)`, and that field is now the swapped provider.
 *
 * NO `src/` file is edited. `chargeP1`/`chargeP2`/`p1`/`p2` etc. stay
 * `private` on `FightScene` — this class never reaches past the public
 * `InputProvider` seam and `update()`/`create()` overrides, exactly the
 * subclass technique contracts.md §7 sanctions (mirroring 008.4's
 * `SnapshotHostScene`).
 *
 * Host-role is session config, not hardcoded (spec item 7 / F11):
 * `hostLocalPlayer` picks which player index (1 or 2) the HOST's own
 * keyboard drives; the other index is always the `RemoteInput` slot. A run
 * with `hostLocalPlayer: 2` is "guest controls P1, host simulates P2 with
 * its own keyboard" — identical mechanics, just a different index wired to
 * which provider.
 */
import { FightScene } from "../../../../../../src/game/scenes/FightScene";
import { LocalKeyboardInput, type InputProvider } from "../../../../../../src/game/systems/InputManager";
import { captureSnapshot } from "../snapshot/snapshotCodec";
import { DelayedLocalInput } from "./delayedLocalInput";
import type { RemoteInput } from "./remoteInput";
import type { Snapshot } from "../../lib/contracts";

/** Event name emitted on `this.game.events` once per tick with the produced `Snapshot`. */
export const NET_E2E_SNAPSHOT_EVENT = "net-e2e-snapshot";

export interface NetFightSceneConfig {
  /** Which player index the HOST's own keyboard drives; the other index is the RemoteInput slot. */
  hostLocalPlayer: 1 | 2;
  /** Fed by the transport's `input` messages for the non-host-local player. */
  remote: RemoteInput;
  /** The symmetric input-delay knob (spec item 3) — ticks, read live so the page's slider applies immediately. */
  getSymmetricDelayTicks: () => number;
  /**
   * Optional override for the HOST-local input source (F2 seam). When absent,
   * the real `LocalKeyboardInput` is used (normal keyboard play). The demo bot
   * passes a factory that returns a choreography-driving provider (which itself
   * yields to a real keypress) — a harness-side driver only, no `src/` edit.
   */
  localSource?: (scene: NetFightScene) => InputProvider;
}

export class NetFightScene extends FightScene {
  private tick = 0;
  private hostLocalPlayer: 1 | 2 = 1;
  private remote!: RemoteInput;
  private delayedLocal!: DelayedLocalInput;
  private hostLocalSeq = 0;

  create(): void {
    super.create();
    this.tick = 0;
    this.hostLocalSeq = 0;

    const cfg = this.registry.get("netE2EConfig") as NetFightSceneConfig;
    this.hostLocalPlayer = cfg.hostLocalPlayer;
    this.remote = cfg.remote;

    const localSource: InputProvider = cfg.localSource ? cfg.localSource(this) : new LocalKeyboardInput(this);
    this.delayedLocal = new DelayedLocalInput(
      localSource,
      this.hostLocalPlayer,
      () => this.tick,
      cfg.getSymmetricDelayTicks,
    );

    const hostLocalPlayer = this.hostLocalPlayer;
    const remote = this.remote;
    const delayedLocal = this.delayedLocal;
    const provider: InputProvider = {
      getInput(player: 1 | 2) {
        return player === hostLocalPlayer ? delayedLocal.getInput(player) : remote.getInput(player);
      },
    };
    (this as unknown as { keyboard: InputProvider }).keyboard = provider;
  }

  update(time: number, delta: number): void {
    this.tick += 1;
    this.remote.releaseDue(performance.now());
    super.update(time, delta);
    this.hostLocalSeq += 1;

    const p1Seq = this.hostLocalPlayer === 1 ? this.hostLocalSeq : this.remote.lastConsumedSeq;
    const p2Seq = this.hostLocalPlayer === 2 ? this.hostLocalSeq : this.remote.lastConsumedSeq;
    const snapshot: Snapshot = captureSnapshot(this, this.tick, performance.now(), p1Seq, p2Seq);
    this.game.events.emit(NET_E2E_SNAPSHOT_EVENT, snapshot);
  }

  get currentTick(): number {
    return this.tick;
  }

  get remoteInputPlayer(): 1 | 2 {
    return this.hostLocalPlayer === 1 ? 2 : 1;
  }

  /**
   * `FightScene.fighting` (`FightScene.ts:28`) is `private` — a compile-time
   * restriction only, read via the same type-only-cast technique
   * `snapshotCodec.ts`'s `internals()` already established (no `src/`
   * edit). Exposed so a driver can avoid queuing scripted input during the
   * pre-fight countdown, when nothing consumes `RemoteInput`'s queue yet —
   * otherwise queued presses pile up and get attributed to a bogus,
   * multi-second "lag" once fighting starts and the queue finally drains.
   */
  get isFighting(): boolean {
    return (this as unknown as { fighting: boolean }).fighting;
  }
}
