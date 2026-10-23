// electron/kick-clip.ts — real Kick clip creation (2026-10-23), the
// `clip.create` WS event's actual handler. Full investigation behind why
// this has to live here instead of the server: docs/history/
// kick-native-clip-creation.md (website repo). Short version — Kick's own
// clip-creation API (web.kick.com/api/v1/clips) is an undocumented BFF
// behind TWO real gates: Cloudflare Bot Management (a plain server-side
// fetch gets a flat 403 "blocked by security policy"; a real browser
// context does not), and Kick's own first-party website SESSION — a
// third-party OAuth app token (the only credential the website's own
// server ever holds) gets PAST Cloudflare fine from inside a real browser,
// then still gets a plain `{"data":{"type":"Forbidden"}}` from Kick's own
// backend. This app is the one thing that can plausibly hold a real,
// logged-in kick.com session: `oauth-login.ts`'s login/link BrowserWindows
// run on Electron's default (persistent, disk-backed) session with no
// `partition` override, so completing the normal Kick OAuth login/link
// flow in THIS app leaves a real kick.com session cookie sitting in that
// same default session — this module just reuses it by opening another
// BrowserWindow with no partition override either.
//
// UNVERIFIED end-to-end as of this writing — the exact initiateClip/
// finalizeClip request/response shape was never confirmed live (Kick's own
// frontend bundle only gave us the route names/methods, not a captured real
// request body — see the investigation doc). The body shapes and the
// "initiate starts capturing, finalize stops it and saves" interpretation
// below are an educated guess from the two endpoints' naming, not confirmed
// fact. Every failure path returns Kick's own RAW response body in `error`
// specifically so the very first real attempt (once someone has actually
// logged into Kick inside this app) tells us exactly what's wrong instead
// of a generic message — expect to need one quick follow-up fix once that
// happens.
import { BrowserWindow } from 'electron';

export interface CreateClipResult {
  ok: boolean;
  clipUrl?: string;
  error?: string;
}

export interface CreateClipParams {
  kickSlug: string;
  duration: number; // seconds, already clamped 10-60 by the server
  title: string;
}

const PAGE_TIMEOUT_MS = 20_000;

export async function createKickClip({ kickSlug, duration, title }: CreateClipParams): Promise<CreateClipResult> {
  // Visible, not headless — deliberate while this is unverified: Kick's own
  // login/captcha/consent UI (if the session has gone stale) should be
  // seeable and clickable by whoever's at the machine, not silently fail
  // behind a hidden window. Revisit once a few real clips have gone through
  // cleanly.
  const win = new BrowserWindow({
    width: 420, height: 300, show: true, title: 'KickPulse — creating clip…',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    await Promise.race([
      win.loadURL(`https://kick.com/${encodeURIComponent(kickSlug)}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('page load timeout')), PAGE_TIMEOUT_MS)),
    ]);

    // Resolve the real internal channel.id (distinct from the OAuth
    // broadcaster_user_id) — same unofficial kick.com/api/v2 lookup
    // lib/kickBrowser.js already relies on elsewhere, just run here instead
    // since we're already in a real browser context.
    const channelResult = await win.webContents.executeJavaScript(`
      fetch('https://kick.com/api/v2/channels/${kickSlug}')
        .then(r => r.ok ? r.json() : null)
        .then(d => d ? { id: d.id } : null)
        .catch(() => null)
    `);
    const channelId = channelResult?.id;
    if (!channelId) {
      return { ok: false, error: 'Could not resolve this channel\'s internal id from kick.com — is the slug correct?' };
    }

    // Diagnostic (2026-10-24) — session.cookies.get() can read HttpOnly
    // cookies too (unlike page-side document.cookie), so this tells us
    // whether "Login with Kick" actually left a real session behind at all,
    // without ever logging a cookie VALUE (just names) anywhere. Folded
    // into the error message below rather than logged separately, so it
    // shows up wherever the failure itself is seen (chat reply included).
    const kickCookies = await win.webContents.session.cookies.get({ domain: 'kick.com' });
    const cookieNames = kickCookies.map((c) => c.name).join(', ') || '(none)';

    // initiateClip — best-guess body; Kick's own frontend bundle only gave
    // us the route (`POST /v1/clips`), not a captured request shape.
    const initiateResult = await win.webContents.executeJavaScript(`
      fetch('https://web.kick.com/api/v1/clips', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ channel_id: ${channelId} }),
      }).then(async r => ({ status: r.status, text: await r.text() }))
        .catch(e => ({ status: 0, text: String(e) }))
    `);
    if (initiateResult.status < 200 || initiateResult.status >= 300) {
      return { ok: false, error: `initiateClip failed (HTTP ${initiateResult.status}): ${initiateResult.text.slice(0, 300)} [kick.com cookies present: ${cookieNames}]` };
    }
    let initiateData: any;
    try { initiateData = JSON.parse(initiateResult.text); } catch {
      return { ok: false, error: `initiateClip returned non-JSON: ${initiateResult.text.slice(0, 300)}` };
    }
    const clipId = initiateData?.data?.id ?? initiateData?.id;
    if (!clipId) {
      return { ok: false, error: `initiateClip had no clip id in its response: ${initiateResult.text.slice(0, 300)}` };
    }

    // The window between initiate and finalize IS the clip — "initiate"
    // starts capture, "finalize" stops it and saves, per the two endpoints'
    // own naming (never confirmed against a real captured request).
    await new Promise((r) => setTimeout(r, Math.max(1, duration) * 1000));

    const finalizeResult = await win.webContents.executeJavaScript(`
      fetch('https://web.kick.com/api/v1/clips/${clipId}/finalize', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ title: ${JSON.stringify(title)} }),
      }).then(async r => ({ status: r.status, text: await r.text() }))
        .catch(e => ({ status: 0, text: String(e) }))
    `);
    if (finalizeResult.status < 200 || finalizeResult.status >= 300) {
      return { ok: false, error: `finalizeClip failed (HTTP ${finalizeResult.status}): ${finalizeResult.text.slice(0, 300)}` };
    }
    let finalizeData: any;
    try { finalizeData = JSON.parse(finalizeResult.text); } catch { finalizeData = null; }
    const clipUrl = finalizeData?.data?.channel?.slug
      ? `https://kick.com/${finalizeData.data.channel.slug}?clip=${clipId}`
      : `https://kick.com/${kickSlug}?clip=${clipId}`;

    return { ok: true, clipUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    try { win.close(); } catch {}
  }
}
