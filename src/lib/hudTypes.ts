// src/lib/hudTypes.ts — a port of the website's own Overlay Studio shapes
// (kickpulse-new's src/lib/hudTypes.ts). Kept as a shared types/constants
// module — components/BorderEffect.tsx, BackgroundFx.tsx, and
// SceneElements.tsx (the Scenes/Alert Studio engine) all still depend on
// the border-effect/background-fx types and CANVAS_W/CANVAS_H defined here.
//
// 2026-10-16 — Overlay Studio's OWN editor (OverlayStudioPage.tsx) no
// longer renders HudElement layouts natively at all; it now embeds the
// real website's /overlays/designer editor in a <webview> instead (see
// that page's own header for why — a real opacity-scale bug, found here,
// was the tipping point). The HudElement/HudLayout types and element
// factories below are kept only because this file is still a shared
// dependency for the three files named above, NOT because anything still
// constructs or renders a HudElement in this app.

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export type ElementType =
  | 'game-capture'
  | 'cam'
  | 'widget'
  | 'text'
  | 'shape'
  | 'image'
  | 'clock'
  | 'event-label';

export type AnimationType =
  | 'none' | 'glow-pulse' | 'glow-flicker' | 'float' | 'spin'
  | 'pulse-scale' | 'shake' | 'bounce' | 'wobble' | 'rainbow-cycle';

export interface HudElement {
  id: string;
  type: ElementType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  visible: boolean;
  // 0-1, a raw CSS opacity fraction — matches the real website's own
  // hud_layouts schema exactly (HudDesigner.tsx's own slider is `min={0}
  // max={1} step={0.01}`). NOT 0-100 like `scale`/BackgroundFxCfg.opacity —
  // confirmed 2026-10-16 by reading a real saved layout (every element had
  // opacity:1) after this field being wrongly treated as 0-100 here (divided
  // by 100 at render time) made every website-authored layout render at ~1%
  // opacity in this app's own preview, which is exactly what "Overlay Studio
  // isn't showing anything" turned out to be.
  opacity: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  bgColor: string;
  animation: AnimationType;
  animSpeed?: number;
  animIntensity?: number;
  animDistance?: number;
  animColor?: string;
  scale?: number;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  textShadow?: boolean;
  // widget
  widgetUrl?: string;
  // image
  imageUrl?: string;
  // clock
  clockFormat?: '12h' | '24h';
  clockShowSeconds?: boolean;
  clockColor?: string;
  clockSize?: number;
  clockFont?: string;
  // event-label — carried for round-tripping only, never rendered here (see
  // file header)
  elCategory?: string;
  elPersistence?: 'stream' | 'alltime';
  elHideUntilEvent?: boolean;
  elEmptyText?: string;
  // cam/game-capture — carried for round-tripping only, never rendered here
  camShape?: 'rect' | 'circle';
  shapeType?: 'rect' | 'circle';
  punchThrough?: boolean;
  cutout?: boolean;
  cropL?: number;
  cropR?: number;
  cropT?: number;
  cropB?: number;
  borderEffect?: BorderEffectCfg;
}

export type BorderEffectStyle = 'none' | 'glow' | 'chase' | 'rainbowChase';

export interface BorderEffectCfg {
  style: BorderEffectStyle;
  color1: string;
  color2: string;
  width: number;
  speed: number;
  fadeIn: boolean;
  position?: 'inside' | 'outside';
}

export const DEFAULT_BORDER_EFFECT: BorderEffectCfg = {
  style: 'none',
  color1: '#00ff9d',
  color2: '#00ffff',
  width: 6,
  speed: 3,
  fadeIn: true,
};

export type BackgroundFxType = 'none' | 'geometric-rings' | 'particles' | 'pulsing-rings' | 'scanline';

export interface BackgroundFxCfg {
  type: BackgroundFxType;
  color1: string;
  color2: string;
  speed: number;
  opacity: number;
  density: number;
}

export const DEFAULT_BACKGROUND_FX: BackgroundFxCfg = {
  type: 'none',
  color1: '#00ff9d',
  color2: '#9146ff',
  speed: 30,
  opacity: 15,
  density: 3,
};

export type BgMode = 'transparent' | 'solid' | 'gradient' | 'image';

export interface CanvasBgCfg {
  mode: BgMode;
  color1: string;
  color2: string;
  gradDir: string;
  imageUrl: string;
  borderEffect?: BorderEffectCfg;
  backgroundFx?: BackgroundFxCfg;
}

export const DEFAULT_BG: CanvasBgCfg = {
  mode: 'transparent',
  color1: '#000000',
  color2: '#1a1a2e',
  gradDir: '135deg',
  imageUrl: '',
  borderEffect: { ...DEFAULT_BORDER_EFFECT },
  backgroundFx: { ...DEFAULT_BACKGROUND_FX },
};

export function bgCfgToCSS(cfg: CanvasBgCfg): string {
  switch (cfg.mode) {
    case 'solid':
      return cfg.color1;
    case 'gradient':
      return cfg.gradDir === 'radial'
        ? `radial-gradient(ellipse, ${cfg.color1}, ${cfg.color2})`
        : `linear-gradient(${cfg.gradDir}, ${cfg.color1}, ${cfg.color2})`;
    case 'image':
      return cfg.imageUrl ? `url(${cfg.imageUrl}) center/cover no-repeat, ${cfg.color1}` : cfg.color1;
    default:
      return 'transparent';
  }
}

export function parseBgCfg(raw: string | null | undefined): CanvasBgCfg {
  if (!raw) return { ...DEFAULT_BG };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.mode === 'string') return { ...DEFAULT_BG, ...parsed };
  } catch {
    // fall through to the legacy-raw-string handling below
  }
  if (raw === 'transparent' || raw === '#000000' || raw === '') return { ...DEFAULT_BG };
  if (raw.startsWith('#') || raw.startsWith('rgb')) return { ...DEFAULT_BG, mode: 'solid', color1: raw };
  if (raw.startsWith('linear-gradient')) return { ...DEFAULT_BG, mode: 'gradient' };
  return { ...DEFAULT_BG };
}

export interface HudLayout {
  id: string;
  user_id: string;
  name: string;
  elements: HudElement[];
  canvas_bg: string;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

export function newTextElement(): HudElement {
  return {
    id: crypto.randomUUID(), type: 'text', label: 'Text', x: 400, y: 460, w: 1120, h: 160,
    zIndex: 1, visible: true, opacity: 1, borderRadius: 0, borderWidth: 0, borderColor: '#00ff9d', bgColor: 'transparent',
    animation: 'none', text: 'New Text', fontSize: 64, fontFamily: 'Inter', fontWeight: '700',
    textColor: '#ffffff', textAlign: 'center', textShadow: true,
  };
}

export function newImageElement(): HudElement {
  return {
    id: crypto.randomUUID(), type: 'image', label: 'Image', x: 660, y: 340, w: 600, h: 400,
    zIndex: 1, visible: true, opacity: 1, borderRadius: 0, borderWidth: 0, borderColor: '#00ff9d', bgColor: 'transparent',
    animation: 'none', imageUrl: '',
  };
}

export function newShapeElement(): HudElement {
  return {
    id: crypto.randomUUID(), type: 'shape', label: 'Shape', x: 760, y: 440, w: 400, h: 200,
    zIndex: 1, visible: true, opacity: 1, borderRadius: 12, borderWidth: 0, borderColor: '#00ff9d', bgColor: '#7c3aed',
    animation: 'none', shapeType: 'rect',
  };
}

export function newClockElement(): HudElement {
  return {
    id: crypto.randomUUID(), type: 'clock', label: 'Clock', x: 1620, y: 40, w: 260, h: 90,
    zIndex: 1, visible: true, opacity: 1, borderRadius: 10, borderWidth: 0, borderColor: '#00ff9d', bgColor: 'transparent',
    animation: 'none', clockFormat: '12h', clockShowSeconds: false, clockColor: '#ffffff', clockSize: 48, clockFont: 'Inter',
  };
}

export function newWidgetElement(): HudElement {
  return {
    id: crypto.randomUUID(), type: 'widget', label: 'Widget', x: 60, y: 60, w: 500, h: 300,
    zIndex: 1, visible: true, opacity: 1, borderRadius: 0, borderWidth: 0, borderColor: '#00ff9d', bgColor: 'transparent',
    animation: 'none', widgetUrl: '',
  };
}
