// src/lib/webviewSession.ts — builds the one-time #desktop_session fragment
// consumed by the real website's own src/main.tsx bootstrap (added
// 2026-10-16). See that file's own comment for the full design/security
// reasoning (fragment, not a query param, so it never reaches server logs;
// carries only a bare non-secret userId, never a real credential — the
// website's own useAuth() re-derives a genuine session from just that id,
// exactly as it already does for a returning real browser tab).
export function desktopSessionFragment(userId: string): string {
  const payload = btoa(JSON.stringify({ userId }));
  return `#desktop_session=${encodeURIComponent(payload)}`;
}
