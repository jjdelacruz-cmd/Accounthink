// Turns one camera frame's face landmarks into "looking at the screen or not".
// Everything here runs on the student's phone; no picture ever leaves it.

export type Look = "ok" | "no_face" | "away" | "multi";

type Point = { x: number; y: number };
type Category = { categoryName: string; score: number };

/** Head direction as ratios (0.5 ≈ facing the camera). Compared with the student's own baseline. */
export type Pose = { yaw: number; pitch: number };

// MediaPipe face mesh landmark indexes.
const NOSE_TIP = 1;
const EYE_OUTER_A = 33; // one eye's outer corner
const EYE_OUTER_B = 263; // the other eye's outer corner
const CHIN = 152;

export function poseOf(lm: Point[]): Pose | null {
  const nose = lm[NOSE_TIP];
  const a = lm[EYE_OUTER_A];
  const b = lm[EYE_OUTER_B];
  const chin = lm[CHIN];
  if (!nose || !a || !b || !chin) return null;
  const eyeSpan = b.x - a.x;
  const eyeMidY = (a.y + b.y) / 2;
  const faceHeight = chin.y - eyeMidY;
  if (Math.abs(eyeSpan) < 1e-3 || faceHeight < 1e-3) return null;
  return { yaw: (nose.x - a.x) / eyeSpan, pitch: (nose.y - eyeMidY) / faceHeight };
}

// How far from the student's normal position counts as looking away. Phones are held
// below the eyes, so looking down is normal; only a strong head-down counts.
export const LIMITS = { yaw: 0.13, pitchDown: 0.16, pitchUp: 0.12, sideGaze: 0.6, upGaze: 0.5 };

function score(cats: Category[] | undefined, name: string) {
  return cats?.find((c) => c.categoryName === name)?.score ?? 0;
}

/** Eyes turned to one side, or up, even when the head stays still. */
export function gazeAway(cats: Category[] | undefined): boolean {
  if (!cats?.length) return false;
  const toOneSide = (score(cats, "eyeLookOutLeft") + score(cats, "eyeLookInRight")) / 2;
  const toOtherSide = (score(cats, "eyeLookInLeft") + score(cats, "eyeLookOutRight")) / 2;
  const up = (score(cats, "eyeLookUpLeft") + score(cats, "eyeLookUpRight")) / 2;
  return Math.max(toOneSide, toOtherSide) > LIMITS.sideGaze || up > LIMITS.upGaze;
}

export function headAway(pose: Pose, baseline: Pose): boolean {
  const dy = pose.pitch - baseline.pitch;
  return Math.abs(pose.yaw - baseline.yaw) > LIMITS.yaw || dy > LIMITS.pitchDown || dy < -LIMITS.pitchUp;
}

export function classify(
  faces: Point[][],
  blendshapes: { categories: Category[] }[] | undefined,
  baseline: Pose | null,
): { look: Look; pose: Pose | null } {
  if (faces.length === 0) return { look: "no_face", pose: null };
  if (faces.length > 1) return { look: "multi", pose: null };
  const pose = poseOf(faces[0]);
  if (!pose) return { look: "no_face", pose: null };
  if (gazeAway(blendshapes?.[0]?.categories)) return { look: "away", pose };
  if (baseline && headAway(pose, baseline)) return { look: "away", pose };
  return { look: "ok", pose };
}

/**
 * Debounces frame-by-frame looks into warnings: a warning starts after `startMs` of a bad look
 * and ends after `endMs` of looking back. `step` returns a finished episode, if one just ended.
 */
export class WarningTracker {
  warning: Exclude<Look, "ok"> | null = null;
  private badSince: number | null = null;
  private badLook: Exclude<Look, "ok"> | null = null;
  private okSince: number | null = null;
  private episodeStart = 0;

  constructor(
    private startMs = 2000,
    private endMs = 1000,
  ) {}

  step(look: Look, now: number): { kind: Exclude<Look, "ok">; seconds: number } | null {
    if (look === "ok") {
      this.badSince = null;
      this.badLook = null;
      if (!this.warning) return null;
      this.okSince ??= now;
      if (now - this.okSince < this.endMs) return null;
      return this.close(this.okSince);
    }
    this.okSince = null;
    if (this.warning && this.warning !== look) {
      // A different problem: finish the old warning and start the new one right away.
      const done = this.close(now);
      this.open(look, now);
      return done;
    }
    if (this.warning) return null;
    if (this.badLook !== look) {
      this.badLook = look;
      this.badSince = now;
    }
    if (now - (this.badSince ?? now) >= this.startMs) this.open(look, this.badSince ?? now);
    return null;
  }

  /** Ends any open warning (e.g. when the exam is submitted). */
  flush(now: number) {
    return this.warning ? this.close(now) : null;
  }

  private open(look: Exclude<Look, "ok">, at: number) {
    this.warning = look;
    this.episodeStart = at;
    this.badSince = null;
    this.badLook = null;
  }

  private close(at: number) {
    const done = { kind: this.warning!, seconds: Math.max(1, Math.round((at - this.episodeStart) / 1000)) };
    this.warning = null;
    this.okSince = null;
    return done;
  }
}
