import Phaser from "phaser";
import type { BodyPartKey, BodyPartSpec, CharacterRig } from "../types";

export type RigPartMap = Partial<
  Record<BodyPartKey, Phaser.GameObjects.Rectangle | Phaser.GameObjects.Arc>
>;

function resolveFill(
  spec: BodyPartSpec,
  primary: number,
  accent: number,
): number {
  if (spec.fill === "primary") return primary;
  if (spec.fill === "accent") return accent;
  return Phaser.Display.Color.HexStringToColor(spec.fill).color;
}

function resolveStroke(
  spec: BodyPartSpec,
  primary: number,
  accent: number,
): number | undefined {
  if (!spec.stroke || spec.stroke === "none") return undefined;
  if (spec.stroke === "primary") return primary;
  return accent;
}

export function buildRigParts(
  scene: Phaser.Scene,
  rig: CharacterRig,
  primary: number,
  accent: number,
): RigPartMap {
  const parts: RigPartMap = {};
  const entries = Object.entries(rig.parts) as [BodyPartKey, BodyPartSpec][];

  for (const [key, spec] of entries) {
    if (!spec) continue;
    const fill = resolveFill(spec, primary, accent);
    const stroke = resolveStroke(spec, primary, accent);

    let obj: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Arc;

    if (spec.shape === "circle") {
      const radius = spec.width / 2;
      obj = scene.add.circle(
        spec.offset.x,
        spec.offset.y,
        radius,
        fill,
        spec.alpha ?? 1,
      );
      if (stroke !== undefined) {
        obj.setStrokeStyle(spec.strokeWidth ?? 2, stroke, spec.alpha ?? 0.7);
      }
    } else {
      obj = scene.add.rectangle(
        spec.offset.x,
        spec.offset.y,
        spec.width,
        spec.height,
        fill,
        spec.alpha ?? 1,
      );
      if (stroke !== undefined) {
        obj.setStrokeStyle(spec.strokeWidth ?? 2, stroke);
      }
    }

    if (spec.hidden) obj.setVisible(false);
    parts[key] = obj;
  }

  return parts;
}
