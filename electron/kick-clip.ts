// electron/kick-clip.ts — real Kick clip creation, the `clip.create` WS
// event's actual handler.
//
// CONTRACT CONFIRMED LIVE 2026-10-29 — previously an unverified guess from
// just Kick's frontend bundle's route names (channel_id + an "initiate
// starts capturing, finalize stops it" wait-then-finalize model). That
// guess is gone; this is captured directly from kick.com's own frontend
// making a real clip (website repo's extension/ capture tooling):
//   1. POST https://web.kick.com/api/v1/clips        { video_id }        -> 201, response has clip_<id>
//   2. POST https://web.kick.com/api/v1/clips/<id>/finalize
//        { title, trim_start, trim_duration }                            -> 200, publishes it immediately
// No "wait N seconds between them" — Kick's clip is retroactive (clipping
// already-recorded footage via video_id), not a live start/stop capture.
// Both calls send `Authorization: Bearer <value>` where <value> is EXACTLY
// kick.com's own `session_token` cookie value — Kick's frontend reads that
// cookie and replays it as a header; no separate CSRF token observed.
//
// video_id is resolved SERVER-SIDE (website repo's lib/kickClipAction.js,
// via Kick's official GET /public/v1/users/livestreams API) and arrives
// already in CreateClipParams — this file no longer resolves a channel id
// itself (the old version's kick.com/api/v2/channels/{slug} lookup is gone,
// dead weight now that video_id comes in directly).
//
// trim_start — still genuinely unresolved, see lib/kickClipAction.js's own
// header (website repo) for the full story: a first theory ("offset from
// absolute broadcast start," computed from elapsed time since go-live) was
// tried and reverted the same day after it made finalize return a real
// HTTP 500 instead of succeeding — Kick's backend doesn't gracefully clamp
// an out-of-range trim_start, it falls over. Back to the one value proven
// to never error: 0 (still not confirmed to mean "now" — two real reports
// describe different offsets-from-now with it). `debug` below exists
// specifically to stop guessing a third formula: it surfaces Kick's own
// real create-response body (which almost certainly carries the actual
// window length) back through the chat reply on the next test.
//
// Why this has to run in a real BrowserWindow at all (not Node's own
// fetch): Kick's own clip API sits behind Cloudflare Bot Management, which
// 403s a plain server-side fetch regardless of a valid token — same root
// cause as the website repo's lib/kickBrowser.js. `oauth-login.ts`'s login/
// link BrowserWindows run on Electron's default (persistent, disk-backed)
// session with no `partition` override, so completing the normal Kick
// OAuth login flow in THIS app leaves a real kick.com session cookie
// sitting in that same default session — this module reuses it by opening
// another BrowserWindow with no partition override either.
import { BrowserWindow } from 'electron';

export interface CreateClipResult {
  ok: boolean;
  clipUrl?: string;
  error?: string;
  debugInfo?: string;
}

export interface CreateClipParams {
  kickSlug: string;   // only used to load a real page and build the final clipUrl
  videoId: string;    // resolved server-side — see header
  duration: number;   // seconds, already clamped 10-60 by the server
  trimStart: number;  // seconds into video_id's own recording — resolved server-side, see header
  title: string;
  debug?: boolean;    // opt-in (!clip ... debug) — see header comment
}

const PAGE_TIMEOUT_MS = 20_000;

export async function createKickClip({ kickSlug, videoId, duration, trimStart, title, debug }: CreateClipParams): Promise<CreateClipResult> {
  // Visible, not headless — deliberate while this is freshly-verified:
  // Kick's own login/captcha/consent UI (if the session has gone stale)
  // should be seeable and clickable by whoever's at the machine, not
  // silently fail behind a hidden window. Revisit once a few real clips
  // have gone through cleanly.
  const win = new BrowserWindow({
    width: 420, height: 300, show: true, title: 'KickPulse — creating clip…',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    await Promise.race([
      win.loadURL(`https://kick.com/${encodeURIComponent(kickSlug)}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('page load timeout')), PAGE_TIMEOUT_MS)),
    ]);

    // session.cookies.get() reads the real cookie value directly (works
    // regardless of HttpOnly, unlike page-side document.cookie) — same
    // mechanism the pre-existing cookie-name diagnostic below already used,
    // just also keeping the actual value this time since we need it.
    const sessionCookies = await win.webContents.session.cookies.get({ domain: 'kick.com', name: 'session_token' });
    const sessionToken = sessionCookies[0]?.value;
    const allKickCookies = await win.webContents.session.cookies.get({ domain: 'kick.com' });
    const cookieNames = allKickCookies.map((c) => c.name).join(', ') || '(none)';
    if (!sessionToken) {
      return { ok: false, error: `No kick.com session_token cookie found — log into Kick inside this app first (Settings/Connections). [kick.com cookies present: ${cookieNames}]` };
    }

    const createResult = await win.webContents.executeJavaScript(`
      fetch('https://web.kick.com/api/v1/clips', {
        method: 'POST', credentials: 'include',
        headers: {
          'Authorization': 'Bearer ${sessionToken}',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-app-platform': 'web',
        },
        body: JSON.stringify({ video_id: ${JSON.stringify(videoId)} }),
      }).then(async r => ({ status: r.status, text: await r.text() }))
        .catch(e => ({ status: 0, text: String(e) }))
    `);
    if (createResult.status < 200 || createResult.status >= 300) {
      return { ok: false, error: `create failed (HTTP ${createResult.status}): ${createResult.text.slice(0, 300)} [kick.com cookies present: ${cookieNames}]` };
    }
    const clipIdMatch = /clip_[A-Za-z0-9]+/.exec(createResult.text);
    if (!clipIdMatch) {
      return { ok: false, error: `create response had no clip_* id: ${createResult.text.slice(0, 300)}` };
    }
    const clipId = clipIdMatch[0];
    // debug: carry Kick's own real create-response body through to the
    // chat reply regardless of outcome — it's the actual fix for trim_start
    // once we see it, not something to leave sitting in a discarded variable.
    const debugInfo = debug ? `create response: ${createResult.text.slice(0, 400)}` : undefined;

    const finalizeResult = await win.webContents.executeJavaScript(`
      fetch('https://web.kick.com/api/v1/clips/${clipId}/finalize', {
        method: 'POST', credentials: 'include',
        headers: {
          'Authorization': 'Bearer ${sessionToken}',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-app-platform': 'web',
        },
        body: JSON.stringify({ title: ${JSON.stringify(title)}, trim_start: ${Math.max(0, Number(trimStart) || 0)}, trim_duration: ${Math.max(1, Number(duration) || 30)} }),
      }).then(async r => ({ status: r.status, text: await r.text() }))
        .catch(e => ({ status: 0, text: String(e) }))
    `);
    if (finalizeResult.status < 200 || finalizeResult.status >= 300) {
      return { ok: false, error: `finalize failed (HTTP ${finalizeResult.status}): ${finalizeResult.text.slice(0, 300)}`, debugInfo };
    }

    return { ok: true, clipUrl: `https://kick.com/${kickSlug}?clip=${clipId}`, debugInfo };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    try { win.close(); } catch {}
  }
}
