// electron/updater.ts — auto-update via electron-updater, pulling releases
// from the kickpulse-desktop GitHub repo (see package.json's build.publish).
//
// The repo is public specifically so update checks need no embedded
// credential at all — a private repo's release assets require an
// authenticated request, which would mean baking a GitHub token into every
// installed copy of this app (readable by anyone who extracts it). Publishing
// a new version is still a one-time, developer-side action: run
// `GH_TOKEN=... npm run release` after bumping package.json's version, which
// electron-builder uses to create the GitHub Release and upload the
// installer + the latest.yml/.blockmap files this module reads.
//
// Only the NSIS-installed copy can auto-update — the portable .exe target
// has no installed app for electron-updater to silently replace, so someone
// running that build has to grab new versions manually. Not worth blocking
// on; NSIS is the primary download either way.
//
// Download happens automatically in the background the moment an update is
// found (autoDownload) — that's the "best way" for most users, since it
// costs nothing to have ready. Installing never happens without the user
// clicking the in-app "Restart to update" control (see UpdateBadge.tsx) —
// this app runs persistently during a live stream, so silently relaunching
// itself on its own schedule would be actively disruptive.
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';
import type { UpdaterStatus } from './types';

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const INITIAL_CHECK_DELAY_MS = 10_000; // let startup (login/connect) settle first

let currentStatus: UpdaterStatus = { phase: 'idle' };
let getWindow: () => BrowserWindow | null = () => null;

function setStatus(status: UpdaterStatus) {
  currentStatus = status;
  getWindow()?.webContents.send('updater:status-update', currentStatus);
}

export function getUpdaterStatus(): UpdaterStatus {
  return currentStatus;
}

export function checkForUpdates(): void {
  // electron-updater reads app-update.yml from the packaged app's resources
  // — it doesn't exist in a dev/unpacked run (npm start / npm run dev), so
  // skip entirely rather than letting every dev session log a spurious error.
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => {
    // Most common cause here is just "no network" or GitHub being briefly
    // unreachable — not worth alarming the user over, same reasoning this
    // app already applies to other best-effort background checks (see
    // main.ts's display-watch/OBS-report comments). Logged, not surfaced.
    console.error('[updater] checkForUpdates failed:', err?.message || err);
  });
}

export function installUpdate(): void {
  if (currentStatus.phase !== 'downloaded') return;
  autoUpdater.quitAndInstall();
}

export function initUpdater(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setStatus({ phase: 'checking' }));

  autoUpdater.on('update-available', (info) => setStatus({ phase: 'downloading', version: info.version, percent: 0 }));

  autoUpdater.on('update-not-available', () => setStatus({ phase: 'idle' }));

  autoUpdater.on('download-progress', (progress) => {
    if (currentStatus.phase !== 'downloading') return;
    setStatus({ ...currentStatus, percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => setStatus({ phase: 'downloaded', version: info.version }));

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err?.message || err);
    // Don't clobber a 'downloaded' state with a later transient error (e.g.
    // a failed background re-check after an update is already sitting ready
    // to install) — only report the error if nothing useful is in progress.
    if (currentStatus.phase !== 'downloaded') setStatus({ phase: 'error', error: err?.message || String(err) });
  });

  setTimeout(checkForUpdates, INITIAL_CHECK_DELAY_MS);
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
