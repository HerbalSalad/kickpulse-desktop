// electron/kickWebLogin.ts — a dedicated, discoverable way to establish
// the real kick.com browser session that kick-clip.ts's !clip/
// kick_clip_create actually need (2026-10-29, direct report: "a more
// clear way for them to login with kick so that they can get clips
// working. Currently its not very clear and the only way I know how is to
// disconnect from settings and then log in with kick").
//
// That workaround was heavy-handed for what it actually needed: the real
// fix doesn't touch platform_accounts or the OAuth link at all. Every
// BrowserWindow oauth-login.ts opens (loginWithKick, linkKick, etc.) runs
// with NO `partition` override, i.e. Electron's default, persistent,
// disk-backed session — so simply opening ANY real browser window on that
// same default session and letting the user log into kick.com normally
// (not through the OAuth dance at all, just kick.com's own plain login)
// leaves the same session_token cookie behind that kick-clip.ts reads.
// This file is that window, standalone, with a clear single purpose.
import { BrowserWindow, session } from 'electron';

export interface KickWebSessionStatus {
  loggedIn: boolean;
}

// Same check kick-clip.ts already does before attempting a clip (session
// .cookies.get() reads the real value directly, works regardless of
// HttpOnly) — exposed standalone so the Connections page can show real
// status without needing to actually attempt a clip first.
export async function getKickWebSessionStatus(): Promise<KickWebSessionStatus> {
  const cookies = await session.defaultSession.cookies.get({ domain: 'kick.com', name: 'session_token' });
  return { loggedIn: !!cookies[0]?.value };
}

// Opens a plain, visible kick.com tab — not an OAuth round trip, just
// kick.com's own normal login UI — and resolves with the real resulting
// status once the user closes the window (closing is how they say "done,"
// same as how a real browser login flow ends).
export function openKickWebLogin(): Promise<KickWebSessionStatus> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480, height: 760, show: true, title: 'Log in to Kick (for Clips)',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL('https://kick.com/');
    win.on('closed', () => {
      getKickWebSessionStatus().then(resolve);
    });
  });
}
