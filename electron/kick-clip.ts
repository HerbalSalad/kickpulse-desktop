// electron/kick-clip.ts — real Kick clip creation, the `clip.create` WS
// event's actual handler.
//
// CONFIRMED WORKING END-TO-END 2026-10-29 — two independent live tests
// (timer on screen at the time of the command vs. the resulting clip's own
// start) landed within single-digit seconds of "now," consistent with
// ordinary live-stream viewer delay, not a real offset bug. Full
// investigation write-up, including the two wrong trim_start guesses tried
// first: docs/history/kick-native-clip-creation.md (website repo). Direct
// instruction after confirming this: "lets not fuck with it" — don't
// re-open this investigation without a genuinely new, real complaint.
//
// CONTRACT CONFIRMED LIVE 2026-10-29 — previously an unverified guess from
// just Kick's frontend bundle's route names (channel_id + an "initiate
// starts capturing, finalize stops it" wait-then-finalize model). That
// guess is gone; this is captured directly from kick.com's own frontend
// making a real clip (website repo's extension/ capture tooling):
//   1. POST https://web.kick.com/api/v1/clips        { video_id }        -> 201, { data: { id: "clip_...", preview_url: "<m3u8>" } }
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
// itself.
//
// trim_start — the real fix, found 2026-10-29 after two wrong guesses
// (absolute-offset-from-broadcast-start caused a real finalize HTTP 500;
// a flat 0 just grabbed inconsistent, usually-stale footage). The create
// response's `preview_url` is a real HLS playlist of Kick's own raw
// extracted window — summing its `#EXTINF` segment durations gives the
// ACTUAL window length Kick computed for THIS specific request, no
// guessing a constant that might not even be stable. trim_start is then
// computed as (that real length) minus the requested clip duration, so it
// lands on the most recent `duration` seconds of whatever window Kick
// actually gave us. Falls back to trim_start: 0 (the one value proven to
// never error) if the playlist can't be fetched or parsed for any reason.
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
  kickSlug: string;  // only used to load a real page and build the final clipUrl
  videoId: string;   // resolved server-side — see header
  duration: number;  // seconds, already clamped 10-60 by the server
  title: string;
  debug?: boolean;   // opt-in (!clip ... debug) — echoes the measured window length/raw response
}

const PAGE_TIMEOUT_MS = 20_000;

// Sums #EXTINF:<seconds> lines in an HLS playlist — the real, measured
// length of Kick's raw extracted clip window, not a guessed constant.
function sumExtinf(m3u8Text: string): number | null {
  const matches = [...m3u8Text.matchAll(/#EXTINF:([\d.]+)/g)];
  if (!matches.length) return null;
  return matches.reduce((sum, m) => sum + parseFloat(m[1]), 0);
}

export async function createKickClip({ kickSlug, videoId, duration, title, debug }: CreateClipParams): Promise<CreateClipResult> {
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

    let createData: any = null;
    try { createData = JSON.parse(createResult.text); } catch { /* fall through to regex below */ }
    const clipId = createData?.data?.id ?? /clip_[A-Za-z0-9]+/.exec(createResult.text)?.[0];
    if (!clipId) {
      return { ok: false, error: `create response had no clip_* id: ${createResult.text.slice(0, 300)}` };
    }
    const previewUrl = createData?.data?.preview_url;

    // Measure the REAL window length from Kick's own preview playlist —
    // see header. windowLength stays null (falls back to trim_start: 0)
    // if there's no preview_url, the fetch fails, or it has no #EXTINF
    // lines to sum.
    let windowLength: number | null = null;
    if (previewUrl) {
      try {
        const m3u8Text: string = await win.webContents.executeJavaScript(`
          fetch(${JSON.stringify(previewUrl)}).then(r => r.text()).catch(() => '')
        `);
        windowLength = sumExtinf(m3u8Text);
      } catch { /* best effort — trim_start just falls back to 0 below */ }
    }
    const trimStart = windowLength != null ? Math.max(0, Math.round(windowLength - duration)) : 0;

    const debugInfo = debug
      ? `windowLength=${windowLength != null ? windowLength.toFixed(1) + 's' : 'unknown'} trimStart=${trimStart} create=${createResult.text.slice(0, 250)}`
      : undefined;

    const finalizeResult = await win.webContents.executeJavaScript(`
      fetch('https://web.kick.com/api/v1/clips/${clipId}/finalize', {
        method: 'POST', credentials: 'include',
        headers: {
          'Authorization': 'Bearer ${sessionToken}',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-app-platform': 'web',
        },
        body: JSON.stringify({ title: ${JSON.stringify(title)}, trim_start: ${trimStart}, trim_duration: ${Math.max(1, Number(duration) || 30)} }),
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
