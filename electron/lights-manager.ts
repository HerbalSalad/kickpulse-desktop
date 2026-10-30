// electron/lights-manager.ts — the unified layer the renderer (DevicesPage)
// and Pulse Engine (via handleWsMessage) both go through, so neither has to
// know which provider a given configured light actually is.
import { loadConfig, saveConfig } from './store';
import * as wled from './lights/wled';
import * as hue from './lights/hue';
import * as govee from './lights/govee';
import * as elgato from './lights/elgato';
import type { LightDeviceConfig, LightState } from './types';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listDeviceConfigs(): LightDeviceConfig[] {
  return loadConfig().lightDevices;
}

// Live state for every configured device — queried fresh each call (lights
// can be changed by hand, by another app, or by WLED's own preset cycling,
// so nothing here is cached). A device that's unreachable right now still
// shows up, just flagged `reachable: false`, rather than silently vanishing
// from the list.
export async function listLiveStates(): Promise<LightState[]> {
  const cfg = loadConfig();
  const results = await Promise.all(cfg.lightDevices.map(async (d): Promise<LightState> => {
    if (d.provider === 'wled') {
      const s = d.ip ? await wled.getWledState(d.ip) : null;
      return { id: d.id, provider: 'wled', name: d.name, reachable: !!s, on: s?.on ?? false, brightness: s?.brightness ?? 0, color: s?.color ?? 'ffffff' };
    }
    if (d.provider === 'govee') {
      // Govee's documented LAN API is control-only from what's actually
      // verified here — there's no confirmed state-readback response shape
      // to parse (see lights/govee.ts's own header on what was and wasn't
      // confirmed from real sources), so this can't accurately report
      // CURRENT on/brightness/color the way WLED/Hue do. Reported as
      // reachable once configured (the device answered the discovery scan
      // to get added at all) with a neutral placeholder state — setting
      // state through this app still genuinely works, this only affects
      // what the Lights page shows BEFORE you've touched it this session.
      return { id: d.id, provider: 'govee', name: d.name, reachable: !!d.ip, on: false, brightness: 100, color: 'ffffff' };
    }
    if (d.provider === 'elgato') {
      // Unlike Govee above, Elgato's own /elgato/lights GET genuinely does
      // report real current on/brightness (see lights/elgato.ts) — color
      // is always a neutral placeholder since these are white-only panel
      // lights with no RGB concept at all, not a readback gap.
      const s = d.ip ? await elgato.getElgatoState(d.ip) : null;
      return { id: d.id, provider: 'elgato', name: d.name, reachable: !!s, on: s?.on ?? false, brightness: s?.brightness ?? 0, color: 'ffffff' };
    }
    // hue
    const bridge = cfg.hueBridges.find((b) => b.bridgeIp === d.bridgeIp);
    if (!bridge || !d.hueLightId) return { id: d.id, provider: 'hue', name: d.name, reachable: false, on: false, brightness: 0, color: 'ffffff' };
    try {
      const lights = await hue.listHueLights(bridge.bridgeIp, bridge.username);
      const l = lights.find((x) => x.id === d.hueLightId);
      if (!l) return { id: d.id, provider: 'hue', name: d.name, reachable: false, on: false, brightness: 0, color: 'ffffff' };
      return { id: d.id, provider: 'hue', name: d.name, reachable: l.reachable, on: l.on, brightness: l.brightness, color: l.color };
    } catch {
      return { id: d.id, provider: 'hue', name: d.name, reachable: false, on: false, brightness: 0, color: 'ffffff' };
    }
  }));
  return results;
}

export async function addWledDevice(ip: string, nameOverride?: string): Promise<{ ok: boolean; error?: string; device?: LightDeviceConfig }> {
  const test = await wled.testWled(ip);
  if (!test.ok) return { ok: false, error: test.error };
  const cfg = loadConfig();
  if (cfg.lightDevices.some((d) => d.provider === 'wled' && d.ip === ip)) return { ok: false, error: 'That device is already added' };
  const device: LightDeviceConfig = { id: uid(), provider: 'wled', name: nameOverride || test.name || ip, ip };
  saveConfig({ lightDevices: [...cfg.lightDevices, device] });
  return { ok: true, device };
}

// discoverWledOnNetwork (2026-10-16) — "is connecting with an IP the best
// way... Lumia had a nice interface and way to actually search for
// devices." A real local-network scan (see wled.ts's own discoverWledDevices
// for the full reasoning) rather than only manual IP entry.
export function discoverWledOnNetwork(onProgress?: (scanned: number, total: number) => void) {
  return wled.discoverWledDevices(onProgress);
}

// Govee (2026-10-16) — same "scan the network" UX as WLED above, but via
// Govee's own real UDP LAN-API discovery broadcast instead of an HTTP
// sweep (see lights/govee.ts's own header for the full protocol writeup
// and what is/isn't independently verified against real hardware).
export async function discoverGoveeOnNetwork() {
  return govee.discoverGoveeDevices();
}

export function addGoveeDevice(ip: string, nameOverride: string | undefined, sku: string | undefined): { ok: boolean; error?: string; device?: LightDeviceConfig } {
  const cfg = loadConfig();
  if (cfg.lightDevices.some((d) => d.provider === 'govee' && d.ip === ip)) return { ok: false, error: 'That device is already added' };
  const device: LightDeviceConfig = { id: uid(), provider: 'govee', name: nameOverride || sku || ip, ip };
  saveConfig({ lightDevices: [...cfg.lightDevices, device] });
  return { ok: true, device };
}

export async function addElgatoDevice(ip: string, nameOverride?: string): Promise<{ ok: boolean; error?: string; device?: LightDeviceConfig }> {
  const test = await elgato.testElgato(ip);
  if (!test.ok) return { ok: false, error: test.error };
  const cfg = loadConfig();
  if (cfg.lightDevices.some((d) => d.provider === 'elgato' && d.ip === ip)) return { ok: false, error: 'That device is already added' };
  const device: LightDeviceConfig = { id: uid(), provider: 'elgato', name: nameOverride || test.name || ip, ip };
  saveConfig({ lightDevices: [...cfg.lightDevices, device] });
  return { ok: true, device };
}

// discoverElgatoOnNetwork (2026-10-30, direct request: "connect elgato
// devices") — same "scan the network" UX as WLED above (see
// lights/elgato.ts's own header for why a subnet sweep was chosen here too).
export function discoverElgatoOnNetwork(onProgress?: (scanned: number, total: number) => void) {
  return elgato.discoverElgatoDevices(onProgress);
}

export async function discoverHueBridges() {
  return hue.discoverHueBridges();
}

// Attempts ONE pairing request — the caller (DevicesPage) is expected to
// retry this every second or two while showing "press the button on your
// bridge", matching Hue's own real pairing flow (it's not a blocking wait
// on this side, the bridge just keeps rejecting until the button is
// physically pressed).
export async function pairHueBridge(ip: string) {
  const result = await hue.pairHueBridge(ip);
  if (result.ok) {
    const cfg = loadConfig();
    if (!cfg.hueBridges.some((b) => b.bridgeIp === ip)) {
      saveConfig({ hueBridges: [...cfg.hueBridges, { bridgeIp: ip, username: result.username }] });
    }
  }
  return result;
}

export function listPairedHueBridges() {
  return loadConfig().hueBridges;
}

export async function listHueBridgeLights(bridgeIp: string) {
  const bridge = loadConfig().hueBridges.find((b) => b.bridgeIp === bridgeIp);
  if (!bridge) throw new Error('Bridge not paired');
  return hue.listHueLights(bridge.bridgeIp, bridge.username);
}

export function addHueLightDevice(bridgeIp: string, hueLightId: string, name: string): LightDeviceConfig {
  const cfg = loadConfig();
  if (cfg.lightDevices.some((d) => d.provider === 'hue' && d.bridgeIp === bridgeIp && d.hueLightId === hueLightId)) {
    throw new Error('That light is already added');
  }
  const device: LightDeviceConfig = { id: uid(), provider: 'hue', name, bridgeIp, hueLightId };
  saveConfig({ lightDevices: [...cfg.lightDevices, device] });
  return device;
}

export function removeDevice(id: string): void {
  const cfg = loadConfig();
  saveConfig({ lightDevices: cfg.lightDevices.filter((d) => d.id !== id) });
}

export function renameDevice(id: string, name: string): void {
  const cfg = loadConfig();
  saveConfig({ lightDevices: cfg.lightDevices.map((d) => (d.id === id ? { ...d, name } : d)) });
}

export interface LightStatePatch {
  on?: boolean;
  brightness?: number; // 0-100
  color?: string;       // hex, no #
  // transitionMs (2026-10-18, Light Scenes/Reactions) — a smooth crossfade
  // into the new state instead of an instant jump. Real, supported on WLED
  // (`tt`) and Hue (`transitiontime`) — Govee's real LAN control protocol has
  // no such parameter at all (confirmed against its own documented command
  // set, see lights/govee.ts), so it's silently ignored there: every Govee
  // change is instant regardless of this field, same "degrade, don't error"
  // shape every other per-provider capability gap in this file already uses.
  transitionMs?: number;
}

async function setOneDevice(d: LightDeviceConfig, patch: LightStatePatch): Promise<void> {
  if (d.provider === 'wled') {
    if (!d.ip) return;
    await wled.setWledState(d.ip, patch);
    return;
  }
  if (d.provider === 'govee') {
    if (!d.ip) return;
    await govee.setGoveeState(d.ip, patch); // transitionMs has no equivalent here — ignored
    return;
  }
  if (d.provider === 'elgato') {
    if (!d.ip) return;
    await elgato.setElgatoState(d.ip, patch); // color/transitionMs have no equivalent here — ignored, see lights/elgato.ts
    return;
  }
  const cfg = loadConfig();
  const bridge = cfg.hueBridges.find((b) => b.bridgeIp === d.bridgeIp);
  if (!bridge || !d.hueLightId) return;
  await hue.setHueLightState(bridge.bridgeIp, bridge.username, d.hueLightId, patch);
}

// target: a specific device id, or 'all' — the same "one specific X, or
// every X" convention this app's other Pulse Engine-reachable targets
// (spin_wheel's configId, add_subathon_time's timerId) already use. Each
// device call is independent and non-blocking of the others — one
// unreachable light failing never stops the rest from updating.
export async function setDeviceState(target: string, patch: LightStatePatch): Promise<void> {
  const cfg = loadConfig();
  const devices = target === 'all' ? cfg.lightDevices : cfg.lightDevices.filter((d) => d.id === target);
  await Promise.all(devices.map((d) => setOneDevice(d, patch).catch((err) => console.error(`[lights] ${d.name} update failed`, err?.message || err))));
}

// ── Momentary hold (2026-10-22) — real hardware's own equivalent of what
// Virtual Light already had: snapshot the targeted device(s)' current
// state, apply the new one, then restore the snapshot — either after a
// fixed local timer (holdId omitted — a plain flash set directly on a
// Pulse Engine rule's action), or by waiting for an explicit revertHold()
// call instead (holdId present — a Chat Bot Command's "Duration" field,
// which the server extends to wait for a paired TTS/sound effect to
// actually finish before telling us to revert). A generous local backstop
// still exists for the holdId case, in case the server's light.revertHold
// broadcast is ever lost (a WS reconnect gap, etc.) — the server itself
// already guarantees sending it within holdMs + 20s, so this is a last
// resort, not the normal path. ──
const _pendingHolds = new Map<string, { revert: () => void }>();

export async function setDeviceStateMomentary(
  target: string,
  patch: LightStatePatch,
  opts: { holdMs: number; holdId?: string },
): Promise<void> {
  const cfg = loadConfig();
  const devices = target === 'all' ? cfg.lightDevices : cfg.lightDevices.filter((d) => d.id === target);
  if (devices.length === 0) return;

  const liveStates = await listLiveStates();
  const snapshot = new Map(liveStates.filter((s) => devices.some((d) => d.id === s.id)).map((s) => [s.id, s]));

  await setDeviceState(target, patch);

  let reverted = false;
  const doRevert = () => {
    if (reverted) return;
    reverted = true;
    for (const d of devices) {
      const prev = snapshot.get(d.id);
      if (!prev) continue;
      setOneDevice(d, { on: prev.on, brightness: prev.brightness, color: prev.color })
        .catch((err) => console.error(`[lights] ${d.name} revert failed`, err?.message || err));
    }
    if (opts.holdId) _pendingHolds.delete(opts.holdId);
  };

  if (opts.holdId) {
    const backstop = setTimeout(doRevert, opts.holdMs + 30_000);
    _pendingHolds.set(opts.holdId, { revert: () => { clearTimeout(backstop); doRevert(); } });
  } else {
    setTimeout(doRevert, Math.max(50, opts.holdMs));
  }
}

// Called from main.ts's inbound 'light.revertHold' WS handler (the
// server's authoritative "it's safe to revert now" signal).
export function revertHold(holdId: string): void {
  _pendingHolds.get(holdId)?.revert();
}
