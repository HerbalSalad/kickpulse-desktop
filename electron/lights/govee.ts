// electron/lights/govee.ts — Govee's own real, documented LAN Control API
// (https://app-h5.govee.com/user-manual/wlan-guide — Govee's own domain;
// also cross-checked against homebridge-govee's real connection/lan.js
// source and several independent LAN-API implementations before building
// this, same "verify, don't guess" discipline the WLED/Hue modules already
// follow). Local-only, no cloud account — same reason WLED/Hue were picked
// as the first two providers — but needs ONE real prerequisite Hue/WLED
// don't: LAN Control has to be switched ON per-device inside the Govee
// Home app first (off by default); a device with it off simply never
// answers the scan at all, which isn't distinguishable from "no Govee
// lights on this network" from here. Surfaced directly in the UI rather
// than left as a silent dead end.
//
// Protocol (plain JSON over UDP, confirmed from the sources above):
//   - Discovery: send {msg:{cmd:'scan',data:{account_topic:'reserve'}}} as
//     a UDP multicast to 239.255.255.250:4001; devices reply via UNICAST
//     (not multicast) back to whichever port the sender is bound to — this
//     app binds 4002, Govee's own documented reply port.
//   - Control: UDP unicast straight to the device's own IP, port 4003.
//     turn: {msg:{cmd:'turn',data:{value:1|0}}}
//     brightness: {msg:{cmd:'brightness',data:{value:0-100}}}
//     colorwc: {msg:{cmd:'colorwc',data:{color:{r,g,b},colorTemInKelvin:0}}}
//     (colorTemInKelvin stays 0 here — this app only ever sets plain RGB,
//     never a white-balance temperature; Govee's own guide documents 0 as
//     "use the RGB color, not a kelvin value.")
//
// NOT independently verified against real Govee hardware this session (no
// device available) — built directly from the real protocol sources above,
// same category of disclosed, not-yet-hardware-tested work as the original
// Hue module's own header.

import dgram from 'node:dgram';
import { hexToRgb } from './color';

const DISCOVERY_PORT = 4001;
const LISTEN_PORT = 4002;
const CONTROL_PORT = 4003;
const MULTICAST_ADDR = '239.255.255.250';

export interface GoveeDiscoveryResult {
  ip: string;
  deviceId?: string;
  sku?: string;
}

export interface GoveeDiscoveryOutcome {
  ok: boolean;
  devices: GoveeDiscoveryResult[];
  error?: string;
}

// Scans for 3s — Govee devices reply almost immediately once they see the
// scan packet, so this is mostly margin for a slower Wi-Fi network, not a
// real expected wait. Resolves with whatever was found even on a genuine
// socket error (e.g. a firewall rule actively rejecting the bind/send) so
// the caller always gets a real, if possibly empty, result rather than a
// rejected promise interrupting the UI's own flow.
export function discoverGoveeDevices(timeoutMs = 3000): Promise<GoveeDiscoveryOutcome> {
  return new Promise((resolve) => {
    const found = new Map<string, GoveeDiscoveryResult>();
    let settled = false;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* already gone */ }
      resolve({ ok: !error, devices: Array.from(found.values()), error });
    };

    socket.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        const data = parsed?.msg?.data;
        if (data?.ip) found.set(data.ip, { ip: String(data.ip), deviceId: data.device ? String(data.device) : undefined, sku: data.sku ? String(data.sku) : undefined });
      } catch {
        // not a valid Govee JSON reply — ignore and keep listening
      }
    });

    socket.on('error', (err: any) => {
      // EADDRINUSE (2026-10-16) — a real, documented Govee LAN-API footgun:
      // another app already using this same protocol on this machine (the
      // real Govee Home app, or e.g. Home Assistant's govee2mqtt) can hold
      // port 4002 exclusively, blocking any other scanner from binding it.
      finish(err?.code === 'EADDRINUSE'
        ? 'Port 4002 is already in use — close the Govee Home app (or any other Govee integration) and try again.'
        : (err?.message || 'Network error while scanning'));
    });

    socket.bind(LISTEN_PORT, () => {
      const payload = Buffer.from(JSON.stringify({ msg: { cmd: 'scan', data: { account_topic: 'reserve' } } }));
      socket.send(payload, DISCOVERY_PORT, MULTICAST_ADDR, (err) => {
        if (err) finish(err.message || 'Failed to send discovery packet');
      });
    });

    setTimeout(() => finish(), timeoutMs);
  });
}

function sendCommand(ip: string, cmd: string, data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const payload = Buffer.from(JSON.stringify({ msg: { cmd, data } }));
    socket.send(payload, CONTROL_PORT, ip, (err) => {
      socket.close();
      if (err) reject(err); else resolve();
    });
  });
}

export async function setGoveeState(ip: string, patch: { on?: boolean; brightness?: number; color?: string }): Promise<void> {
  if (patch.on !== undefined) await sendCommand(ip, 'turn', { value: patch.on ? 1 : 0 });
  if (patch.brightness !== undefined) {
    await sendCommand(ip, 'brightness', { value: Math.max(0, Math.min(100, Math.round(patch.brightness))) });
  }
  if (patch.color !== undefined) {
    const [r, g, b] = hexToRgb(patch.color);
    await sendCommand(ip, 'colorwc', { color: { r, g, b }, colorTemInKelvin: 0 });
  }
}
