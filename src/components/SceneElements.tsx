// src/components/SceneElements.tsx — real, faithful rendering of a Pulse
// Scene/Alert Studio scene, ported directly from the website's
// src/components/widgets/AlertStudioWidget.tsx (not a simplified stand-in —
// see the 2026-10-15 rewrite note below for why the earlier version of this
// file was replaced wholesale). Every element type, every background type,
// every accent, and the sacred-geometry shape engine are all real ports of
// the exact same logic the website renders, adapted only where the website
// itself is kind-aware (Alert Studio's StudioEventType) — those spots use
// this app's own generic SceneFirePayload (sceneTokens.ts/studioTokens.ts
// already bridge Alert Studio's own richer token vocabulary into that same
// generic shape via payload.extraTokens, so one render path serves both
// Scenes and Alert Studio here exactly as it does on the website).
//
// 2026-10-15 rewrite — the PREVIOUS version of this file was a deliberately
// simplified stand-in (see its own now-removed header): shapes rendered as a
// plain box instead of real generated geometry, 8 of 12 background types
// degraded to a flat color fill, only the FIRST of a text element's accents
// was honored (of only 5 of the real 11 types), fill elements never got
// their angled/fighter/cut-corner geometry, media border trails never
// chased, and typewriter/scroll/bounce text reveal all just faded in. This
// is exactly why a real saved scene using any of those "cool" features
// looked completely different here than it does on the website — direct,
// sharp feedback: "nothing looks the same as it is on the site... get this
// right." Rebuilt field-for-field against the real file instead.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  SceneBackground, SceneElement, TextElement, MediaElement, LightElement,
  ShapeElement, FillElement, CounterElement, ContainerElement, TextAccentInstance,
} from '../lib/sceneTypes';
import { isVideoUrl, hexToRgba } from '../lib/sceneTypes';
import { buildSceneText, resolveSceneMediaUrl, resolveSceneCounterTarget } from '../lib/sceneTokens';
import type { SceneFirePayload } from '../lib/sceneTypes';
import BorderEffectRing from './BorderEffect';
import type { BorderEffectCfg } from '../lib/hudTypes';
import { buildShapePrimitives, isTraceableShape, type ShapeKind } from '../lib/sacredGeometry';
import { getBarClipPath, getBorderInsetClipPath, getCutCornersClipPath, hasCutCorners } from '../lib/barShapes';

// ─── Tag-safe HTML reveal tokenizer (typewriter) ────────────────────────────
// Ported from the website's useAlerts.ts (tokenizeHtmlForReveal/revealHtml) —
// never slices a typed `<span>` tag in half while a typewriter reveal is
// mid-flight; only real, counting characters ever get sliced, every `<...>`
// tag passes through whole the instant reveal reaches it.
export interface RevealToken { text: string; countsAsChar: boolean }
export function tokenizeHtmlForReveal(html: string): RevealToken[] {
  const tokens: RevealToken[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { tokens.push({ text: html.slice(i), countsAsChar: false }); break; }
      tokens.push({ text: html.slice(i, end + 1), countsAsChar: false });
      i = end + 1;
    } else {
      tokens.push({ text: html[i], countsAsChar: true });
      i++;
    }
  }
  return tokens;
}
export function revealHtml(tokens: RevealToken[], count: number): string {
  let shown = 0;
  let out = '';
  for (const t of tokens) {
    if (t.countsAsChar) {
      if (shown >= count) break;
      shown++;
    }
    out += t.text;
  }
  return out;
}

// ─── Shared count-up (mirrors the website's useCountUp.ts) ──────────────────
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = Math.max(1, durationMs);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return value;
}

// ─── One-time injected CSS (keyframes + utility classes) — full parity with
// the website's `alert-studio-css` sheet, just using this app's own `sc-`
// class prefix (no risk of collision — this is a separate app). ─────────────
const CSS_ID = 'kp-scene-css';
export function ensureSceneCss(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
@keyframes sc-fadeIn{from{opacity:0}to{opacity:1}}
@keyframes sc-scrollLeft{from{transform:translateX(-120%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-scrollRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-slideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes sc-slideDown{from{transform:translateY(-60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes sc-zoom{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes sc-bounce{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.15);opacity:1}80%{transform:scale(.92)}100%{transform:scale(1)}}
@keyframes sc-flip{from{transform:rotateY(90deg);opacity:0}to{transform:rotateY(0deg);opacity:1}}
@keyframes sc-mediaSlideLeft{from{transform:translateX(-140%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-mediaSlideRight{from{transform:translateX(140%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-lightPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.28);opacity:.55}}
@keyframes sc-lightFlicker{0%,19%,21%,23%,54%,56%,100%{opacity:1}20%,22%,55%{opacity:.3}}
@keyframes sc-lightDrift{0%{transform:translate(0,0)}25%{transform:translate(10px,-8px)}50%{transform:translate(-8px,6px)}75%{transform:translate(6px,10px)}100%{transform:translate(0,0)}}
@keyframes sc-lightHue{from{filter:blur(3px) hue-rotate(0deg)}to{filter:blur(3px) hue-rotate(360deg)}}
@keyframes sc-gradShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes sc-cursorBlink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes sc-particleFloat{0%{transform:translateY(0) scale(1);opacity:0}10%{opacity:1}100%{transform:translateY(-160px) scale(.35);opacity:0}}
@keyframes sc-confettiFall{0%{transform:translateY(-30px) rotate(0deg);opacity:0}10%{opacity:1}100%{transform:translateY(720px) rotate(560deg);opacity:0}}
@keyframes sc-raysSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes sc-auroraDrift{0%{transform:translate(-10%,-5%) scale(1)}50%{transform:translate(10%,8%) scale(1.15)}100%{transform:translate(-10%,-5%) scale(1)}}
@keyframes sc-shapeSpin{to{transform:rotate(360deg)}}
@keyframes sc-shapeSpinRev{to{transform:rotate(-360deg)}}
@keyframes sc-shapePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.06)}}
@keyframes sc-traceDash{to{stroke-dashoffset:-100}}
@keyframes sc-hueSpin{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(360deg)}}
@keyframes sc-twinkle{0%,100%{opacity:.15}50%{opacity:1}}
@keyframes sc-gridScroll{from{background-position:0 0}to{background-position:48px 48px}}
@keyframes sc-radarSweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.sc-shape-spin{animation-name:sc-shapeSpin;animation-timing-function:linear;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-shape-spinReverse{animation-name:sc-shapeSpinRev;animation-timing-function:linear;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-shape-pulse{animation-name:sc-shapePulse;animation-timing-function:ease-in-out;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-media-anim-spin{animation-name:sc-shapeSpin;animation-timing-function:linear;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-media-anim-spinReverse{animation-name:sc-shapeSpinRev;animation-timing-function:linear;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-media-anim-pulse{animation-name:sc-shapePulse;animation-timing-function:ease-in-out;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-media-anim-shake{animation-name:sc-textShake;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-media-anim-wobble{animation-name:sc-textWobble;animation-timing-function:ease-in-out;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-media-anim-bounce{animation-name:sc-textBounce;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-media-anim-heartbeat{animation-name:sc-textHeartbeat;animation-timing-function:ease-in-out;animation-iteration-count:infinite;transform-origin:50% 50%}
.sc-shape-trace{stroke-dasharray:25 75;animation-name:sc-traceDash;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-shape-rainbowHue{animation-name:sc-hueSpin;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-star{position:absolute;border-radius:50%;animation-name:sc-twinkle;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-grid{position:absolute;inset:0;animation-name:sc-gridScroll;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-radar-sweep{position:absolute;inset:-200%;animation-name:sc-radarSweep;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-geo-layer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.sc-cursor{display:inline-block;width:.5em;margin-left:3px;border-bottom:4px solid;animation:sc-cursorBlink .8s steps(1) infinite;vertical-align:baseline}
.sc-reveal-fade{animation:sc-fadeIn .6s both}
.sc-reveal-scroll-left{animation:sc-scrollLeft .6s ease-out both}
.sc-reveal-scroll-right{animation:sc-scrollRight .6s ease-out both}
.sc-reveal-slide-up{animation:sc-slideUp .6s ease-out both}
.sc-reveal-slide-down{animation:sc-slideDown .6s ease-out both}
.sc-reveal-zoom{animation:sc-zoom .5s ease-out both}
.sc-reveal-bounce{animation:sc-bounce .7s ease-out both}
.sc-reveal-media-fade{animation:sc-fadeIn .6s both}
.sc-reveal-media-zoom{animation:sc-zoom .5s ease-out both}
.sc-reveal-media-slide-up{animation:sc-slideUp .6s ease-out both}
.sc-reveal-media-slide-down{animation:sc-slideDown .6s ease-out both}
.sc-reveal-media-slide-left{animation:sc-mediaSlideLeft .6s ease-out both}
.sc-reveal-media-slide-right{animation:sc-mediaSlideRight .6s ease-out both}
.sc-reveal-media-bounce{animation:sc-bounce .7s ease-out both}
.sc-reveal-media-flip{animation:sc-flip .6s ease-out both}
.sc-light-pulse{animation-name:sc-lightPulse;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-light-flicker{animation-name:sc-lightFlicker;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-light-drift{animation-name:sc-lightDrift;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-light-rotateHue{animation-name:sc-lightHue;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-particle{position:absolute;border-radius:50%;animation-name:sc-particleFloat;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-confetti{position:absolute;animation-name:sc-confettiFall;animation-timing-function:linear;animation-iteration-count:infinite}
/* -200% inset — same real math as the website's own as-rays comment: a
   rotating layer inset by -X% only has half-extent (1+2X/100)/2 times the
   container's half-width/height on EACH axis, but the container's own
   CORNER sits at sqrt(halfW²+halfH²) — bigger than either half-dimension
   alone for any non-square (every real) canvas. -200% clears 16:9 with
   real margin (confirmed on the website via a real render before fixing a
   -50%/-60% version that visibly left corners exposed). */
.sc-rays{position:absolute;inset:-200%;animation:sc-raysSpin 18s linear infinite}
.sc-aurora{position:absolute;width:60%;height:60%;border-radius:50%;filter:blur(60px);animation-name:sc-auroraDrift;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
@keyframes sc-sceneInUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes sc-sceneInDown{from{transform:translateY(-60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes sc-sceneInLeft{from{transform:translateX(-100px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-sceneInRight{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-sceneInZoom{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes sc-sceneOut{from{opacity:1}to{opacity:0}}
@keyframes sc-sceneOutUp{from{transform:translateY(0);opacity:1}to{transform:translateY(-60px);opacity:0}}
@keyframes sc-sceneOutDown{from{transform:translateY(0);opacity:1}to{transform:translateY(60px);opacity:0}}
@keyframes sc-sceneOutLeft{from{transform:translateX(0);opacity:1}to{transform:translateX(-100px);opacity:0}}
@keyframes sc-sceneOutRight{from{transform:translateX(0);opacity:1}to{transform:translateX(100px);opacity:0}}
@keyframes sc-sceneOutZoom{from{transform:scale(1);opacity:1}to{transform:scale(1.1);opacity:0}}
.sc-scene-in-fade{animation-name:sc-fadeIn;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-scene-in-slide-up{animation-name:sc-sceneInUp;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-scene-in-slide-down{animation-name:sc-sceneInDown;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-scene-in-slide-left{animation-name:sc-sceneInLeft;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-scene-in-slide-right{animation-name:sc-sceneInRight;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-scene-in-zoom{animation-name:sc-sceneInZoom;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-scene-out-fade{animation-name:sc-sceneOut;animation-timing-function:ease-in;animation-fill-mode:both}
.sc-scene-out-slide-up{animation-name:sc-sceneOutUp;animation-timing-function:ease-in;animation-fill-mode:both}
.sc-scene-out-slide-down{animation-name:sc-sceneOutDown;animation-timing-function:ease-in;animation-fill-mode:both}
.sc-scene-out-slide-left{animation-name:sc-sceneOutLeft;animation-timing-function:ease-in;animation-fill-mode:both}
.sc-scene-out-slide-right{animation-name:sc-sceneOutRight;animation-timing-function:ease-in;animation-fill-mode:both}
.sc-scene-out-zoom{animation-name:sc-sceneOutZoom;animation-timing-function:ease-in;animation-fill-mode:both}
@keyframes sc-containerPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.4)}}
@keyframes sc-containerFlicker{0%,19%,21%,23%,54%,56%,100%{opacity:1}20%,22%,55%{opacity:.55}}
@keyframes sc-containerShine{0%{transform:translateX(-130%) skewX(-15deg)}100%{transform:translateX(130%) skewX(-15deg)}}
@keyframes sc-containerScan{0%{transform:translateY(-100%)}100%{transform:translateY(220%)}}
.sc-container-pulse{animation-name:sc-containerPulse;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-container-flicker{animation-name:sc-containerFlicker;animation-timing-function:linear;animation-iteration-count:infinite}
.sc-container-shine{position:absolute;inset:-10% -30%;animation-name:sc-containerShine;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-container-scan{position:absolute;left:0;right:0;height:35%;animation-name:sc-containerScan;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sc-textPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes sc-textShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
@keyframes sc-textWobble{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}}
@keyframes sc-textBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes sc-textGlow{0%,100%{filter:drop-shadow(0 0 var(--sc-glow-min,4px) var(--sc-glow-color,currentColor))}50%{filter:drop-shadow(0 0 var(--sc-glow-max,16px) var(--sc-glow-color,currentColor))}}
@keyframes sc-textRainbow{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(360deg)}}
.sc-text-accent-pulse{display:inline-block;animation-name:sc-textPulse;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-text-accent-shake{display:inline-block;animation-name:sc-textShake;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-text-accent-wobble{display:inline-block;animation-name:sc-textWobble;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-text-accent-bounce{display:inline-block;animation-name:sc-textBounce;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-text-accent-glow{display:inline-block;animation-name:sc-textGlow;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-text-accent-rainbow{display:inline-block;animation-name:sc-textRainbow;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sc-textGlowRainbow{
  0%{filter:drop-shadow(0 0 var(--sc-glow-min,4px) #ff2ec2)}
  16.6%{filter:drop-shadow(0 0 var(--sc-glow-max,16px) #ff7a1a)}
  33.3%{filter:drop-shadow(0 0 var(--sc-glow-min,4px) #ffe100)}
  50%{filter:drop-shadow(0 0 var(--sc-glow-max,16px) #2bff5e)}
  66.6%{filter:drop-shadow(0 0 var(--sc-glow-min,4px) #22c9ff)}
  83.3%{filter:drop-shadow(0 0 var(--sc-glow-max,16px) #a259ff)}
  100%{filter:drop-shadow(0 0 var(--sc-glow-min,4px) #ff2ec2)}
}
.sc-text-accent-glowRainbow{display:inline-block;animation-name:sc-textGlowRainbow;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sc-textNeonFlicker{
  0%,19%,21%,23%,54%,56%,100%{filter:drop-shadow(0 0 var(--sc-neon-max,14px) var(--sc-neon-color,currentColor));opacity:1}
  20%,22%,55%{filter:drop-shadow(0 0 2px var(--sc-neon-color,currentColor));opacity:.35}
}
.sc-text-accent-neonFlicker{display:inline-block;animation-name:sc-textNeonFlicker;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sc-textHeartbeat{0%,100%{transform:scale(1)}14%{transform:scale(var(--sc-heart-scale,1.16))}28%{transform:scale(1)}42%{transform:scale(var(--sc-heart-scale,1.16))}70%{transform:scale(1)}}
.sc-text-accent-heartbeat{display:inline-block;animation-name:sc-textHeartbeat;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
@keyframes sc-textGlitch{
  0%,100%{text-shadow:none;transform:translate(0,0)}
  8%{text-shadow:2px 0 0 rgba(255,0,60,.85),-2px 0 0 rgba(0,220,255,.85);transform:translate(-2px,1px)}
  10%{text-shadow:none;transform:translate(0,0)}
  35%{text-shadow:-3px 0 0 rgba(255,0,60,.85),3px 0 0 rgba(0,220,255,.85);transform:translate(2px,-1px)}
  37%{text-shadow:none;transform:translate(0,0)}
  60%{text-shadow:1px 0 0 rgba(255,0,60,.85),-1px 0 0 rgba(0,220,255,.85);transform:translate(-1px,1px)}
  62%,100%{text-shadow:none;transform:translate(0,0)}
}
.sc-text-accent-glitch{display:inline-block;animation-name:sc-textGlitch;animation-timing-function:steps(1);animation-iteration-count:infinite}
@keyframes sc-textChromeSweep{0%{background-position:220% 0}100%{background-position:-220% 0}}
.sc-text-accent-chrome{display:inline-block;background-size:300% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation-name:sc-textChromeSweep;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sc-letterWave{0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-1 * var(--sc-wave-amp,10px)))}}
.sc-letter-wave{display:inline-block;animation-name:sc-letterWave;animation-duration:var(--sc-wave-speed,0.7s);animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.sc-var-rainbow{display:inline-block;animation-name:sc-textRainbow;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sc-fillFadeIn{from{opacity:0}to{opacity:1}}
@keyframes sc-fillZoom{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes sc-fillSlideLeft{from{transform:translateX(-60px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-fillSlideRight{from{transform:translateX(60px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes sc-fillSlideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes sc-fillSlideDown{from{transform:translateY(-60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes sc-fillGrowLeft{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes sc-fillGrowRight{from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0 0 0 0)}}
@keyframes sc-fillGrowUp{from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes sc-fillGrowDown{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
.sc-fill-entrance-fade{animation-name:sc-fillFadeIn;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-zoom{animation-name:sc-fillZoom;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-slide-left{animation-name:sc-fillSlideLeft;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-slide-right{animation-name:sc-fillSlideRight;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-slide-up{animation-name:sc-fillSlideUp;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-slide-down{animation-name:sc-fillSlideDown;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-grow-left{animation-name:sc-fillGrowLeft;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-grow-right{animation-name:sc-fillGrowRight;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-grow-up{animation-name:sc-fillGrowUp;animation-timing-function:ease-out;animation-fill-mode:both}
.sc-fill-entrance-grow-down{animation-name:sc-fillGrowDown;animation-timing-function:ease-out;animation-fill-mode:both}
`;
  document.head.appendChild(style);
}

// ─── Whole-scene enter/exit (used by ScenesOverlay.tsx directly) ───────────
type EnterExit = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom';
const SCENE_IN: Record<string, string> = {
  fade: 'sc-scene-in-fade', 'slide-up': 'sc-scene-in-slide-up', 'slide-down': 'sc-scene-in-slide-down',
  'slide-left': 'sc-scene-in-slide-left', 'slide-right': 'sc-scene-in-slide-right', zoom: 'sc-scene-in-zoom',
};
const SCENE_OUT: Record<string, string> = {
  fade: 'sc-scene-out-fade', 'slide-up': 'sc-scene-out-slide-up', 'slide-down': 'sc-scene-out-slide-down',
  'slide-left': 'sc-scene-out-slide-left', 'slide-right': 'sc-scene-out-slide-right', zoom: 'sc-scene-out-zoom',
};
export function entranceAnimStyle(kind: EnterExit | string, exiting: boolean, seconds: number): { className?: string } & React.CSSProperties {
  const table = exiting ? SCENE_OUT : SCENE_IN;
  const cls = kind === 'none' ? '' : (table[kind] ?? (exiting ? SCENE_OUT.fade : SCENE_IN.fade));
  return cls ? ({ className: cls, animationDuration: `${Math.max(0.1, seconds)}s` } as any) : {};
}

// ─── Media (image/gif/webm/mp4), with real volume/trim/loop ────────────────
function SceneMedia({ src, fit, loop, volume, trimStart, trimEnd, onEnded }: {
  src: string; fit: 'contain' | 'cover'; loop: boolean;
  volume?: number; trimStart?: number; trimEnd?: number; onEnded?: () => void;
}) {
  const style: React.CSSProperties = { width: '100%', height: '100%', objectFit: fit, display: 'block' };
  if (!isVideoUrl(src)) return <img src={src} alt="" style={style} draggable={false} />;
  return <SceneVideo src={src} style={style} loop={loop} volume={volume} trimStart={trimStart} trimEnd={trimEnd} onEnded={onEnded} />;
}

function SceneVideo({ src, style, loop, volume, trimStart, trimEnd, onEnded: onEndedProp }: {
  src: string; style: React.CSSProperties; loop: boolean;
  volume?: number; trimStart?: number; trimEnd?: number; onEnded?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const start = Math.max(0, trimStart || 0);
  const vol = Math.max(0, Math.min(100, volume ?? 0)) / 100;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = vol;
    v.muted = vol === 0;
  }, [vol]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.readyState >= 1 && start > 0) v.currentTime = start;
    const restart = () => { v.currentTime = start; v.play().catch(() => {}); };
    const onLoadedMeta = () => { if (start > 0) v.currentTime = start; };
    const onNativeEnded = () => { onEndedProp?.(); if (loop) restart(); };
    v.addEventListener('loadedmetadata', onLoadedMeta);
    v.addEventListener('ended', onNativeEnded);
    let raf = 0;
    const tick = () => {
      if (trimEnd != null && !v.paused && v.currentTime >= trimEnd) {
        onEndedProp?.();
        if (loop) restart(); else v.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    if (trimEnd != null) raf = requestAnimationFrame(tick);
    return () => {
      v.removeEventListener('loadedmetadata', onLoadedMeta);
      v.removeEventListener('ended', onNativeEnded);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [start, trimEnd, loop, onEndedProp]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => { v.muted = true; v.play().catch(() => {}); });
  }, [src]);

  return <video ref={ref} src={src} style={{ background: 'transparent', ...style }} autoPlay muted={vol === 0} playsInline draggable={false} />;
}

// ─── Background ─────────────────────────────────────────────────────────────
function buildParticles(count: number, color: string) {
  return Array.from({ length: count }).map((_, i) => {
    const size = 3 + Math.random() * 6;
    return { id: i, style: {
      left: `${Math.random() * 100}%`, bottom: `${Math.random() * 90}%`, width: size, height: size,
      background: `#${color}`, boxShadow: `0 0 ${size * 2}px #${color}`,
      animationDuration: `${3 + Math.random() * 4}s`, animationDelay: `${Math.random() * 4}s`,
    } as React.CSSProperties };
  });
}
function buildConfetti(count: number, color: string) {
  return Array.from({ length: count }).map((_, i) => {
    const size = 6 + Math.random() * 8;
    return { id: i, style: {
      left: `${Math.random() * 100}%`, top: '-5%', width: size, height: size * 0.4,
      background: `#${color}`, transform: `rotate(${Math.random() * 360}deg)`,
      animationDuration: `${2.5 + Math.random() * 3}s`, animationDelay: `${Math.random() * 4}s`,
    } as React.CSSProperties };
  });
}
function buildStars(count: number) {
  return Array.from({ length: count }).map((_, i) => {
    const size = 1 + Math.random() * 2.4;
    return { id: i, style: {
      left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, width: size, height: size,
      background: '#fff', animationDuration: `${1.5 + Math.random() * 3}s`, animationDelay: `${Math.random() * 3}s`,
    } as React.CSSProperties };
  });
}

function GradientLayer({ bg }: { bg: SceneBackground }) {
  const stops = (bg.gradientColors.length >= 2 ? bg.gradientColors : ['1a0b2e', '0a0a12']).map((c) => `#${c}`).join(', ');
  if (bg.gradientType === 'conic') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: `#${bg.color}` }}>
        <div style={{
          position: 'absolute', inset: '-200%',
          background: `conic-gradient(from ${bg.gradientAngle}deg, ${stops})`,
          animation: bg.gradientAnimated ? `sc-raysSpin ${Math.max(2, bg.gradientSpeed || 8)}s linear infinite` : undefined,
        }} />
      </div>
    );
  }
  const background = bg.gradientType === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${bg.gradientAngle}deg, ${stops})`;
  return (
    <div style={{
      position: 'absolute', inset: 0, background, backgroundSize: bg.gradientAnimated ? '200% 200%' : '100% 100%',
      animation: bg.gradientAnimated ? `sc-gradShift ${Math.max(2, bg.gradientSpeed || 8)}s ease infinite` : undefined,
    }} />
  );
}

function GeometryLayer({ bg }: { bg: SceneBackground }) {
  const layers = Math.max(1, Math.min(4, (bg.geoLayers as number) || 1));
  const outerSize = Math.max(5, (bg.geoSize as number) ?? 100);
  const geoAnim = (bg.geoAnim as string) ?? 'spin';
  const geoKind = (bg.geoKind as ShapeKind) ?? 'hexagon';
  const geoStrokeWidth = (bg.geoStrokeWidth as number) ?? 1.2;
  const geoSpeed = (bg.geoSpeed as number) ?? 14;
  return (
    <div style={{ position: 'absolute', inset: 0, background: bg.geoTransparentBg ? 'transparent' : `#${bg.color}` }}>
      <div className="sc-geo-layer" style={{ transform: `scale(${outerSize / 100})` }}>
        {Array.from({ length: layers }).map((_, i) => {
          const scale = 1 - i * 0.24;
          const anim = geoAnim === 'none' ? 'none' : (i % 2 === 0 ? geoAnim : (geoAnim === 'spin' ? 'spinReverse' : geoAnim === 'spinReverse' ? 'spin' : geoAnim));
          const speed = Math.max(2, geoSpeed * (1 + i * 0.35));
          return (
            <div key={i} className="sc-geo-layer" style={{ transform: `scale(${scale})`, opacity: 0.9 - i * 0.15 }}>
              <ShapeSvg kind={geoKind} strokeColor={bg.accentColor} strokeColor2={bg.accentColor} strokeWidth={geoStrokeWidth}
                fill={null} fillOpacity={0} glow={false} anim={anim} speed={speed} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SceneBackgroundView({ bg, onEnded }: { bg: SceneBackground; onEnded?: () => void }) {
  ensureSceneCss();
  const base: React.CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden' };
  const particles = useMemo(() => buildParticles(26, bg.accentColor), [bg.type, bg.accentColor]);
  const confetti  = useMemo(() => buildConfetti(34, bg.accentColor), [bg.type, bg.accentColor]);
  const stars     = useMemo(() => buildStars(70), [bg.type]);

  let layer: React.ReactNode = null;
  switch (bg.type) {
    case 'transparent':
      layer = null;
      break;
    case 'solid':
      layer = <div style={{ ...base, background: `#${bg.color}` }} />;
      break;
    case 'gradient':
      layer = <GradientLayer bg={bg} />;
      break;
    case 'media':
      layer = (
        <div style={{ ...base, background: `#${bg.color}` }}>
          {bg.mediaUrl && <SceneMedia src={bg.mediaUrl} fit={bg.mediaFit} loop volume={bg.mediaVolume} trimStart={bg.mediaTrimStart} trimEnd={bg.mediaTrimEnd} onEnded={onEnded} />}
        </div>
      );
      break;
    case 'particles':
      layer = <div style={{ ...base, background: `#${bg.color}` }}>{particles.map((p) => <span key={p.id} className="sc-particle" style={p.style} />)}</div>;
      break;
    case 'confetti':
      layer = <div style={{ ...base, background: `#${bg.color}` }}>{confetti.map((p) => <span key={p.id} className="sc-confetti" style={p.style} />)}</div>;
      break;
    case 'rays':
      layer = (
        <div style={{ ...base, background: `#${bg.color}` }}>
          <div className="sc-rays" style={{ background: `conic-gradient(from 0deg, transparent, ${hexToRgba(bg.accentColor, 0.35)}, transparent, ${hexToRgba(bg.accentColor, 0.35)}, transparent)` }} />
        </div>
      );
      break;
    case 'aurora':
      layer = (
        <div style={{ ...base, background: `#${bg.color}` }}>
          <div className="sc-aurora" style={{ left: '-10%', top: '-10%', background: `radial-gradient(circle, ${hexToRgba(bg.accentColor, 0.5)}, transparent 70%)`, animationDuration: '14s' }} />
          <div className="sc-aurora" style={{ right: '-10%', top: '10%', background: `radial-gradient(circle, ${hexToRgba(bg.accentColor, 0.32)}, transparent 70%)`, animationDuration: '18s', animationDelay: '2s' }} />
          <div className="sc-aurora" style={{ left: '20%', bottom: '-15%', background: `radial-gradient(circle, ${hexToRgba(bg.accentColor, 0.4)}, transparent 70%)`, animationDuration: '22s', animationDelay: '4s' }} />
        </div>
      );
      break;
    case 'geometry':
      layer = <GeometryLayer bg={bg} />;
      break;
    case 'starfield':
      layer = <div style={{ ...base, background: `#${bg.color}` }}>{stars.map((s) => <span key={s.id} className="sc-star" style={s.style} />)}</div>;
      break;
    case 'grid':
      layer = (
        <div style={{ ...base, background: `#${bg.color}` }}>
          <div className="sc-grid" style={{
            backgroundImage: `repeating-linear-gradient(0deg, ${hexToRgba(bg.accentColor, 0.4)} 0 1px, transparent 1px 48px), repeating-linear-gradient(90deg, ${hexToRgba(bg.accentColor, 0.4)} 0 1px, transparent 1px 48px)`,
          }} />
        </div>
      );
      break;
    case 'radar':
      layer = (
        <div style={{ ...base, background: `#${bg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {[0.9, 0.62, 0.34].map((r, i) => (
            <div key={i} style={{ position: 'absolute', width: `${r * 100}%`, height: `${r * 100}%`, borderRadius: '50%', border: `1px solid ${hexToRgba(bg.accentColor, 0.28)}` }} />
          ))}
          <div className="sc-radar-sweep">
            <div style={{ position: 'absolute', inset: 0, background: `conic-gradient(from 0deg, ${hexToRgba(bg.accentColor, 0.5)} 0deg, transparent 45deg, transparent 360deg)` }} />
          </div>
        </div>
      );
      break;
  }

  const opacity = bg.opacity ?? 1;
  // Real bug (found on the website, 2026-09-09): this dim overlay must never
  // apply once the background is genuinely transparent — a scene that had a
  // real dim set while on Gradient/Solid, then switched to Transparent, must
  // not keep tinting the output with no visible control to clear it.
  const dimActive = bg.type !== 'transparent' && bg.dim > 0;
  return (
    <>
      {opacity < 1 ? <div style={{ ...base, opacity }}>{layer}</div> : layer}
      {dimActive && <div style={{ ...base, background: `rgba(0,0,0,${bg.dim})` }} />}
    </>
  );
}

// ─── Accents (text) ─────────────────────────────────────────────────────────
function AccentedContent({ accents, children }: { accents: TextAccentInstance[]; children: React.ReactNode }) {
  const wrapping = accents.filter((a) => a.type !== 'letterWave');
  return <>{wrapping.reduceRight((node, accent) => <AccentLayer key={accent.id} accent={accent}>{node}</AccentLayer>, children)}</>;
}

function AccentLayer({ accent, children }: { accent: TextAccentInstance; children: React.ReactNode }) {
  const className = accent.type === 'glow' && accent.rainbowColor ? 'sc-text-accent-glowRainbow' : `sc-text-accent-${accent.type}`;
  const vars: Record<string, string> = { animationDuration: `${Math.max(0.15, accent.speed || 1)}s` };
  if (accent.type === 'glow' && !accent.rainbowColor) {
    const max = Math.max(1, accent.intensity ?? 16);
    vars['--sc-glow-color'] = accent.color ? `#${accent.color}` : 'currentColor';
    vars['--sc-glow-min'] = `${Math.max(1, max * 0.25)}px`;
    vars['--sc-glow-max'] = `${max}px`;
  } else if (accent.type === 'neonFlicker') {
    const max = Math.max(1, accent.intensity ?? 14);
    vars['--sc-neon-color'] = accent.color ? `#${accent.color}` : 'currentColor';
    vars['--sc-neon-max'] = `${max}px`;
  } else if (accent.type === 'heartbeat') {
    vars['--sc-heart-scale'] = `${1 + Math.max(0, Math.min(100, accent.intensity ?? 40)) / 250}`;
  } else if (accent.type === 'chrome') {
    const c1 = `#${accent.color || 'ffd700'}`, c2 = `#${accent.color2 || 'ffffff'}`;
    vars.backgroundImage = `linear-gradient(100deg, ${c1} 20%, ${c2} 40%, ${c1} 60%)`;
  }
  return <div className={className} style={vars as React.CSSProperties}>{children}</div>;
}

function buildLetterWaveHtml(html: string, staggerMs: number): string {
  const raw = tokenizeHtmlForReveal(html);
  const merged: RevealToken[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t.countsAsChar && t.text === '&') {
      let j = i, buf = '&';
      while (j + 1 < raw.length && raw[j + 1].countsAsChar && buf.length < 12 && !buf.endsWith(';')) { j++; buf += raw[j].text; }
      merged.push({ text: buf, countsAsChar: true });
      i = j;
    } else {
      merged.push(t);
    }
  }
  let out = '', idx = 0;
  for (const t of merged) {
    if (!t.countsAsChar) { out += t.text; continue; }
    const ch = t.text === ' ' ? '&nbsp;' : t.text;
    out += `<span class="sc-letter-wave" style="animation-delay:${idx * staggerMs}ms">${ch}</span>`;
    idx++;
  }
  return out;
}

// ─── Text ───────────────────────────────────────────────────────────────────
// editMode (editor preview only) — skips the typewriter TIMER so the static
// property-editing preview just shows the full resolved text immediately
// instead of continuously re-typing on every render; the continuous accent
// animation is NOT gated by editMode, it's a genuine ongoing effect either way.
export function TextInner({ el, html, editMode }: { el: TextElement; html: string; editMode?: boolean }) {
  const accents = el.accents || [];
  const letterWaveAccent = accents.find((a) => a.type === 'letterWave');
  const baseHtml = useMemo(
    () => (letterWaveAccent ? buildLetterWaveHtml(html, letterWaveAccent.stagger ?? 40) : html),
    [html, letterWaveAccent],
  );
  const tokens = useMemo(() => tokenizeHtmlForReveal(baseHtml), [baseHtml]);
  const total  = useMemo(() => tokens.reduce((n, t) => n + (t.countsAsChar ? 1 : 0), 0), [tokens]);
  const [count, setCount] = useState(el.reveal === 'typewriter' && !editMode ? 0 : total);

  useEffect(() => {
    if (editMode || el.reveal !== 'typewriter') { setCount(total); return; }
    setCount(0);
    const msPerChar = 1000 / Math.max(1, el.revealCharsPerSec || 28);
    const iv = setInterval(() => {
      setCount((c) => (c + 1 >= total ? (clearInterval(iv), total) : c + 1));
    }, msPerChar);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseHtml, el.reveal, el.revealCharsPerSec, editMode]);

  const typing = !editMode && el.reveal === 'typewriter' && count < total;
  const cursorHtml = (typing && el.cursor) ? `<span class="sc-cursor" style="border-color:#${el.color}"></span>` : '';
  const shown = (!editMode && el.reveal === 'typewriter' ? revealHtml(tokens, count) : baseHtml) + cursorHtml;
  const justify = el.textAlign === 'left' ? 'flex-start' : el.textAlign === 'right' ? 'flex-end' : 'center';

  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    if (!el.autoFit) { setFitScale(1); return; }
    const container = containerRef.current, measure = measureRef.current;
    if (!container || !measure) return;
    const recalc = () => {
      const availH = container.clientHeight, naturalH = measure.scrollHeight;
      if (!availH || !naturalH) return;
      setFitScale(Math.min(1, availH / naturalH));
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    return () => ro.disconnect();
  }, [el.autoFit, baseHtml, el.fontFamily, el.fontSize, el.bold, el.italic, el.letterSpacing, el.padding]);

  const textStyle = {
    fontFamily: `"${el.fontFamily}", sans-serif`, fontSize: el.fontSize, color: `#${el.color}`,
    fontWeight: el.bold ? 900 : 500, fontStyle: el.italic ? 'italic' : 'normal',
    letterSpacing: el.letterSpacing, textAlign: el.textAlign,
    padding: el.padding, borderRadius: el.borderRadius,
    background: el.bgEnabled ? hexToRgba(el.bgColor, el.bgOpacity) : 'transparent',
    textShadow: el.glowColor ? `0 0 ${el.glowAmount || 12}px #${el.glowColor}, 0 2px 6px rgba(0,0,0,.7)` : '0 2px 8px rgba(0,0,0,.8)',
    maxWidth: '100%', wordBreak: 'break-word' as const, lineHeight: 1.25,
    whiteSpace: 'pre-wrap' as const,
  };

  const waveVars: Record<string, string> = letterWaveAccent ? {
    '--sc-wave-amp': `${letterWaveAccent.intensity ?? 10}px`,
    '--sc-wave-speed': `${Math.max(0.15, letterWaveAccent.speed || 0.7)}s`,
  } : {};

  const content = (
    <div
      style={{ ...textStyle, ...waveVars, transform: fitScale < 1 ? `scale(${fitScale})` : undefined } as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: shown }}
    />
  );

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: justify, position: 'relative', overflow: el.autoFit ? 'hidden' : 'visible' }}>
      {el.autoFit && (
        <div ref={measureRef} aria-hidden style={{ ...textStyle, position: 'absolute', top: 0, left: 0, width: '100%', visibility: 'hidden', pointerEvents: 'none' } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: baseHtml }} />
      )}
      <AccentedContent accents={accents}>{content}</AccentedContent>
    </div>
  );
}

// Rotation lives on the OUTER positioning div as a plain static transform,
// never on the same div as the entrance class — a CSS animation targeting
// `transform` overrides whatever static value was set on it for the whole
// run, so a rotated element with a reveal animation would snap back to
// unrotated the instant the entrance finished if these shared one div.
export function TextElementView({ el, payload, exiting, editMode }: { el: TextElement; payload: SceneFirePayload; exiting: boolean; editMode?: boolean }) {
  const html = useMemo(
    () => buildSceneText(el.template, payload, el.variableColor, el.variableCase, el.variableColorMode === 'rainbow', el.variableRainbowSpeed),
    [el.template, payload, el.variableColor, el.variableCase, el.variableColorMode, el.variableRainbowSpeed],
  );
  const entranceClass = exiting ? '' : (el.reveal !== 'none' && el.reveal !== 'typewriter') ? `sc-reveal-${el.reveal}` : '';
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      opacity: el.opacity / 100, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <div className={entranceClass} style={{ width: '100%', height: '100%', animationDelay: `${el.delay || 0}s` }}>
        <TextInner el={el} html={html} editMode={editMode} />
      </div>
    </div>
  );
}

// ─── Media ──────────────────────────────────────────────────────────────────
export function MediaInner({ el, onEnded }: { el: MediaElement; onEnded?: () => void }) {
  const cfg: BorderEffectCfg | undefined = (el.border && el.border.style !== 'none') ? {
    style: el.border.style, color1: `#${el.border.color1}`, color2: `#${el.border.color2}`,
    width: el.border.width, speed: el.border.speed, fadeIn: false,
  } : undefined;
  const anim = el.anim ?? 'none';
  const animClass = anim !== 'none' ? `sc-media-anim-${anim}` : '';
  return (
    <div className={animClass} style={{
      position: 'relative', width: '100%', height: '100%', borderRadius: el.borderRadius, overflow: 'hidden',
      boxShadow: el.glow ? `0 0 ${el.glowAmount}px #${el.glowColor}, 0 0 ${el.glowAmount * 2}px #${el.glowColor}55` : undefined,
      animationDuration: anim !== 'none' ? `${Math.max(0.15, el.animSpeed || 3)}s` : undefined,
    }}>
      {el.url && <SceneMedia src={el.url} fit={el.fit} loop={el.loop} volume={el.volume} trimStart={el.trimStart} trimEnd={el.trimEnd} onEnded={onEnded} />}
      {cfg && <BorderEffectRing cfg={cfg} radius={el.borderRadius} />}
    </div>
  );
}

export function MediaElementView({ el, payload, exiting, onEnded }: { el: MediaElement; payload: SceneFirePayload; exiting: boolean; onEnded?: () => void }) {
  const url = resolveSceneMediaUrl(el.url, payload);
  const entranceClass = exiting ? '' : (el.entrance !== 'none' ? `sc-reveal-media-${el.entrance}` : '');
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      opacity: el.opacity / 100, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <div className={entranceClass} style={{ width: '100%', height: '100%', animationDelay: `${el.delay || 0}s` }}>
        <MediaInner el={{ ...el, url }} onEnded={onEnded} />
      </div>
    </div>
  );
}

// ─── Light ──────────────────────────────────────────────────────────────────
// Ellipse (not circle) gradient, no border-radius clip — the real fix found
// on the website: a `circle` gradient is always calibrated to the box's
// DIAGONAL, so a non-square box clipped to an ellipse via border-radius:50%
// disagreed with the gradient's own percentage stops on the short axis,
// producing a harder edge there than the long axis instead of a uniform
// feather. `ellipse` is CSS's real mechanism for a per-axis-shaped gradient.
export function LightInner({ el }: { el: LightElement }) {
  const animClass = el.anim !== 'static' ? `sc-light-${el.anim}` : '';
  const a = Math.max(0, Math.min(100, el.intensity)) / 100;
  const feather = Math.max(5, Math.min(100, el.feather ?? 72));
  const mid = feather * 0.486;
  return (
    <div className={animClass} style={{
      width: '100%', height: '100%', opacity: el.opacity / 100,
      animationDuration: `${Math.max(0.3, el.speed || 3)}s`, filter: 'blur(3px)', pointerEvents: 'none',
    }}>
      <div style={{ width: '100%', height: '100%', background: `radial-gradient(ellipse, ${hexToRgba(el.color, a)} 0%, ${hexToRgba(el.color, a * 0.45)} ${mid}%, transparent ${feather}%)` }} />
    </div>
  );
}

export function LightElementView({ el }: { el: LightElement }) {
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      animationDelay: `${el.delay || 0}s`, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <LightInner el={el} />
    </div>
  );
}

// ─── Shape (real sacred geometry) ───────────────────────────────────────────
function renderShapePrimitive(p: ReturnType<typeof buildShapePrimitives>[number], key: number, extraProps: React.SVGProps<any>) {
  if (p.kind === 'polygon') return <polygon key={key} points={p.points} pathLength={100} {...extraProps} />;
  if (p.kind === 'circle') return <circle key={key} cx={p.cx} cy={p.cy} r={p.r} pathLength={100} {...extraProps} />;
  return <line key={key} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...extraProps} />;
}

export function ShapeSvg({ kind, strokeColor, strokeColor2, strokeWidth, fill, fillOpacity, glow, anim, speed }: {
  kind: ShapeKind; strokeColor: string; strokeColor2: string; strokeWidth: number;
  fill: string | null; fillOpacity: number; glow: boolean; anim: string; speed: number;
}) {
  const prims = useMemo(() => buildShapePrimitives(kind), [kind]);
  const traceable = isTraceableShape(kind);
  const effectiveAnim = (anim === 'chase' || anim === 'rainbowChase') && !traceable ? 'spin' : anim;
  const spinClass = effectiveAnim === 'spin' ? 'sc-shape-spin' : effectiveAnim === 'spinReverse' ? 'sc-shape-spinReverse' : effectiveAnim === 'pulse' ? 'sc-shape-pulse' : '';
  const glowStyle: React.CSSProperties = glow ? { filter: `drop-shadow(0 0 6px #${strokeColor2 || strokeColor})` } : {};

  if (effectiveAnim === 'chase' || effectiveAnim === 'rainbowChase') {
    return (
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <g opacity={0.22} fill={fill ? hexToRgba(fill, fillOpacity) : 'none'} stroke={`#${strokeColor}`} strokeWidth={strokeWidth}>
          {prims.map((p, i) => renderShapePrimitive(p, i, {}))}
        </g>
        <g
          className={`sc-shape-trace ${effectiveAnim === 'rainbowChase' ? 'sc-shape-rainbowHue' : ''}`}
          fill="none" strokeLinecap="round"
          stroke={`#${effectiveAnim === 'rainbowChase' ? 'ffffff' : (strokeColor2 || strokeColor)}`}
          strokeWidth={strokeWidth * 1.6}
          style={{ ...glowStyle, animationDuration: `${Math.max(0.5, speed)}s` }}
        >
          {prims.map((p, i) => renderShapePrimitive(p, i, {}))}
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" className={spinClass} style={{ width: '100%', height: '100%', overflow: 'visible', animationDuration: `${Math.max(0.5, speed)}s`, ...glowStyle }}>
      <g fill={fill ? hexToRgba(fill, fillOpacity) : 'none'} stroke={`#${strokeColor}`} strokeWidth={strokeWidth}>
        {prims.map((p, i) => renderShapePrimitive(p, i, {}))}
      </g>
    </svg>
  );
}

export function ShapeElementView({ el }: { el: ShapeElement }) {
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      opacity: el.opacity / 100, pointerEvents: 'none', transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <ShapeSvg
        kind={el.shapeKind as ShapeKind} strokeColor={el.strokeColor} strokeColor2={el.strokeColor2} strokeWidth={el.strokeWidth}
        fill={el.fillEnabled ? el.fillColor : null} fillOpacity={el.fillOpacity} glow={el.glow} anim={el.anim} speed={el.speed}
      />
    </div>
  );
}

// ─── Fill (real angled/fighter/cut-corner geometry via barShapes.ts) ───────
export function FillInner({ el }: { el: FillElement }) {
  const isClippedShape = el.shape === 'angled' || el.shape === 'fighter';
  const cutActive = el.shape === 'rect' && hasCutCorners(el.cutCorners);
  const background = el.fillMode === 'gradient' ? `linear-gradient(${el.gradientAngle}deg, #${el.color}, #${el.color2})` : `#${el.color}`;

  // 1920x1080 reference canvas — the same resolution every element's own
  // x/y/w/h percent already assumes, giving a stable px height for the
  // exact-offset border math regardless of the real runtime canvas size.
  const heightPx = (el.h / 100) * 1080;
  const outerClipPath = isClippedShape ? getBarClipPath(el.shape as 'angled' | 'fighter', el.skew)
    : cutActive ? getCutCornersClipPath(el.cutCorners!, el.cutCornerSize ?? 12)
    : undefined;
  const innerClipPath = isClippedShape ? getBorderInsetClipPath(el.shape as 'angled' | 'fighter', el.skew, heightPx, el.borderWidth)
    : cutActive ? getCutCornersClipPath(el.cutCorners!, el.cutCornerSize ?? 12, el.borderWidth)
    : undefined;
  const hasClip = isClippedShape || cutActive;
  const radius = el.shape === 'rect' && !cutActive ? el.borderRadius : 0;

  if (!el.borderEnabled || el.borderWidth <= 0) {
    return <div style={{ width: '100%', height: '100%', background, opacity: el.fillOpacity, borderRadius: radius, clipPath: outerClipPath }} />;
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, background: `#${el.borderColor}`, borderRadius: radius, clipPath: outerClipPath }} />
      <div style={{
        position: 'absolute', inset: hasClip ? 0 : el.borderWidth,
        background, opacity: el.fillOpacity,
        borderRadius: hasClip ? radius : Math.max(radius - el.borderWidth, 0),
        clipPath: hasClip ? innerClipPath : undefined,
      }} />
    </div>
  );
}

export function FillElementView({ el, exiting }: { el: FillElement; exiting: boolean }) {
  const entranceClass = exiting ? '' : (el.entrance && el.entrance !== 'none' ? `sc-fill-entrance-${el.entrance}` : '');
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      opacity: el.opacity / 100, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <div className={entranceClass} style={{ width: '100%', height: '100%', animationDelay: `${el.delay || 0}s`, animationDuration: `${Math.max(0.15, el.entranceSpeed ?? 0.6)}s` }}>
        <FillInner el={el} />
      </div>
    </div>
  );
}

// ─── Counter ────────────────────────────────────────────────────────────────
function build3DTextShadow(depth: number, depthColor: string, glowColor: string, glowAmount: number): string {
  const layers: string[] = [];
  const d = Math.max(0, Math.min(20, depth));
  for (let i = 1; i <= d; i++) layers.push(`${i}px ${i}px 0 #${depthColor}`);
  if (glowColor) layers.push(`0 0 ${Math.max(0, glowAmount) || 14}px #${glowColor}`);
  layers.push(`${Math.max(2, d)}px ${Math.max(4, d + 2)}px 10px rgba(0,0,0,0.55)`);
  return layers.join(', ');
}

export function CounterInner({ el, target, editMode }: { el: CounterElement; target: number; editMode?: boolean }) {
  const shouldAnimate = el.countEnabled && !editMode;
  const counted = useCountUp(target, shouldAnimate ? Math.max(0.1, el.countDuration) * 1000 : 1);
  const shown = `${el.prefix}${Math.round(counted).toLocaleString()}${el.suffix}`;
  const fullShown = `${el.prefix}${Math.round(target).toLocaleString()}${el.suffix}`;

  const spanStyle = {
    fontFamily: `"${el.fontFamily}", sans-serif`, fontSize: el.fontSize, color: `#${el.color}`,
    fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap' as const,
    textShadow: build3DTextShadow(el.depth, el.depthColor, el.glowColor, el.glowAmount),
    background: el.bgEnabled ? hexToRgba(el.bgColor, el.bgOpacity) : 'transparent',
    padding: el.bgEnabled ? el.padding : 0,
    borderRadius: el.bgEnabled ? el.borderRadius : 0,
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    if (!el.autoFit) { setFitScale(1); return; }
    const container = containerRef.current, measure = measureRef.current;
    if (!container || !measure) return;
    const recalc = () => {
      const availW = container.clientWidth, availH = container.clientHeight;
      const naturalW = measure.scrollWidth, naturalH = measure.scrollHeight;
      if (!availW || !availH || !naturalW || !naturalH) return;
      setFitScale(Math.min(1, availW / naturalW, availH / naturalH));
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    return () => ro.disconnect();
  }, [el.autoFit, fullShown, el.fontFamily, el.fontSize, el.bgEnabled, el.padding]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: el.autoFit ? 'hidden' : 'visible' }}>
      {el.autoFit && <span ref={measureRef} aria-hidden style={{ ...spanStyle, position: 'absolute', visibility: 'hidden', pointerEvents: 'none' }}>{fullShown}</span>}
      <span style={{ ...spanStyle, transform: fitScale < 1 ? `scale(${fitScale})` : undefined }}>{shown}</span>
    </div>
  );
}

export function CounterElementView({ el, payload, editMode }: { el: CounterElement; payload: SceneFirePayload; editMode?: boolean }) {
  const target = resolveSceneCounterTarget(el, payload);
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      opacity: el.opacity / 100, animationDelay: `${el.delay || 0}s`, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <CounterInner el={el} target={target} editMode={editMode} />
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────
export function ContainerInner({ c }: { c: ContainerElement }) {
  const chaseCfg: BorderEffectCfg | undefined = (c.ambientAnim === 'chase' || c.ambientAnim === 'rainbowChase') ? {
    style: c.ambientAnim, color1: `#${c.ambientColor}`, color2: `#${c.borderColor}`,
    width: Math.max(1, c.borderWidth), speed: c.ambientSpeed, fadeIn: false,
  } : undefined;
  const boxClass = c.ambientAnim === 'pulse' ? 'sc-container-pulse' : c.ambientAnim === 'flicker' ? 'sc-container-flicker' : '';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className={boxClass} style={{
        position: 'absolute', inset: 0, borderRadius: c.borderRadius, overflow: 'hidden',
        background: hexToRgba(c.bgColor, c.bgOpacity), border: `${c.borderWidth}px solid #${c.borderColor}`,
        boxShadow: c.glow ? `0 0 ${c.glowAmount}px #${c.glowColor}, 0 0 ${c.glowAmount * 2}px ${hexToRgba(c.glowColor, 0.4)}` : undefined,
        animationDuration: `${Math.max(0.4, c.ambientSpeed)}s`,
      }}>
        {c.ambientAnim === 'shine' && (
          <div className="sc-container-shine" style={{ background: `linear-gradient(100deg, transparent 40%, ${hexToRgba(c.ambientColor, 0.55)} 50%, transparent 60%)`, animationDuration: `${Math.max(0.8, c.ambientSpeed)}s` }} />
        )}
        {c.ambientAnim === 'scanline' && (<>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg, ${hexToRgba(c.ambientColor, 0.08)} 0 1px, transparent 1px 3px)` }} />
          <div className="sc-container-scan" style={{ background: `linear-gradient(to bottom, transparent, ${hexToRgba(c.ambientColor, 0.55)}, transparent)`, animationDuration: `${Math.max(0.8, c.ambientSpeed)}s` }} />
        </>)}
      </div>
      {chaseCfg && <BorderEffectRing cfg={chaseCfg} radius={c.borderRadius} />}
    </div>
  );
}

export function ContainerElementView({ el }: { el: ContainerElement }) {
  return (
    <div style={{
      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
      opacity: el.opacity / 100, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    }}>
      <ContainerInner c={el} />
    </div>
  );
}

// ─── Dispatch ───────────────────────────────────────────────────────────────
export function SceneElementView({ el, payload, exiting, onMediaEnded, matchTarget, editMode }: {
  el: SceneElement; payload: SceneFirePayload; exiting: boolean; onMediaEnded?: () => void;
  matchTarget: { kind: 'background' } | { kind: 'element'; elementId: string } | null;
  editMode?: boolean;
}) {
  switch (el.type) {
    case 'text': return <TextElementView el={el} payload={payload} exiting={exiting} editMode={editMode} />;
    case 'media': return <MediaElementView el={el} payload={payload} exiting={exiting}
      onEnded={matchTarget?.kind === 'element' && matchTarget.elementId === el.id ? onMediaEnded : undefined} />;
    case 'light': return <LightElementView el={el} />;
    case 'shape': return <ShapeElementView el={el} />;
    case 'fill': return <FillElementView el={el} exiting={exiting} />;
    case 'counter': return <CounterElementView el={el} payload={payload} editMode={editMode} />;
    case 'container': return <ContainerElementView el={el} />;
    default: return null;
  }
}
