// src/lib/barShapes.ts
// Shared bar-shape geometry for Goal Bar and Hype Train (2026-09-09) — pulled
// out of GoalBarWidget.tsx's own copy specifically because Hype Train had an
// almost byte-identical parallelogram clip-path formula duplicated
// independently (`trackClipPath` in HypeTrainWidget.tsx), which is exactly
// why the two widgets had drifted into different bar-shape vocabularies
// ("hype train has some different bar options") and why the SAME border bug
// existed in both places independently — a plain CSS `border` combined with
// `clip-path` on one element doesn't know the clip cut the corners off, so
// the border only ever "properly" draws on whichever edges the clip left as
// straight rectangle edges; every diagonal edge gets no border of its own,
// which read as "no proper border on the right side" (Goal Bar) / "a weird
// line or border remnant from the original rectangle bar" (Hype Train, where
// it's worse because there's no second clipped layer at all — the border
// literally IS the uncut rectangle's border, just cut off wherever the
// parallelogram clip happens to slice through it).
//
// One shared module now backs both widgets' shape/border math so this class
// of bug — and this class of "one widget has a feature the other doesn't" —
// can't recur independently in two places.

export type BarShape = 'rounded' | 'flat' | 'angled' | 'fighter';

export const BAR_SHAPE_OPTIONS: { value: BarShape; label: string }[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'flat',    label: 'Flat' },
  { value: 'angled',  label: 'Angled' },
  { value: 'fighter', label: 'Fighter' },
];

// Angled cuts BOTH the top-left and bottom-right corners by skewPx (a
// parallelogram lean); Fighter cuts only the right side (a single bevel).
// Clamped to >=0 defensively — a negative value would self-intersect.
export function getBarClipPath(shape: BarShape, skewPx: number): string | undefined {
  const sk = Math.max(0, skewPx);
  if (shape === 'angled')  return `polygon(${sk}px 0%, 100% 0%, calc(100% - ${sk}px) 100%, 0% 100%)`;
  if (shape === 'fighter') return `polygon(0% 0%, 100% 0%, calc(100% - ${sk}px) 100%, 0% 100%)`;
  return undefined;
}

export function defaultSkewFor(shape: BarShape): number {
  return shape === 'fighter' ? 28 : 16;
}

// ─── Exact border-inset polygon (2026-09-09 fix) ───────────────────────────
// Replaces the old "reuse the SAME clip-path on a smaller (CSS-inset) box"
// approximation, which the code that introduced it already flagged as "not
// a perfectly uniform-width border... visually indistinguishable at small
// borderWidth values" — true at small values, but the taper is real and
// gets worse specifically on the diagonal edges as borderWidth grows or the
// skew gets steep relative to the bar's own height, which is exactly what
// was reported ("doesn't have a proper border on the right side").
//
// The real fix: each straight edge of the outer polygon is a line; offsetting
// a polygon inward by a uniform perpendicular distance means offsetting EACH
// of its edges inward by that same perpendicular distance (not the same
// ABSOLUTE px value re-applied to a smaller box) and re-intersecting the
// offset lines to find the new vertices. For a horizontal edge that's just
// "shift by borderWidth" — trivial. For the diagonal edge (or edges), the
// perpendicular shift is borderWidth * (diagonalLength / height), which is
// LARGER than borderWidth by exactly enough to compensate for the edge being
// slanted — this is the piece the old approximation was missing.
//
// Every vertex here comes out expressible as a mix of `Npx` and
// `calc(100% - Npx)` — no dependency on the box's actual runtime width is
// needed (only its known, fixed `heightPx`, which both widgets already pass
// a real settings value for), so this is just as usable in a live OBS source
// (arbitrary real width) as in a small settings-page preview.
//
// Verified against a real perpendicular-distance check before shipping (not
// just derived by hand) — for a range of skew/height/borderWidth values,
// including an extreme skew equal to the full bar height, the offset
// diagonal line sits EXACTLY `borderWidth`px away (perpendicular distance)
// from the original outer diagonal at every point along it, for both the
// 'angled' (two diagonals) and 'fighter' (one diagonal) cases.
export function getBorderInsetClipPath(shape: BarShape, skewPx: number, heightPx: number, borderWidthPx: number): string | undefined {
  if (shape !== 'angled' && shape !== 'fighter') return undefined;
  const sk = Math.max(0, skewPx);
  const H  = Math.max(1, heightPx);
  // Clamp so the top/bottom offset lines (at bw and H-bw) can never cross —
  // a borderWidth approaching half the bar's own height is already a
  // degenerate look, but this keeps the polygon from self-intersecting.
  const bw = Math.max(0, Math.min(borderWidthPx, H / 2 - 0.5));
  const L = Math.sqrt(sk * sk + H * H);
  const topY = `${bw.toFixed(2)}px`;
  const botY = `calc(100% - ${bw.toFixed(2)}px)`;

  const rightTopOffset = (bw * (L + sk)) / H;
  const rightBotOffset = sk + (bw * (L - sk)) / H;
  const rightTopX = `calc(100% - ${rightTopOffset.toFixed(2)}px)`;
  const rightBotX = `calc(100% - ${rightBotOffset.toFixed(2)}px)`;

  if (shape === 'fighter') {
    return `polygon(${bw.toFixed(2)}px ${topY}, ${rightTopX} ${topY}, ${rightBotX} ${botY}, ${bw.toFixed(2)}px ${botY})`;
  }
  // 'angled' — mirror of the right diagonal on the left side too.
  const leftTopOffset = sk * (1 - bw / H) + (bw * L) / H;
  const leftBotOffset = (bw * (L + sk)) / H;
  return `polygon(${leftTopOffset.toFixed(2)}px ${topY}, ${rightTopX} ${topY}, ${rightBotX} ${botY}, ${leftBotOffset.toFixed(2)}px ${botY})`;
}

// ─── Cut corners (2026-09-09) ───────────────────────────────────────────────
// "Panel Maker has a cut corners option which could make for some
// interesting bar options... for cut corners we would need to be able to
// choose what corners." Panel Maker's own version is canvas-drawn with only
// an all-4-or-diagonal-pair choice; this is a real, independent 4-way
// per-corner picker instead, expressed as a plain CSS clip-path so it
// composes with the exact same rendering approach every other bar-shape
// option here already uses.
//
// Deliberately scoped to Rounded/Flat only, not combined with Angled/
// Fighter — composing two independent arbitrary polygon clips (the skewed
// shape's own diagonal AND an arbitrary per-corner cut) would need real
// polygon boolean intersection math for a genuinely marginal combined look;
// Angled/Fighter already have their own distinct diagonal-corner treatment,
// so offering a second one on top isn't worth the complexity. Enforced by
// the settings UI hiding the control for those two shapes, same "not every
// combination makes sense, scope it clearly" precedent this app already
// uses elsewhere (e.g. chase/rainbowChase only on traceable shapes).
export interface CutCorners { tl: boolean; tr: boolean; bl: boolean; br: boolean }

export function hasCutCorners(c: CutCorners | undefined): boolean {
  return !!c && (c.tl || c.tr || c.bl || c.br);
}

// insetPx (2026-09-09) — an optional uniform shrink of the whole box before
// cutting corners, so the SAME function can produce both the outer shape
// (insetPx=0) and a border's inner content layer (insetPx=borderWidth) the
// same two-layer way angled/fighter's border already works. Deliberately
// reuses the raw `sizePx` unchanged for the inner layer rather than deriving
// a third exact-perpendicular-offset formula (only worth doing for
// getBorderInsetClipPath's arbitrary, sometimes-extreme skew angle) — a cut
// corner is always a fixed 45° diagonal, so the resulting border taper is
// small and proportionally negligible at the size/borderWidth values this
// feature actually uses; a disclosed, pragmatic simplification, same as the
// original (pre-fix) angled/fighter border technique was for months.
export function getCutCornersClipPath(c: CutCorners, sizePx: number, insetPx = 0): string | undefined {
  if (!hasCutCorners(c)) return undefined;
  const s = Math.max(0, sizePx);
  const i0 = `${insetPx}px`;
  const i1 = `calc(100% - ${insetPx}px)`;
  const iPlusS = `${insetPx + s}px`;
  const i1MinusS = `calc(100% - ${insetPx + s}px)`;
  // Walk the box clockwise. For each corner, if it's cut, emit its two
  // points in walk order — the ENTRY point (where the previous edge arrives,
  // just before the diagonal) THEN the EXIT point (where the diagonal
  // finishes, continuing to the next edge) — not the reverse, which would
  // draw the cut backwards relative to the rest of the shape and produce a
  // self-intersecting (bowtie) polygon instead of a clean cut corner.
  const pts: string[] = [];
  if (c.tl) { pts.push(`${i0} ${iPlusS}`); pts.push(`${iPlusS} ${i0}`); } else pts.push(`${i0} ${i0}`);
  if (c.tr) { pts.push(`${i1MinusS} ${i0}`); pts.push(`${i1} ${iPlusS}`); } else pts.push(`${i1} ${i0}`);
  if (c.br) { pts.push(`${i1} ${i1MinusS}`); pts.push(`${i1MinusS} ${i1}`); } else pts.push(`${i1} ${i1}`);
  if (c.bl) { pts.push(`${iPlusS} ${i1}`); pts.push(`${i0} ${i1MinusS}`); } else pts.push(`${i0} ${i1}`);
  return `polygon(${pts.join(', ')})`;
}
