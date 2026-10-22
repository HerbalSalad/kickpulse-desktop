// src/components/BackgroundFx.tsx
// Purely decorative, canvas-wide background animations — sit behind every
// element, one style active at a time (see BackgroundFxCfg's own comment
// in lib/hudTypes.ts for why one-at-a-time rather than a stack of
// toggleable layers). Direct request, sparked by the border-trail bug
// investigation: "you can make interesting background animations like
// geometric shapes and stuff spinning at different speeds, so get
// creative." Same "let the GPU compositor drive it" approach as
// BorderEffect.tsx and Emote Rain's own particle rewrite — every animated
// piece here only ever animates `transform`/`opacity`, nothing that
// touches layout, so this costs nothing on the main thread once started
// regardless of how many shapes/particles are on screen.
//
// Rendered identically in the editor canvas (HudDesigner.tsx) and the real
// OBS output (HudOverlay.tsx) — single source of truth, same reasoning as
// every other shared render piece in this app (see CLAUDE.md's own
// documented lesson about `bgCfgToCSS`'s duplication bug: a second copy of
// the same visual logic is exactly how that class of bug ships).
import { useMemo, useEffect } from 'react';
import { CANVAS_W, CANVAS_H, type BackgroundFxCfg } from '../lib/hudTypes';

let stylesInjected = false;
function ensureKeyframes() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes hudBgSpinCW  { to { transform: rotate(360deg); } }
    @keyframes hudBgSpinCCW { to { transform: rotate(-360deg); } }
    @keyframes hudBgDrift {
      0%   { transform: translateY(0);    opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 1; }
      100% { transform: translateY(var(--drift-dist)); opacity: 0; }
    }
    @keyframes hudBgPing {
      0%   { transform: scale(0);   opacity: 0.9; }
      100% { transform: scale(1);   opacity: 0; }
    }
    @keyframes hudBgScan {
      0%   { transform: translateY(-4%); }
      100% { transform: translateY(104%); }
    }
  `;
  document.head.appendChild(style);
}

// Deterministic pseudo-random, seeded by index — so particle layout is
// identical every render (editor and real OBS output both call this same
// function with the same inputs) instead of reshuffling on every mount via
// Math.random().
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function polygonPoints(cx: number, cy: number, r: number, sides: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const SHAPES = [
  { sides: 3, sizeMul: 0.5,  speedMul: 1,    dir: 1  as const },
  { sides: 4, sizeMul: 0.72, speedMul: 0.62, dir: -1 as const },
  { sides: 6, sizeMul: 0.94, speedMul: 1.4,  dir: 1  as const },
];

function GeometricRings({ cfg }: { cfg: BackgroundFxCfg }) {
  const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
  const baseR = Math.min(CANVAS_W, CANVAS_H) * 0.44;
  return (
    <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {SHAPES.map((s, i) => (
        <polygon key={i}
          points={polygonPoints(cx, cy, baseR * s.sizeMul, s.sides)}
          fill="none" stroke={i % 2 === 0 ? cfg.color1 : cfg.color2} strokeWidth={2.5}
          opacity={cfg.opacity / 100}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: `${s.dir > 0 ? 'hudBgSpinCW' : 'hudBgSpinCCW'} ${Math.max(3, cfg.speed * s.speedMul)}s linear infinite`,
          }} />
      ))}
    </svg>
  );
}

function Particles({ cfg }: { cfg: BackgroundFxCfg }) {
  const count = Math.max(1, Math.min(60, Math.round(cfg.density * 8)));
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: seeded(i, 1) * 100,
    size: 3 + seeded(i, 2) * 6,
    dur: cfg.speed * (0.6 + seeded(i, 3) * 0.8),
    delay: -seeded(i, 4) * cfg.speed,
    color: i % 2 === 0 ? cfg.color1 : cfg.color2,
  })), [count, cfg.speed, cfg.color1, cfg.color2]);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', left: `${p.x}%`, bottom: 0,
          width: p.size, height: p.size, borderRadius: '50%',
          background: p.color, opacity: cfg.opacity / 100,
          boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
          ['--drift-dist' as string]: `-${CANVAS_H + 100}px`,
          animation: `hudBgDrift ${p.dur}s linear infinite`,
          animationDelay: `${p.delay}s`,
        } as React.CSSProperties} />
      ))}
    </div>
  );
}

function PulsingRings({ cfg }: { cfg: BackgroundFxCfg }) {
  const count = Math.max(1, Math.min(8, Math.round(cfg.density)));
  const maxSize = Math.min(CANVAS_W, CANVAS_H) * 0.9;
  const rings = useMemo(() => Array.from({ length: count }, (_, i) => ({
    delay: -(i * (cfg.speed / count)),
    color: i % 2 === 0 ? cfg.color1 : cfg.color2,
  })), [count, cfg.speed, cfg.color1, cfg.color2]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((r, i) => (
        <div key={i} style={{
          position: 'absolute', width: maxSize, height: maxSize, borderRadius: '50%',
          border: `2px solid ${r.color}`, opacity: cfg.opacity / 100,
          animation: `hudBgPing ${cfg.speed}s ease-out infinite`,
          animationDelay: `${r.delay}s`,
        }} />
      ))}
    </div>
  );
}

function Scanline({ cfg }: { cfg: BackgroundFxCfg }) {
  const gridOpacity = (cfg.opacity / 100) * 0.5;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage:
          `repeating-linear-gradient(0deg, ${cfg.color1}00 0, ${cfg.color1}00 79px, ${cfg.color1} 80px), ` +
          `repeating-linear-gradient(90deg, ${cfg.color1}00 0, ${cfg.color1}00 79px, ${cfg.color1} 80px)`,
        opacity: gridOpacity,
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '3%',
        background: `linear-gradient(180deg, transparent, ${cfg.color2}, transparent)`,
        opacity: cfg.opacity / 100,
        animation: `hudBgScan ${cfg.speed}s linear infinite`,
      }} />
    </div>
  );
}

// Deliberately NO explicit z-index — same reasoning as BorderEffectRing's
// own div (also z-index-free): this app's stacking order is managed
// entirely by DOM insertion order plus each real element's own zIndex,
// and a negative z-index here would fight unpredictably with that instead
// of cooperating with it. The CALLER is responsible for placing this
// component right after the flat background fill and BEFORE the real
// elements are rendered — see HudDesigner.tsx/HudOverlay.tsx, both of
// which insert it at exactly that point.
export default function BackgroundFx({ cfg }: { cfg?: BackgroundFxCfg }) {
  useEffect(ensureKeyframes, []);
  if (!cfg || cfg.type === 'none') return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {cfg.type === 'geometric-rings' && <GeometricRings cfg={cfg} />}
      {cfg.type === 'particles' && <Particles cfg={cfg} />}
      {cfg.type === 'pulsing-rings' && <PulsingRings cfg={cfg} />}
      {cfg.type === 'scanline' && <Scanline cfg={cfg} />}
    </div>
  );
}
