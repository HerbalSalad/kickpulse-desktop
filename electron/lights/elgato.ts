// electron/lights/elgato.ts — Elgato Key Light / Key Light Air / Ring
// Light's own local HTTP API (no auth, no cloud account — the same "local
// control" shape as lights/wled.ts, 2026-10-30, direct request: "it would
// be great if we could connect elgato devices (lights etc)").
//
// Elgato has never published an official spec for this — unlike WLED's own
// documented json-api, this is reverse-engineered, but widely and
// consistently documented by multiple independent real-world projects
// (keylightd, the open_ecc Rust crate, a PowerShell module, several
// gists), not a single unverified source:
//   - Port 9123, no auth.
//   - GET  /elgato/accessory-info  — device identity (productName,
//     displayName, serialNumber).
//   - GET/PUT /elgato/lights — body/response:
//     { numberOfLights: 1, lights: [{ on: 0|1, brightness: 0-100,
//       temperature: 143-344 }] }. temperature is in mireds (not Kelvin,
//       not a hex color) — these are white-only panel lights with no RGB
//       at all, unlike WLED/Hue/Govee. The generic LightStatePatch.color
//       (hex) field has nothing real to map to here, so — same "degrade,
//       don't error" precedent lights/govee.ts's transitionMs gap already
//       set for this codebase — it's silently accepted and ignored by
//       setElgatoState below, never attempted as a lossy hex→mireds guess.
//
// NOT independently verified against real hardware (no Elgato device
// available while building this) — flagged, not hidden: one real,
// recurring community report (keylightd's own docs) says some firmware
// versions reset the connection on a plain HTTP/1.1 GET, needing HTTP/1.0
// for reads and `Connection: close` on writes. Node's fetch can't force
// HTTP/1.0, so this only applies `Connection: close` defensively on writes
// as the closest available mitigation — if a real device turns out to need
// the full HTTP/1.0 workaround, that's a genuine follow-up, not assumed
// fixed here.

import os from 'node:os';

export interface ElgatoTestResult {
  ok: boolean;
  name?: string;
  error?: string;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(t);
  }
}

export async function testElgato(ip: string): Promise<ElgatoTestResult> {
  try {
    const info = await fetchJson(`http://${ip}:9123/elgato/accessory-info`);
    return { ok: true, name: String(info?.displayName || info?.productName || ip) };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Timed out reaching that IP' : (err?.message || 'Could not reach device') };
  }
}

// Same plain subnet-sweep approach as lights/wled.ts (see its own header
// for why this was chosen over mDNS for that integration) — Elgato devices
// DO support real mDNS/Bonjour discovery via their own apps, but adding
// that here would mean a new dependency this codebase doesn't otherwise
// need; a sweep of /elgato/accessory-info needs nothing extra and already
// works for WLED's own local-only devices the same way.
export interface ElgatoDiscoveryResult {
  ip: string;
  name: string;
}

function localSubnetBase(): string | null {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        if (parts.length === 4) return parts.slice(0, 3).join('.');
      }
    }
  }
  return null;
}

async function probeElgatoAt(ip: string, timeoutMs: number): Promise<ElgatoDiscoveryResult | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:9123/elgato/accessory-info`, { signal: controller.signal });
    if (!res.ok) return null;
    const info: any = await res.json();
    // Validate this is genuinely an Elgato light, not some other HTTP
    // server that happens to be listening on 9123 — same "check a real
    // self-identifying field" reasoning wled.ts's own info.brand check
    // uses, adapted to this endpoint's own documented fields.
    if (!info?.productName && !info?.displayName) return null;
    return { ip, name: String(info?.displayName || info?.productName || ip) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function discoverElgatoDevices(onProgress?: (scanned: number, total: number) => void): Promise<ElgatoDiscoveryResult[]> {
  const base = localSubnetBase();
  if (!base) throw new Error("Couldn't determine your network's address range");
  const addrs = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  const BATCH = 24;
  const TIMEOUT_MS = 700;
  const found: ElgatoDiscoveryResult[] = [];
  for (let i = 0; i < addrs.length; i += BATCH) {
    const batch = addrs.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((ip) => probeElgatoAt(ip, TIMEOUT_MS)));
    for (const r of results) if (r) found.push(r);
    onProgress?.(Math.min(i + BATCH, addrs.length), addrs.length);
  }
  return found;
}

export interface ElgatoState {
  on: boolean;
  brightness: number; // 0-100
}

export async function getElgatoState(ip: string): Promise<ElgatoState | null> {
  try {
    const state = await fetchJson(`http://${ip}:9123/elgato/lights`);
    const light = Array.isArray(state?.lights) ? state.lights[0] : null;
    if (!light) return null;
    return { on: Number(light.on) === 1, brightness: Math.max(0, Math.min(100, Number(light.brightness) || 0)) };
  } catch {
    return null;
  }
}

// color is accepted (same LightStatePatch shape every provider gets) but
// deliberately ignored — see this file's header for why. transitionMs:
// Elgato's documented API has no such field either, so also ignored, same
// "degrade, don't error" precedent as lights/govee.ts.
export async function setElgatoState(ip: string, patch: { on?: boolean; brightness?: number; color?: string; transitionMs?: number }): Promise<void> {
  const light: any = {};
  if (patch.on !== undefined) light.on = patch.on ? 1 : 0;
  if (patch.brightness !== undefined) light.brightness = Math.round(Math.max(0, Math.min(100, patch.brightness)));
  if (Object.keys(light).length === 0) return;
  await fetchJson(`http://${ip}:9123/elgato/lights`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ numberOfLights: 1, lights: [light] }),
  });
}
