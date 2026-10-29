// electron/clip-result-report.ts — tiny, standalone POST helper so
// kick-clip.ts's caller can tell the website how a clip request turned out.
// Deliberately its own file rather than a new export on api.ts.
const BASE_URL = process.env.KICKPULSE_API_BASE || 'https://www.kickpulsebot.com';

export async function postClipResult(
  apiKey: string,
  requestId: string,
  result: { ok: boolean; clipUrl?: string; error?: string; debugInfo?: string },
): Promise<void> {
  try {
    await fetch(`${BASE_URL}/clips/desktop-result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, ...result }),
    });
  } catch (e) {
    console.error('[clip] failed to report result back to the website', e);
  }
}
