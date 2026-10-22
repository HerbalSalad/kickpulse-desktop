// electron/overlay-window.ts — the real trick. One transparent,
// click-through, always-on-top, non-focusable window covering ONE chosen
// display, created once at startup and left open (shown but visually
// empty) for the whole session — we only ever change its rendered CONTENT
// via IPC, never toggle show()/hide(), since repeatedly re-showing a window
// risks it losing its place in the z-order above a fullscreen-exclusive
// game each time (the OS has to re-insert it, which can race the game's own
// buffer swap chain). Keeping one window alive and just swapping what it
// draws avoids that entirely.
//
// Honest limitation, not yet solved: this only reliably draws over
// BORDERLESS/windowed games (and anything running in a normal desktop
// compositor). A true FULLSCREEN-EXCLUSIVE game bypasses the compositor
// and this window may simply not appear above it at all — that needs
// DirectX/OpenGL/Vulkan render-hooking (what MSI Afterburner/RTSS do),
// which is fragile per-engine and risks anti-cheat flags. Not attempted
// here; this is the "easy half" on purpose, see the project's own README.
//
// Multi-monitor (2026-10-18): which display hosts this window is now a real,
// user-visible choice — see DisplayOption/listDisplays/moveOverlayToDisplay
// below and src/pages/OverlayDisplayPage.tsx — instead of always silently
// grabbing screen.getPrimaryDisplay(). Still only ever ONE window on ONE
// display at a time (not one window per display) — a reasonable scope limit
// for a single-PC single-stream setup, not attempted further here.

import { BrowserWindow, screen, type Display } from 'electron';
import path from 'node:path';
import type { JumpscarePayload, ScenePlayPayload } from './types';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let overlayWindow: BrowserWindow | null = null;
// Which real display id the overlay is currently positioned on — set by
// createOverlayWindow()/moveOverlayToDisplay() below, read back by
// getCurrentDisplay() for the Overlay settings page's own status readout.
// Not the same thing as the user's CONFIGURED choice (store.ts's
// overlayDisplayId): this is what's actually in effect right now, which
// can legitimately differ after a fallback (see resolveDisplay()).
let currentDisplayId: number | null = null;

// Config added 2026-10-18 — direct request: "add some config for the screen
// overlay portion, so people actually know they have it setup, and maybe
// can choose what screen it triggers on, in case we dont get the right
// one." Previously hardcoded to screen.getPrimaryDisplay() with no way to
// change it and no visible confirmation it was even running at all — a
// genuine problem on any multi-monitor setup where "primary" isn't
// necessarily the monitor OBS/the game is actually on.
export interface DisplayOption {
  id: number;
  label: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

function describeDisplay(d: Display, index: number, primaryId: number): DisplayOption {
  return {
    id: d.id,
    label: `Display ${index + 1} — ${d.bounds.width}×${d.bounds.height}${d.id === primaryId ? ' (Primary)' : ''}`,
    width: d.bounds.width,
    height: d.bounds.height,
    isPrimary: d.id === primaryId,
  };
}

export function listDisplays(): DisplayOption[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => describeDisplay(d, i, primaryId));
}

/** `preferredId` is the user's saved choice (store.ts's overlayDisplayId) —
 *  `null`/unset means "always follow whichever display Windows currently
 *  calls primary." A preferred id that no longer exists (monitor unplugged
 *  since it was chosen) silently falls back to primary rather than erroring
 *  — same "degrade, don't crash" shape as this file's own jumpscare/scene
 *  fallbacks. */
function resolveDisplay(preferredId: number | null): Display {
  if (preferredId != null) {
    const found = screen.getAllDisplays().find((d) => d.id === preferredId);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

export function getCurrentDisplay(): DisplayOption | null {
  if (currentDisplayId == null) return null;
  const all = screen.getAllDisplays();
  const idx = all.findIndex((d) => d.id === currentDisplayId);
  if (idx === -1) return null;
  return describeDisplay(all[idx], idx, screen.getPrimaryDisplay().id);
}

/** Moves the ALREADY-CREATED overlay window to a different display without
 *  recreating it — see this file's own top comment on why the window is
 *  created once and left open for the whole session rather than toggled;
 *  the same reasoning applies to repositioning it, `setBounds` only. Returns
 *  the display that actually ended up in effect (after any fallback), so
 *  the caller can show the real result, not just echo back what was asked
 *  for. */
export function moveOverlayToDisplay(preferredId: number | null): DisplayOption {
  const target = resolveDisplay(preferredId);
  currentDisplayId = target.id;
  overlayWindow?.setBounds(target.bounds);
  const all = screen.getAllDisplays();
  const idx = all.findIndex((d) => d.id === target.id);
  return describeDisplay(target, idx === -1 ? 0 : idx, screen.getPrimaryDisplay().id);
}

/** A monitor can be unplugged (or Windows' own "primary" reassigned) while
 *  the app is running — called once at startup from main.ts so a dead
 *  CONFIGURED display id self-heals back onto a real one instead of leaving
 *  the overlay window positioned over a display that no longer exists
 *  (which would make it simply never show up again until the app restarts). */
export function watchDisplayChanges(getPreferredId: () => number | null, onResolved: (d: DisplayOption) => void): void {
  const handler = () => {
    const all = screen.getAllDisplays();
    if (currentDisplayId != null && all.some((d) => d.id === currentDisplayId)) return; // still connected, nothing to do
    onResolved(moveOverlayToDisplay(getPreferredId()));
  };
  screen.on('display-removed', handler);
}

/** Flashes a big, unmissable banner on the real overlay window for a few
 *  seconds so someone with several monitors can actually SEE which physical
 *  screen it's on right now — "Highlight This Screen" on the Overlay
 *  settings page. Separate from playJumpscare/playScene below (its own IPC
 *  channel), since this is a settings-page confirmation tool, not a real
 *  stream event. */
export function flashHighlight(ms = 4000): void {
  if (!overlayWindow) return;
  overlayWindow.webContents.send('overlay-highlight', { ms });
}

export function createOverlayWindow(preferredDisplayId: number | null = null): BrowserWindow {
  const target = resolveDisplay(preferredDisplayId);
  currentDisplayId = target.id;

  const win = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false, // never steal keyboard/mouse focus from the game
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Dev-only: the overlay page is served from the Vite dev server
      // (http://localhost:...), and Chromium blocks an http(s)-origin page
      // from loading file:// resources ("Not allowed to load local
      // resource") — this is what local jumpscare media needs to do. In
      // the packaged production build this window loads via loadFile(),
      // i.e. a real file:// origin, which CAN reference sibling file://
      // resources without this restriction — so production never needs
      // webSecurity disabled at all, only this dev-mode loading path does.
      webSecurity: !isDev,
    },
  });

  // 'screen-saver' is the highest standard Electron always-on-top level —
  // the same trick most lightweight game overlays use to get above as many
  // other windows as possible on Windows without resorting to render hooks.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}overlay.html`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/overlay.html'));
  }

  win.once('ready-to-show', () => win.showInactive());

  // Forward the renderer's own console output to the main process terminal
  // — this app has no devtools window open by default, so without this any
  // client-side error (a bad preload bridge, a failed video load) is
  // completely invisible while debugging.
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[overlay console]', message);
  });

  overlayWindow = win;
  win.on('closed', () => {
    overlayWindow = null;
  });

  return win;
}

export function playJumpscare(payload: JumpscarePayload): void {
  if (!overlayWindow) {
    console.warn('[overlay] playJumpscare called but no overlay window exists');
    return;
  }
  overlayWindow.webContents.send('play-jumpscare', payload);
}

/** Pulse Scenes — a richer, positioned text/media/light/shape/fill/counter/
 *  container composition, as opposed to jumpscare's single full-bleed
 *  media+audio. Renders in the SAME always-on overlay window, as its own
 *  layer, so a scene and a jumpscare can in principle both be on screen at
 *  once without either needing a second transparent window. */
export function playScene(payload: ScenePlayPayload): void {
  if (!overlayWindow) {
    console.warn('[overlay] playScene called but no overlay window exists');
    return;
  }
  overlayWindow.webContents.send('play-scene', payload);
}

/** Exposed for a possible future "one overlay window per display" mode —
 *  not needed for the current single-window, pick-a-display model above. */
export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}
