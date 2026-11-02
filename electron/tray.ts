// electron/tray.ts — the system tray icon that keeps the app running in the
// background after the main window is closed (2026-11-01, direct request).
// This module only owns the icon/menu; the actual "hide instead of close"
// decision lives in main.ts's mainWindow 'close' handler (gated by
// store.ts's minimizeToTrayOnClose), since that's where the window itself
// is. A real quit only ever happens via the "Quit" item below, or whatever
// else called app.quit() directly (electron-updater's quitAndInstall, OS
// shutdown/logoff) — main.ts's own 'before-quit' handler is what tells the
// 'close' handler to let that one go through instead of hiding again.

import { Tray, Menu, nativeImage, type BrowserWindow } from 'electron';
import path from 'node:path';

let tray: Tray | null = null;

export function createTray(getMainWindow: () => BrowserWindow | null, onQuit: () => void): Tray {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  // Windows tray icons render best around 16x16 — the full-res app icon
  // scaled down here rather than shipping a second dedicated asset.
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  const showWindow = () => {
    const win = getMainWindow();
    if (!win) return;
    win.show();
    win.focus();
  };

  tray = new Tray(icon);
  tray.setToolTip('KickPulse Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open KickPulse Desktop', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]));
  // Left-click opens the app (right-click already gets the context menu
  // above for free); double-click included too since some users reach for
  // that instead on Windows.
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  return tray;
}

/** The one-time "it's still running" explainer — shown the first time ever
 *  the window gets hidden to tray rather than closed for real, so closing
 *  the window doesn't look like nothing happened. See store.ts's
 *  trayHintShown for the "only ever once" bookkeeping. */
export function showTrayHint(): void {
  tray?.displayBalloon({
    title: 'KickPulse Desktop is still running',
    content: 'The overlay and your connections (OBS, lights, voice) stay active in the background. Click this icon to reopen the window, or choose Quit from its menu to fully exit.',
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
