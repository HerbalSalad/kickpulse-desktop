// src/lib/elementAnimation.ts — shared animation rendering for HudElement,
// used identically by the editor canvas (HudDesigner.tsx) and the real OBS
// output (HudOverlay.tsx). Single source of truth, same reasoning as every
// other shared render piece in this app (see BorderEffect.tsx/
// BackgroundFx.tsx, and CLAUDE.md's own documented lesson about
// `bgCfgToCSS`'s duplication bug — a second copy of the same visual logic
// is exactly how that class of bug ships).
//
// Grew from 4 fixed, uncontrollable animations to 9 configurable ones
// (2026-08-17, direct request: "I want more... control [over] the glow
// pulsing, add some additional animations"). The original 4 (glow-pulse,
// glow-flicker, float, spin) keep their exact old look at their DEFAULT
// settings — every new param is optional and falls back to a value
// matching the original hardcoded behavior, so an element saved before
// this existed animates identically until someone actually opens its
// Animation section and changes something.
import type { HudElement, AnimationType } from './hudTypes';

let injected = false;
export function ensureAnimationKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  // @property registrations: only actually needed for values a keyframe
  // itself interpolates (glow-amount is animated FROM one length TO
  // another within one keyframe cycle). The transform-based animations
  // below (float/shake/bounce/wobble) reference their own custom property
  // as a plain, CONSTANT value inside each keyframe's own translateY/
  // rotate() — that doesn't need registration, the browser just reads
  // whatever the property currently holds when it evaluates that keyframe,
  // same reasoning the original `float` animation already relied on.
  style.textContent = `
    @property --hud-glow-amount { syntax: '<length>'; inherits: false; initial-value: 20px; }
    @keyframes hudGlowPulse {
      0%, 100% { box-shadow: 0 0 var(--hud-glow-amount) var(--hud-glow-color, #00ff9d), 0 0 calc(var(--hud-glow-amount) * 2) var(--hud-glow-color-dim, #00ff9d55); }
      50%      { box-shadow: 0 0 calc(var(--hud-glow-amount) * 1.8) var(--hud-glow-color, #00ff9d), 0 0 calc(var(--hud-glow-amount) * 3.4) var(--hud-glow-color-dim, #00ff9d55); }
    }
    @keyframes hudGlowFlicker {
      0%, 100% { opacity: 1; }
      20%      { opacity: var(--hud-flicker-floor, 0.65); }
      40%      { opacity: 1; }
      70%      { opacity: calc((1 + var(--hud-flicker-floor, 0.65)) / 2); }
    }
    @keyframes hudFloat {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(var(--hud-anim-dist, -8px)); }
    }
    @keyframes hudSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes hudPulseScale {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(var(--hud-pulse-max, 1.08)); }
    }
    @keyframes hudShake {
      0%, 100% { transform: translateX(0); }
      25%      { transform: translateX(var(--hud-anim-dist, 6px)); }
      75%      { transform: translateX(calc(var(--hud-anim-dist, 6px) * -1)); }
    }
    @keyframes hudBounce {
      0%, 100% { transform: translateY(0); animation-timing-function: cubic-bezier(.5,0,1,1); }
      50%      { transform: translateY(var(--hud-anim-dist, -20px)); animation-timing-function: cubic-bezier(0,0,.5,1); }
    }
    @keyframes hudWobble {
      0%, 100% { transform: rotate(0deg); }
      25%      { transform: rotate(var(--hud-wobble-deg, 6deg)); }
      75%      { transform: rotate(calc(var(--hud-wobble-deg, 6deg) * -1)); }
    }
    @keyframes hudRainbowCycle {
      from { filter: hue-rotate(0deg) saturate(var(--hud-rainbow-sat, 1.5)); }
      to   { filter: hue-rotate(360deg) saturate(var(--hud-rainbow-sat, 1.5)); }
    }
  `;
  document.head.appendChild(style);
}

const KEYFRAME_NAME: Partial<Record<AnimationType, string>> = {
  'glow-pulse': 'hudGlowPulse', 'glow-flicker': 'hudGlowFlicker', float: 'hudFloat', spin: 'hudSpin',
  'pulse-scale': 'hudPulseScale', shake: 'hudShake', bounce: 'hudBounce', wobble: 'hudWobble',
  'rainbow-cycle': 'hudRainbowCycle',
};

// Which controls the properties panel shows for a given animation type —
// every animation always gets Speed (handled separately, every type uses
// it), the rest are type-specific. `distanceLabel`/`distanceUnit` let the
// panel show "Distance (px)" vs "Angle (°)" accurately since `animDistance`
// is reused as degrees for wobble rather than adding a whole separate field
// just for one animation's one differently-unitless number.
export const ANIM_PARAM_SUPPORT: Record<AnimationType, { intensity?: boolean; distance?: boolean; distanceLabel?: string; color?: boolean }> = {
  none: {}, spin: {},
  'glow-pulse':   { intensity: true, color: true },
  'glow-flicker': { intensity: true },
  float:          { distance: true, distanceLabel: 'Distance (px)' },
  'pulse-scale':  { intensity: true },
  shake:          { distance: true, distanceLabel: 'Distance (px)' },
  bounce:         { distance: true, distanceLabel: 'Distance (px)' },
  wobble:         { distance: true, distanceLabel: 'Angle (°)' },
  'rainbow-cycle':{ intensity: true },
};

// Default SPEED per type (seconds/cycle) — matches each animation's
// original hardcoded duration exactly for the 4 that already existed, so
// nothing changes for an element saved before animSpeed existed.
const DEFAULT_SPEED: Partial<Record<AnimationType, number>> = {
  'glow-pulse': 1.6, 'glow-flicker': 0.9, float: 3, spin: 8,
  'pulse-scale': 1.6, shake: 0.4, bounce: 1.1, wobble: 1.8, 'rainbow-cycle': 4,
};
const DEFAULT_DISTANCE: Partial<Record<AnimationType, number>> = {
  float: 8, shake: 6, bounce: 20, wobble: 6,
};
const LINEAR_TYPES = new Set<AnimationType>(['spin', 'rainbow-cycle']);

// Returns the inline style (animation shorthand + whatever custom
// properties that specific type reads) for one element — spread directly
// into its own base style object. `{}` for 'none' or an unrecognized type.
export function elementAnimationStyle(el: HudElement): Record<string, string> {
  const type = el.animation;
  const keyframeName = KEYFRAME_NAME[type];
  if (!keyframeName) return {};

  const speed     = Math.max(0.1, el.animSpeed ?? DEFAULT_SPEED[type] ?? 2);
  const intensity = Math.min(100, Math.max(0, el.animIntensity ?? 50)); // 0-100
  const timing    = LINEAR_TYPES.has(type) ? 'linear' : 'ease-in-out';
  const style: Record<string, string> = {
    animation: `${keyframeName} ${speed}s ${timing} infinite`,
  };

  switch (type) {
    case 'glow-pulse': {
      const color = el.animColor || '#00ff9d';
      style['--hud-glow-color'] = color;
      style['--hud-glow-color-dim'] = `${color}55`;
      style['--hud-glow-amount'] = `${8 + (intensity / 100) * 24}px`;
      break;
    }
    case 'glow-flicker':
      style['--hud-flicker-floor'] = `${Math.max(0.05, 1 - intensity / 100)}`;
      break;
    case 'float':
      style['--hud-anim-dist'] = `${-Math.abs(el.animDistance ?? DEFAULT_DISTANCE.float!)}px`;
      break;
    case 'pulse-scale':
      style['--hud-pulse-max'] = `${1 + (intensity / 100) * 0.25}`;
      break;
    case 'shake':
      style['--hud-anim-dist'] = `${Math.abs(el.animDistance ?? DEFAULT_DISTANCE.shake!)}px`;
      break;
    case 'bounce':
      style['--hud-anim-dist'] = `${-Math.abs(el.animDistance ?? DEFAULT_DISTANCE.bounce!)}px`;
      break;
    case 'wobble':
      style['--hud-wobble-deg'] = `${Math.abs(el.animDistance ?? DEFAULT_DISTANCE.wobble!)}deg`;
      break;
    case 'rainbow-cycle':
      style['--hud-rainbow-sat'] = `${1 + intensity / 100}`;
      break;
  }
  return style;
}
