// src/components/BorderEffect.tsx
// Animated/glowing border effects — usable on the whole overlay canvas or
// on an individual Cam/Game Capture element (2026-08-16, direct request:
// "a way to make some cool borders around the entire overlay... an option
// for cam and game capture... a configurable gradient trail, or rainbow
// trail as it goes around the border").
//
// Two independent pieces, both driven by the same BorderEffectCfg:
//   'glow'         — a soft box-shadow ring around the element, using a
//                    plain CSS `transition` to fade in from a zero-spread
//                    shadow to the full one on mount (useGlowBoxShadow).
//   'chase'/       — an animated ring that continuously travels around the
//   'rainbowChase'   border: a conic-gradient sized to the element, masked
//                    down to just a border-width band via mask-composite
//                    (<BorderEffectRing>). Animated by advancing the
//                    gradient's OWN start angle (a registered CSS custom
//                    property, --hud-border-angle) rather than rotating the
//                    whole masked element with a transform — see the real
//                    bug this fixes, 2026-08-17 below.

// **2026-08-17 bug fix — reported directly: "the trail options didnt
// work, they end up just spinning a giant rectangle instead of tracing
// around the border like we intended."** Confirmed empirically (a Puppeteer
// render of this exact component, screenshotted through several points of
// its own rotation) rather than guessed: the original version animated
// `transform: rotate(360deg)` on the WHOLE masked box. That's correct for
// a circle — a circle looks identical at every rotation angle — but for
// any non-square rectangle (a Goal Bar, the whole 1920×1080 canvas, any
// Game Capture box), rotating the entire ring as a rigid shape swings its
// own corners way outside the actual element's footprint as the angle
// passes through the 30–60° range, which is exactly the "giant
// spinning rectangle" that was reported — a real, reproducible rendering
// bug, not a description of the intended look. Fixed by animating the
// conic-gradient's own start angle instead, via a registered custom
// property (`@property --hud-border-angle`, `ensureSpinKeyframes()` below)
// — the box itself never rotates, so the ring stays flush to the real
// border at every frame regardless of aspect ratio. Re-verified the same
// way (screenshots at 0°/90°/180°/270° of gradient-angle, a wide
// rectangle) before shipping.
//
// Both are deliberately INSET (hugging the inside edge of the element,
// never bleeding past it) rather than bleeding outward past the box: an
// outward bleed would get clipped by the overflow:hidden every Cam/Game
// Capture box already uses, and for the whole-canvas usage specifically,
// anything bleeding past the 1920×1080 frame would never be visible in OBS
// anyway (a Browser Source crops to exactly its configured dimensions) — so
// inset is the only choice that's actually correct in both places, not
// just the simpler one.
import { useEffect, useState } from 'react';
import type { BorderEffectCfg } from '../lib/hudTypes';

let stylesInjected = false;
function ensureSpinKeyframes() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  // The @property registration is what makes --hud-border-angle a real
  // ANIMATABLE angle value (browsers can't smoothly interpolate a bare
  // custom property between two <angle> values without this — it would
  // otherwise just jump discretely at the keyframe boundary, same reason
  // any Houdini-typed custom property needs registering before animating).
  style.textContent = `
    @property --hud-border-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
    @keyframes hudBorderSpin { to { --hud-border-angle: 360deg; } }
  `;
  document.head.appendChild(style);
}

function glowShadow(cfg: BorderEffectCfg, on: boolean): string {
  return on
    ? `inset 0 0 ${cfg.width * 3}px ${cfg.width}px ${cfg.color1}`
    : `inset 0 0 0px 0px ${cfg.color1}`;
}

// `inset` box-shadow (not a normal outward one) — draws the glow just
// inside the element's own edge instead of bleeding out past it, for the
// same clipping/OBS-crop reasoning as the file header above.
export function useGlowBoxShadow(cfg?: BorderEffectCfg): React.CSSProperties {
  const [on, setOn] = useState(false);
  const isGlow = !!cfg && cfg.style === 'glow';

  useEffect(() => {
    if (!isGlow) { setOn(false); return; }
    if (!cfg!.fadeIn) { setOn(true); return; }
    setOn(false);
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGlow, cfg?.color1, cfg?.width, cfg?.fadeIn]);

  if (!isGlow) return {};
  return {
    boxShadow: glowShadow(cfg!, on),
    transition: 'box-shadow 1.5s ease-out',
  };
}

export default function BorderEffectRing({ cfg, radius = 0 }: { cfg?: BorderEffectCfg; radius?: number }) {
  useEffect(ensureSpinKeyframes, []);
  if (!cfg || (cfg.style !== 'chase' && cfg.style !== 'rainbowChase')) return null;

  // `from var(--hud-border-angle)` — NOT a literal `0deg` — is the actual
  // fix. Animating this custom property (instead of a transform on the
  // element) advances the gradient's own rotational phase while the
  // element itself stays perfectly still, so the masked ring stays flush
  // to the real border at every frame regardless of aspect ratio. See the
  // file header's 2026-08-17 bug fix note for why the old transform-based
  // version broke on anything that wasn't a circle.
  const gradient = cfg.style === 'rainbowChase'
    ? 'conic-gradient(from var(--hud-border-angle), #ff0000, #ff8800, #ffee00, #22ff00, #00e5ff, #3366ff, #cc00ff, #ff0000)'
    : `conic-gradient(from var(--hud-border-angle), transparent 0%, ${cfg.color1} 15%, ${cfg.color2} 30%, transparent 45%, transparent 100%)`;

  // 'outside' (2026-09-02): same content-box-exclude masking technique,
  // just applied to a box that's bigger than the element instead of one
  // that's inset within it — the padding still equals cfg.width, so the
  // masked band's THICKNESS is identical either way, only which side of
  // the element's real edge it falls on changes. Growing the box outward
  // by `width` on every side (instead of `inset:0`) means the box's own
  // padding-inset content-box now lands exactly on the element's real
  // edge, so XOR-ing it against the box's own (now larger) full extent
  // leaves precisely the band OUTSIDE the element, not inside it.
  const outside = cfg.position === 'outside';

  // Real bug, found via a Progress Ring report ("spin trail still seems
  // like its getting slightly flattened on the top and sides... should be
  // a perfect circle") and confirmed with precise render geometry:
  // 'outside' mode grows this div's own box by `cfg.width` on every side
  // (the negative inset below), but `borderRadius` was never adjusted to
  // match — so a caller passing radius = exactly half the TARGET element's
  // own width (the correct value for tracing a true circle) ends up with a
  // radius that's now too SMALL relative to the newly-widened box, which
  // flattens the circle at its 12/3/6/9 o'clock points (closest to the
  // box's own straight edges) into a rounded-square. Growing the radius by
  // the SAME amount the box grew keeps the corner treatment visually
  // consistent at any size — for the radius = width/2 case specifically,
  // this is exactly the algebra that keeps it a true circle:
  // (W/2 + pad) == (W + 2*pad)/2. Guarded to radius > 0 only, so a sharp-
  // cornered rectangle (radius 0, used by every whole-canvas/Game-Capture
  // caller with square corners) is completely unaffected — 0 + pad would
  // otherwise introduce rounding that was never there before.
  const effectiveRadius = outside && radius > 0 ? radius + cfg.width : radius;

  return (
    <div style={{
      position: 'absolute',
      ...(outside
        ? { top: -cfg.width, right: -cfg.width, bottom: -cfg.width, left: -cfg.width }
        : { inset: 0 }),
      borderRadius: effectiveRadius,
      padding: cfg.width, pointerEvents: 'none',
      background: gradient,
      WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      WebkitMaskComposite: 'xor',
      maskComposite: 'exclude',
      animation: `hudBorderSpin ${Math.max(0.5, cfg.speed)}s linear infinite`,
    } as React.CSSProperties} />
  );
}
