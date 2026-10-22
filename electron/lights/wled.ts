// electron/lights/wled.ts — WLED's own local JSON HTTP API (no auth, no
// cloud account — the common firmware for DIY ESP32 + WS2812B/SK6812 LED
// strip controllers, confirmed as "local control, full feature support" on
// Lumia Stream's own supported-brands page). Real API, not guessed:
// https://kno.wled.ge/interfaces/json-api/ — GET /json/info to identify a
// device, POST /json/state to control it.

import os from 'node:os';
import { hexToRgb, rgbToHex } from './color';

export interface WledTestResult {
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
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function testWled(ip: string): Promise<WledTestResult> {
  try {
    const info = await fetchJson(`http://${ip}/json/info`);
    return { ok: true, name: String(info?.name || ip) };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Timed out reaching that IP' : (err?.message || 'Could not reach device') };
  }
}

// discoverWledDevices (2026-10-16) — "is connecting with an IP the best
// way? I see Philips has the find my bridge on the network... I don't
// quite remember how Lumia found devices." A real local-network scan, not
// just manual IP entry: WLED devices have no mDNS/SSDP discovery this app
// has to rely on being unblocked on the network (routers/some Wi-Fi APs
// filter multicast traffic, which is exactly the kind of thing that makes
// "just use mDNS" less reliable in practice than it sounds) — a plain
// subnet sweep of /json/info works everywhere a normal LAN does, which is
// the actual Lumia-style "search for devices" experience this is standing
// in for. Only the local machine's own /24 is swept (the overwhelming
// majority of home networks), each address probed with a short timeout and
// real brand-field validation (info.brand === 'WLED', the device's own
// documented self-identification — https://kno.wled.ge/interfaces/json-api/)
// so a random unrelated HTTP server answering on port 80 (a printer, a
// router's own admin page) never gets listed as a found light. Swept in
// small concurrent batches rather than all 254 at once, to avoid tripping
// a router's own flood/rate protections or exhausting local sockets.
export interface WledDiscoveryResult {
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

async function probeWledAt(ip: string, timeoutMs: number): Promise<WledDiscoveryResult | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}/json/info`, { signal: controller.signal });
    if (!res.ok) return null;
    const info: any = await res.json();
    if (info?.brand !== 'WLED') return null; // a real, non-WLED HTTP server on this IP — don't list it
    return { ip, name: String(info?.name || ip) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function discoverWledDevices(onProgress?: (scanned: number, total: number) => void): Promise<WledDiscoveryResult[]> {
  const base = localSubnetBase();
  if (!base) throw new Error("Couldn't determine your network's address range");
  const addrs = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  const BATCH = 24;
  const TIMEOUT_MS = 700;
  const found: WledDiscoveryResult[] = [];
  for (let i = 0; i < addrs.length; i += BATCH) {
    const batch = addrs.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((ip) => probeWledAt(ip, TIMEOUT_MS)));
    for (const r of results) if (r) found.push(r);
    onProgress?.(Math.min(i + BATCH, addrs.length), addrs.length);
  }
  return found;
}

export interface WledState {
  on: boolean;
  brightness: number; // 0-100
  color: string;       // hex, no #
}

export async function getWledState(ip: string): Promise<WledState | null> {
  try {
    const state = await fetchJson(`http://${ip}/json/state`);
    const seg = Array.isArray(state?.seg) ? state.seg[0] : null;
    const rgb: number[] = Array.isArray(seg?.col?.[0]) ? seg.col[0] : [255, 255, 255];
    return {
      on: Boolean(state?.on),
      brightness: Math.round((Number(state?.bri) || 0) / 2.55),
      color: rgbToHex(rgb[0] ?? 255, rgb[1] ?? 255, rgb[2] ?? 255),
    };
  } catch {
    return null;
  }
}

// Partial update — WLED's own /json/state happily accepts just the fields
// you send, leaving the rest as-is (confirmed in its real API docs), so a
// caller only ever sends what actually changed rather than needing to know
// the device's full current state first.
//
// transitionMs (2026-10-18, Light Scenes/Reactions) — WLED's real, documented
// `tt` field (https://kno.wled.ge/interfaces/json-api/): a one-call-only
// transition time override, in tenths of a second, for a smooth crossfade
// into the new state instead of an instant jump. Rounds down to WLED's own
// units rather than up, so a caller asking for "at least" a given smoothness
// never gets a slower fade than expected.
export async function setWledState(ip: string, patch: { on?: boolean; brightness?: number; color?: string; transitionMs?: number }): Promise<void> {
  const body: any = {};
  if (patch.on !== undefined) body.on = patch.on;
  if (patch.brightness !== undefined) body.bri = Math.round(Math.max(0, Math.min(100, patch.brightness)) * 2.55);
  if (patch.color !== undefined) body.seg = [{ col: [hexToRgb(patch.color)] }];
  if (patch.transitionMs !== undefined) body.tt = Math.max(0, Math.round(patch.transitionMs / 100));
  await fetchJson(`http://${ip}/json/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
