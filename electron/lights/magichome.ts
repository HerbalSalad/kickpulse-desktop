// electron/lights/magichome.ts — "Magic Home" / Zengge-protocol WiFi LED
// controllers (direct request: "add magic home and luya support for
// lights"). This is the same cheap RGB(W) controller chipset sold under a
// huge number of different storefront brand names — Home Assistant's own
// flux_led integration lists dozens of them (GEYUEYA Home, GIDEALED, GMK,
// Goldwin, Koopower, LEDENET, Lytworx, Magic Hue, Zengge, Zombber, etc, all
// one shared protocol) — which is exactly the pattern "LuYa" fits (an
// Amazon-storefront brand for the same OEM hardware). LuYa itself isn't on
// any brand list independently found this session — flagged, not hidden —
// but this one module covering both is the actual correct shape if that
// holds, same as flux_led already does for its whole brand list; if a real
// LuYa device turns out to speak something else, that's a genuine, visible
// follow-up (it'll just fail to answer discovery/the state query below),
// not a silent wrong guess.
//
// Protocol — no official spec; reverse-engineered by the community from real
// packet captures of the "Magic Home" app, confirmed this session straight
// from the actual flux_led source (https://github.com/lightinglibs/flux_led,
// the maintained fork of the original danielhiversen/flux_led) and
// steve228uk/zengge-lightcontrol's own README, not guessed:
//   - Discovery: UDP broadcast of the ASCII string "HF-A11ASSISTHREAD" to
//     255.255.255.255:48899, bound to source port 48899 too (flux_led's own
//     comment: "Legacy devices require source port to be the discovery
//     port"). A real device replies with plain ASCII
//     "<ip>,<id>,<model>" (flux_led's own doc example:
//     "192.168.214.252,B4E842E10588,AK001-ZJ2145").
//   - Control: plain TCP to the device's own IP, port 5577. Every command is
//     a fixed-length frame ending in a 1-byte checksum — the low 8 bits of
//     the sum of every byte before it (confirmed in both sources above).
//     Power:  71 23 0F <checksum>  (on)   /  71 24 0F <checksum>  (off)
//     Color:  31 RR GG BB WW 00 0F <checksum>  — WW (warm-white channel) and
//       the write-mask byte both stay 0x00 for a plain RGB(W) set (flux_led's
//       own construct_levels_change; this app never drives the warm-white
//       channel separately, same "just RGB" scope WLED/Govee already have).
//     State query: 81 8A 8B <checksum> — the device answers with a 14-byte
//       status frame (flux_led's own LEDENETRawState layout, byte offsets
//       confirmed against its source + cross-checked against zengge-
//       lightcontrol's own independent example):
//         [0]=0x81  [1]=model  [2]=power(0x23 on/0x24 off)  [3]=preset
//         [4]=mode  [5]=speed  [6]=R  [7]=G  [8]=B  [9]=warm white
//         [10]=version  [11]=cool white  [12]=color mode  [13]=checksum
//
// NOT independently verified against real hardware this session (no device
// available) — built directly from the two sources above, same "verify,
// don't guess" discipline every other provider in this folder follows.
//
// Brightness (no dedicated field): unlike WLED/Hue, this protocol has no
// separate brightness channel for plain RGB mode — the R/G/B bytes ARE the
// final output level, so "80% brightness" has to be baked into the RGB
// values actually sent. setMagicHomeState below does that by normalizing
// whichever color is in play (given, or read back from the device) to full
// value and scaling it by the target brightness — the same thing a Magic
// Home brightness slider does under the hood — so changing brightness alone
// doesn't silently reset the hue, and changing color alone doesn't silently
// jump back to full brightness.

import net from 'node:net';
import dgram from 'node:dgram';
import { hexToRgb, rgbToHex } from './color';

const CONTROL_PORT = 5577;
const DISCOVERY_PORT = 48899;
const DISCOVER_MESSAGE = Buffer.from('HF-A11ASSISTHREAD', 'ascii');

function checksum(bytes: number[]): number {
  return bytes.reduce((a, b) => a + b, 0) & 0xff;
}

function frame(bytes: number[]): Buffer {
  return Buffer.from([...bytes, checksum(bytes)]);
}

// Opens a fresh TCP connection, writes one command, and (when expectBytes is
// given) waits for at least that many reply bytes before resolving — these
// controllers are simple enough not to need a persistent connection per
// device, and a fresh connect/close per call avoids any stale-socket state
// across the gaps between calls (minutes to hours, same usage shape every
// other light in this app has).
function sendCommand(ip: string, payload: Buffer, expectBytes?: number, timeoutMs = 2000): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const chunks: Buffer[] = [];

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => { socket.destroy(); resolve(null); });
    }, timeoutMs);

    socket.once('error', (err) => settle(() => { socket.destroy(); reject(err); }));

    socket.connect(CONTROL_PORT, ip, () => {
      socket.write(payload);
      if (!expectBytes) {
        // Fire-and-forget commands (power/color) — these controllers don't
        // reliably ack every command (confirmed varies by firmware in both
        // sources above), so there's nothing worth waiting for; just give
        // the write a brief moment to flush before closing.
        setTimeout(() => settle(() => { socket.end(); resolve(null); }), 150);
      }
    });

    if (expectBytes) {
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length >= expectBytes) {
          settle(() => { socket.end(); resolve(Buffer.concat(chunks)); });
        }
      });
    }
  });
}

export interface MagicHomeTestResult {
  ok: boolean;
  error?: string;
}

export async function testMagicHome(ip: string): Promise<MagicHomeTestResult> {
  try {
    const reply = await sendCommand(ip, frame([0x81, 0x8a, 0x8b]), 14);
    if (!reply || reply.length < 14 || reply[0] !== 0x81) return { ok: false, error: "That IP didn't answer like a Magic Home/LuYa controller" };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.code === 'ECONNREFUSED' ? 'Nothing answered on port 5577 at that IP' : (err?.message || 'Could not reach device') };
  }
}

export interface MagicHomeDiscoveryResult {
  ip: string;
  id: string;
  model: string;
}

// Same "resolve with whatever was found, never reject" shape as Govee's own
// UDP discovery (lights/govee.ts) — a quiet network or a firewalled subnet
// should show "nothing found" in the UI, not a crashed scan.
export function discoverMagicHomeDevices(timeoutMs = 2500): Promise<MagicHomeDiscoveryResult[]> {
  return new Promise((resolve) => {
    const found = new Map<string, MagicHomeDiscoveryResult>();
    let settled = false;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* already gone */ }
      resolve(Array.from(found.values()));
    };

    socket.on('message', (msg) => {
      const text = msg.toString('ascii').replace(/[\r\n]+$/, '');
      const parts = text.split(',');
      // A real reply has 3 comma-separated fields (ip,id,model) — our own
      // broadcast echoing back is the bare "HF-A11ASSISTHREAD" string with
      // no commas at all, so this check alone already excludes it.
      if (parts.length >= 3 && parts[0]) found.set(parts[0], { ip: parts[0], id: parts[1], model: parts[2] });
    });

    socket.on('error', () => finish());

    socket.bind(DISCOVERY_PORT, () => {
      socket.setBroadcast(true);
      socket.send(DISCOVER_MESSAGE, DISCOVERY_PORT, '255.255.255.255', (err) => { if (err) finish(); });
    });

    setTimeout(finish, timeoutMs);
  });
}

export interface MagicHomeState {
  on: boolean;
  brightness: number; // 0-100, derived — see this file's header
  color: string;       // hex, no # — normalized to full value, brightness factored out
}

export async function getMagicHomeState(ip: string): Promise<MagicHomeState | null> {
  try {
    const reply = await sendCommand(ip, frame([0x81, 0x8a, 0x8b]), 14);
    if (!reply || reply.length < 14 || reply[0] !== 0x81) return null;
    const on = reply[2] === 0x23;
    const r = reply[6], g = reply[7], b = reply[8];
    const maxChannel = Math.max(r, g, b);
    const brightness = Math.round((maxChannel / 255) * 100);
    const norm = maxChannel > 0 ? 255 / maxChannel : 0;
    return { on, brightness, color: rgbToHex(r * norm, g * norm, b * norm) };
  } catch {
    return null;
  }
}

// transitionMs has no equivalent in this protocol (no field for it in
// either command above) — accepted by the shared LightStatePatch shape but
// silently ignored here, same "degrade, don't error" precedent lights/govee.ts
// and lights/elgato.ts's own gaps already set for this codebase.
export async function setMagicHomeState(ip: string, patch: { on?: boolean; brightness?: number; color?: string; transitionMs?: number }): Promise<void> {
  if (patch.on !== undefined) {
    await sendCommand(ip, frame([0x71, patch.on ? 0x23 : 0x24, 0x0f]));
  }
  if (patch.color !== undefined || patch.brightness !== undefined) {
    let colorHex = patch.color;
    let brightness = patch.brightness;
    if (colorHex === undefined || brightness === undefined) {
      // Only one of color/brightness was given — read the other back from
      // the device first (see this file's header on why these two aren't
      // independent channels here) rather than silently clobbering it.
      const current = await getMagicHomeState(ip);
      if (colorHex === undefined) colorHex = current?.color ?? 'ffffff';
      if (brightness === undefined) brightness = current?.brightness ?? 100;
    }
    const [r0, g0, b0] = hexToRgb(colorHex);
    const maxChannel = Math.max(r0, g0, b0) || 255;
    const norm = 255 / maxChannel;
    const scale = Math.max(0, Math.min(100, brightness)) / 100;
    const r = Math.round(r0 * norm * scale);
    const g = Math.round(g0 * norm * scale);
    const b = Math.round(b0 * norm * scale);
    await sendCommand(ip, frame([0x31, r, g, b, 0x00, 0x00, 0x0f]));
  }
}
