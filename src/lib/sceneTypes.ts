// src/lib/sceneTypes.ts — a real, field-for-field port of the website's own
// Pulse Scenes/Alert Studio element shapes (kickpulse-new/src/hooks/
// useAlertStudio.ts + useScenes.ts — "Scenes" is one of the website's main
// rivals to Lumia Stream's own HUD Companion, so this app needs to actually
// RENDER a scene the same way the website does, not just react to a bare
// jumpscare trigger).
//
// These types describe the exact same JSON shape the website stores in
// scenes_configs.config.scenes[]/alert_studio_configs.config.scenes[] — a
// scene built there plays correctly here, field for field.
//
// 2026-10-15 rewrite — this file (and its own render engine,
// src/components/SceneElements.tsx) used to be a DELIBERATELY TRIMMED stand-
// in: shapes rendered as a plain box instead of real generated geometry,
// most background types degraded to a flat color, only one of several
// stacked text accents was honored, fill elements had no angled/fighter/
// cut-corner geometry, and typewriter/scroll/bounce reveal all just faded
// in. Direct, sharp feedback once a real saved scene was actually compared
// side-by-side with the website: "nothing looks the same as it is on the
// site... get this right." Every field and every render path below is now a
// real port, not an approximation — see SceneElements.tsx's own header for
// the render side.

import type { CutCorners } from './barShapes';

export type SceneElementType = 'text' | 'media' | 'light' | 'shape' | 'fill' | 'counter' | 'container';

export interface SceneElementBase {
  id: string;
  type: SceneElementType;
  x: number; y: number; w: number; h: number; // percent of the canvas
  opacity: number;    // 0-100
  visible: boolean;
  delay: number;      // seconds after the scene starts before this element's entrance begins
  rotation?: number;  // degrees
}

export type TextReveal =
  | 'none' | 'fade' | 'typewriter'
  | 'scroll-left' | 'scroll-right' | 'slide-up' | 'slide-down' | 'zoom' | 'bounce';

export type TextAccentType =
  | 'pulse' | 'shake' | 'wobble' | 'bounce' | 'glow' | 'rainbow'
  | 'glitch' | 'chrome' | 'neonFlicker' | 'heartbeat' | 'letterWave';

export interface TextAccentInstance {
  id: string;
  type: TextAccentType;
  speed: number;
  color?: string;
  color2?: string;
  intensity?: number;
  rainbowColor?: boolean;
  stagger?: number;
}

export interface TextElement extends SceneElementBase {
  type: 'text';
  template: string;
  fontFamily: string;
  fontSize: number;
  color: string;             // hex no #
  variableColor: string;     // hex no #
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right';
  padding: number;
  borderRadius: number;
  glowColor: string;
  glowAmount: number;
  reveal: TextReveal;
  revealCharsPerSec: number;
  cursor: boolean;
  accents: TextAccentInstance[];
  variableCase?: 'none' | 'upper' | 'lower' | 'capitalize';
  variableColorMode?: 'solid' | 'rainbow';
  variableRainbowSpeed?: number;
  autoFit?: boolean;
}

export type MediaEntrance =
  | 'none' | 'fade' | 'zoom' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'bounce' | 'flip';

export type MediaAnimMode = 'none' | 'spin' | 'spinReverse' | 'pulse' | 'shake' | 'wobble' | 'bounce' | 'heartbeat';

export interface MediaBorder {
  style: 'none' | 'glow' | 'chase' | 'rainbowChase';
  color1: string;
  color2: string;
  width: number;
  speed: number;
}

export interface MediaElement extends SceneElementBase {
  type: 'media';
  url: string;
  fit: 'contain' | 'cover';
  loop: boolean;
  entrance: MediaEntrance;
  border: MediaBorder;
  glow: boolean;
  glowColor: string;
  glowAmount: number;
  borderRadius: number;
  anim?: MediaAnimMode;
  animSpeed?: number;
  volume?: number;
  trimStart?: number;
  trimEnd?: number;
}

export type LightAnim = 'static' | 'pulse' | 'flicker' | 'drift' | 'rotateHue';

export interface LightElement extends SceneElementBase {
  type: 'light';
  color: string;
  intensity: number;
  anim: LightAnim;
  speed: number;
  feather?: number;
}

// Simplified for this app — see this file's own header. shapeKind/strokeWidth
// etc. are kept on the type (so a real website-saved scene round-trips
// without losing data) but SceneElements.tsx's ShapeElementView only ever
// draws a plain box using strokeColor/fillColor, not the real generated path.
export type ShapeKind = string;
export type ShapeAnimMode = 'none' | 'spin' | 'spinReverse' | 'pulse' | 'chase' | 'rainbowChase';

export interface ShapeElement extends SceneElementBase {
  type: 'shape';
  shapeKind: ShapeKind;
  strokeColor: string;
  strokeColor2: string;
  strokeWidth: number;
  fillEnabled: boolean;
  fillColor: string;
  fillOpacity: number;
  glow: boolean;
  anim: ShapeAnimMode;
  speed: number;
}

export type FillShape = 'rect' | 'angled' | 'fighter';
export type FillEntrance =
  | 'none' | 'fade' | 'zoom'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'grow-left' | 'grow-right' | 'grow-up' | 'grow-down';

export interface FillElement extends SceneElementBase {
  type: 'fill';
  fillMode: 'solid' | 'gradient';
  color: string;
  color2: string;
  gradientAngle: number;
  fillOpacity: number;
  shape: FillShape;        // 'rect' = plain rectangle (own corner radius / cut corners); angled/fighter reuse barShapes.ts's skew geometry
  skew: number;            // px — angled/fighter only
  borderRadius: number;    // px — 'rect' only
  cutCorners?: CutCorners; // 'rect' only — not combined with angled/fighter, see barShapes.ts's own scoping note
  cutCornerSize?: number;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
  entrance?: FillEntrance;
  entranceSpeed?: number;
}

export type CounterSource = 'amount' | 'months' | 'viewers' | 'fixed';

export interface CounterElement extends SceneElementBase {
  type: 'counter';
  source: CounterSource;
  fixedValue: number;
  prefix: string;
  suffix: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  depth: number;
  depthColor: string;
  glowColor: string;
  glowAmount: number;
  countEnabled: boolean;
  countDuration: number;
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;
  padding: number;
  borderRadius: number;
  autoFit?: boolean;
}

export type ContainerAmbientAnim = 'none' | 'pulse' | 'shine' | 'chase' | 'rainbowChase' | 'scanline' | 'flicker';

export interface ContainerElement extends SceneElementBase {
  type: 'container';
  bgColor: string; bgOpacity: number;
  borderColor: string; borderWidth: number; borderRadius: number;
  glow: boolean; glowColor: string; glowAmount: number;
  ambientAnim: ContainerAmbientAnim;
  ambientColor: string;
  ambientSpeed: number;
}

export type SceneElement = TextElement | MediaElement | LightElement | ShapeElement | FillElement | CounterElement | ContainerElement;

export type SceneBackgroundType =
  | 'transparent' | 'solid' | 'gradient' | 'media'
  | 'particles' | 'confetti' | 'rays' | 'aurora'
  | 'geometry' | 'starfield' | 'grid' | 'radar';

export type GradientType = 'linear' | 'radial' | 'conic';

export interface SceneBackground {
  type: SceneBackgroundType;
  color: string;
  gradientColors: string[];
  gradientType: GradientType;
  gradientAngle: number;
  gradientAnimated: boolean;
  gradientSpeed: number;
  mediaUrl: string;
  mediaFit: 'contain' | 'cover';
  mediaVolume?: number;
  mediaTrimStart?: number;
  mediaTrimEnd?: number;
  accentColor: string;
  dim: number;
  opacity?: number;
  // The 4 generated-effect background types (geometry/starfield/grid/radar)
  // keep their own fields on the type for round-tripping, but render as a
  // plain `color` fill here — see this file's own header.
  [key: string]: unknown;
}

export const DEFAULT_SCENE_BACKGROUND: SceneBackground = {
  type: 'transparent',
  color: '0a0a12',
  gradientColors: ['1a0b2e', '0a0a12'],
  gradientType: 'linear',
  gradientAngle: 135,
  gradientAnimated: true,
  gradientSpeed: 10,
  mediaUrl: '',
  mediaFit: 'cover',
  accentColor: '00ff9d',
  dim: 0,
};

export type SceneTransition = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom';

export interface PulseScene {
  id: string;
  name: string;
  duration: number;
  durationMode?: 'fixed' | 'matchMedia';
  soundUrl: string;
  soundVolume: number;
  sceneEnter: SceneTransition;
  sceneExit: SceneTransition;
  sceneEnterSec: number;
  sceneExitSec: number;
  background: SceneBackground;
  elements: SceneElement[];
}

export interface SceneFirePayload {
  username?: string;
  amount?: number | string;
  message?: string;
  viewers?: number | string;
  reward?: string;
  // months (2026-10-15) — Alert Studio's resub kinds (kickResub/twitchResub)
  // are the one real source of this; a Pulse Scene (fired via a generic
  // Pulse Engine trigger) never sets it, so resolveSceneCounterTarget's own
  // 'months' branch — previously hardcoded to 0 with a "no equivalent
  // concept" comment, since nothing in Pulse Scenes' own flat token
  // vocabulary ever carried one — now has something real to read once this
  // IS set, with zero behavior change for every existing Pulse Scene caller
  // that never sets it.
  months?: number | string;
  // extraTokens (2026-10-15) — lets a caller (Alert Studio's own richer
  // token vocabulary — {eventText}/{eventVerb}/{subType}/{amountText}, see
  // studioTokens.ts) participate in the SAME substitution/escaping/color-
  // wrapping pass sceneTokens.ts's resolveSceneTokens already does for
  // {username}/{amount}/etc, instead of a second, parallel text-substitution
  // pipeline that would have to reimplement that escaping by hand. Unset
  // for every real Pulse Scene firing (nothing sets it), so this is purely
  // additive.
  extraTokens?: Record<string, string>;
}

// ─── Alert Studio (2026-10-15) ─────────────────────────────────────────────
// A deliberately extends PulseScene, not a parallel reinvention — see
// studioTokens.ts's own file header for why Alert Studio scenes can reuse
// literally every SceneElementView/SceneBackgroundView render path already
// built for Pulse Scenes above, with only `kinds`/`minAmount` added on top
// (the real, additional thing Alert Studio needs: WHICH event kind(s) a
// scene plays for, and — for an amount-based kind — at what tier).
export interface AlertScene extends PulseScene {
  kinds: string[];     // StudioEventType values (see studioTokens.ts) — a kind belongs to at most one scene (or one PER TIER for an amount-based kind)
  minAmount?: number;  // amount-tier floor for AMOUNT_BASED_KINDS; unset/0 = the base tier
}

export interface AlertStudioConfig {
  id?: string;
  configName?: string;
  broadcasterId?: string;
  scenes: AlertScene[];
  platforms: { kick: boolean; twitch: boolean };
}

// ─── Element/scene factories (2026-10-15) — this app's own Scenes editor
// (src/pages/ScenesPage.tsx) needs to create brand-new elements/scenes, which
// the original port (built only for PLAYBACK, not editing) never needed.
// Default values are the same reasonable starting points the website's own
// useAlertStudio.ts/useScenes.ts factories use.
function uid(): string {
  return crypto.randomUUID();
}

export function newTextElement(partial?: Partial<TextElement>): TextElement {
  return {
    id: uid(), type: 'text', x: 20, y: 62, w: 60, h: 16, opacity: 100, visible: true, delay: 0, rotation: 0,
    template: '{username} {message}', fontFamily: 'Inter', fontSize: 44, color: 'ffffff', variableColor: '00ff9d',
    bgEnabled: false, bgColor: '000000', bgOpacity: 0.55, bold: true, italic: false, letterSpacing: 0,
    textAlign: 'center', padding: 12, borderRadius: 12, glowColor: '000000', glowAmount: 14,
    reveal: 'fade', revealCharsPerSec: 28, cursor: false, accents: [], variableCase: 'none',
    ...partial,
  };
}

export function newMediaElement(partial?: Partial<MediaElement>): MediaElement {
  return {
    id: uid(), type: 'media', x: 32, y: 12, w: 36, h: 42, opacity: 100, visible: true, delay: 0, rotation: 0,
    url: '', fit: 'contain', loop: true, entrance: 'zoom',
    border: { style: 'none', color1: '00ff9d', color2: '00ffff', width: 6, speed: 3 },
    glow: false, glowColor: '00ff9d', glowAmount: 30, borderRadius: 16,
    ...partial,
  };
}

export function newLightElement(partial?: Partial<LightElement>): LightElement {
  return {
    id: uid(), type: 'light', x: 40, y: 30, w: 20, h: 20, opacity: 80, visible: true, delay: 0, rotation: 0,
    color: '00ff9d', intensity: 70, anim: 'pulse', speed: 3, feather: 72,
    ...partial,
  };
}

export function newShapeElement(partial?: Partial<ShapeElement>): ShapeElement {
  return {
    id: uid(), type: 'shape', x: 25, y: 15, w: 50, h: 50, opacity: 70, visible: true, delay: 0, rotation: 0,
    shapeKind: 'hexagon', strokeColor: '00ff9d', strokeColor2: '00ffff', strokeWidth: 1.2,
    fillEnabled: false, fillColor: '00ff9d', fillOpacity: 0.08, glow: true, anim: 'spin', speed: 12,
    ...partial,
  };
}

export function newFillElement(partial?: Partial<FillElement>): FillElement {
  return {
    id: uid(), type: 'fill', x: 10, y: 80, w: 80, h: 10, opacity: 100, visible: true, delay: 0, rotation: 0,
    fillMode: 'solid', color: '00ff9d', color2: '9146ff', gradientAngle: 90, fillOpacity: 1,
    shape: 'rect', skew: 20, borderRadius: 8, borderEnabled: false, borderColor: 'ffffff', borderWidth: 2,
    entrance: 'none', entranceSpeed: 0.6,
    ...partial,
  };
}

export function newCounterElement(partial?: Partial<CounterElement>): CounterElement {
  return {
    id: uid(), type: 'counter', x: 25, y: 40, w: 50, h: 20, opacity: 100, visible: true, delay: 0.2, rotation: 0,
    source: 'amount', fixedValue: 100, prefix: '', suffix: '', fontFamily: 'Inter', fontSize: 72, color: 'ffffff',
    depth: 6, depthColor: '00ff9d', glowColor: '00ff9d', glowAmount: 20, countEnabled: true, countDuration: 1.4,
    bgEnabled: false, bgColor: '000000', bgOpacity: 0.55, padding: 16, borderRadius: 14,
    ...partial,
  };
}

export function newContainerElement(partial?: Partial<ContainerElement>): ContainerElement {
  return {
    id: uid(), type: 'container', x: 12, y: 55, w: 76, h: 32, opacity: 100, visible: true, delay: 0, rotation: 0,
    bgColor: '000000', bgOpacity: 0.5, borderColor: '00ff9d', borderWidth: 2, borderRadius: 16,
    glow: true, glowColor: '00ff9d', glowAmount: 20, ambientAnim: 'none', ambientColor: 'ffffff', ambientSpeed: 3,
    ...partial,
  };
}

export function newPulseScene(name: string): PulseScene {
  return {
    id: uid(), name, duration: 6, soundUrl: '', soundVolume: 80,
    sceneEnter: 'fade', sceneExit: 'fade', sceneEnterSec: 0.5, sceneExitSec: 0.45,
    background: { ...DEFAULT_SCENE_BACKGROUND },
    elements: [newTextElement()],
  };
}

export function newAlertScene(name: string, kinds: string[] = [], minAmount?: number): AlertScene {
  return { ...newPulseScene(name), kinds, minAmount };
}

const VIDEO_EXTENSIONS = ['webm', 'mp4', 'mov', 'ogv'];
export function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const path = String(url).split(/[?#]/)[0];
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && VIDEO_EXTENSIONS.includes(ext);
}

// hexToRgba (2026-10-15) — matches the website's lib/utils.ts signature
// exactly (bare hex, no leading #, -> a real `rgba(r,g,b,a)` CSS string) so
// the full render-engine port can use it as a drop-in, same as every real
// render function it was copied from.
export function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || '000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Mirrors useScenes.ts's resolveMatchMediaTarget exactly — same priority
// (the background's own video wins over the first video-type element).
export type MatchMediaTarget = { kind: 'background' } | { kind: 'element'; elementId: string };
export function resolveMatchMediaTarget(scene: PulseScene): MatchMediaTarget | null {
  if (scene.background.type === 'media' && isVideoUrl(scene.background.mediaUrl)) return { kind: 'background' };
  const el = scene.elements.find((e) => e.type === 'media' && isVideoUrl((e as MediaElement).url)) as MediaElement | undefined;
  if (el) return { kind: 'element', elementId: el.id };
  return null;
}
