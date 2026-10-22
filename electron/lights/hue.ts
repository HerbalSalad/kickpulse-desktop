// electron/lights/hue.ts — Philips Hue's own local bridge API. No cloud
// account, no Hue login — a one-time PHYSICAL button press on the bridge is
// the entire auth flow, after which a local API token ("username") works
// forever against that bridge directly. Real, documented API:
// https://developers.meethue.com/develop/get-started-2/ — HTTP (not HTTPS)
// is used deliberately: the bridge's local API fully supports plain HTTP,
// and using it avoids needing to trust the bridge's self-signed HTTPS cert
// from a plain fetch() call for a same-local-network integration.
//
// Bridge discovery uses Philips' own official N-UPnP endpoint
// (discovery.meethue.com) — a real, long-standing Philips-hosted service
// for exactly this ("which bridge(s) are on my network"), not a guess.
// Not independently re-verified live against a real bridge this session
// (none available in this environment) — built directly from Hue's own
// published API docs, same "verify from the real source, don't guess"
// discipline this app follows elsewhere, flagged honestly where it
// couldn't be exercised end-to-end.

import { hexToHueSat, hueSatToHex } from './color';

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export interface DiscoveredBridge {
  id: string;
  ip: string;
}

export async function discoverHueBridges(): Promise<DiscoveredBridge[]> {
  try {
    const list = await fetchJson('https://discovery.meethue.com/');
    if (!Array.isArray(list)) return [];
    return list.map((b: any) => ({ id: String(b.id || b.internalipaddress), ip: String(b.internalipaddress) })).filter((b) => b.ip);
  } catch {
    return [];
  }
}

export type PairResult = { ok: true; username: string } | { ok: false; needsButtonPress: boolean; error: string };

// Call this repeatedly (e.g. every 1-2s) while asking the user to press the
// physical link button on their bridge — each call is a single attempt, not
// a blocking wait, matching Hue's own documented flow (the bridge rejects
// with a "link button not pressed" error until it's actually pressed).
export async function pairHueBridge(ip: string): Promise<PairResult> {
  try {
    const res = await fetchJson(`http://${ip}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devicetype: 'kickpulse_desktop#app' }),
    });
    const entry = Array.isArray(res) ? res[0] : null;
    if (entry?.success?.username) return { ok: true, username: entry.success.username };
    const desc = entry?.error?.description || 'Unknown error';
    const needsButtonPress = entry?.error?.type === 101 || /link button/i.test(desc);
    return { ok: false, needsButtonPress, error: needsButtonPress ? 'Press the link button on your Hue bridge, then try again' : desc };
  } catch (err: any) {
    return { ok: false, needsButtonPress: false, error: err?.name === 'AbortError' ? 'Timed out reaching that bridge' : (err?.message || 'Could not reach bridge') };
  }
}

export interface HueLightInfo {
  id: string;
  name: string;
  on: boolean;
  brightness: number; // 0-100
  color: string;        // hex, no #
  reachable: boolean;
}

export async function listHueLights(ip: string, username: string): Promise<HueLightInfo[]> {
  const lights = await fetchJson(`http://${ip}/api/${username}/lights`);
  if (!lights || typeof lights !== 'object') return [];
  return Object.entries(lights as Record<string, any>).map(([id, l]) => ({
    id,
    name: String(l.name || `Light ${id}`),
    on: Boolean(l.state?.on),
    brightness: Math.round((Number(l.state?.bri) || 0) / 2.54),
    color: hueSatToHex(Number(l.state?.hue) || 0, Number(l.state?.sat) || 0),
    reachable: l.state?.reachable !== false,
  }));
}

// transitionMs (2026-10-18, Light Scenes/Reactions) — Hue's real, documented
// `transitiontime` field: tenths of a second, per-call. Same unit/rounding
// convention as WLED's own `tt` field (wled.ts) for consistency, even though
// the two APIs spell it differently.
export async function setHueLightState(
  ip: string, username: string, lightId: string,
  patch: { on?: boolean; brightness?: number; color?: string; transitionMs?: number },
): Promise<void> {
  const body: any = {};
  if (patch.on !== undefined) body.on = patch.on;
  if (patch.brightness !== undefined) body.bri = Math.round(Math.max(1, Math.min(100, patch.brightness)) * 2.54);
  if (patch.color !== undefined) Object.assign(body, hexToHueSat(patch.color));
  if (patch.transitionMs !== undefined) body.transitiontime = Math.max(0, Math.round(patch.transitionMs / 100));
  await fetchJson(`http://${ip}/api/${username}/lights/${lightId}/state`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
