// electron/ws-client.ts — connects to the exact same WebSocket hub every
// OBS widget browser source already uses (src/hooks/useWidgetWebSocket.ts
// on the website), subscribed with `kind: 'widget'` the same way a real
// overlay source would be.
//
// This module is deliberately dumb — it just parses frames and hands the
// raw message object to the caller. There are two real shapes it forwards:
//   - `{type:'jumpscare_trigger'}` — a bare, no-payload message (server.js
//     relays it verbatim whenever Jumpscare Meter maxes out, a
//     `!jumpscare`-style chat trigger fires, or a Pulse Engine rule's
//     `jumpscare` action runs).
//   - `{type:'kickEvent', event, payload}` — the normal enveloped shape
//     every other real-time event in this app uses (Pulse Engine's
//     obs_switch_scene/trigger_scene actions, among many others on the
//     website this app doesn't yet react to). main.ts owns deciding which
//     `event` names it actually cares about and what to do about them —
//     this file has no business logic of its own beyond "forward the
//     message," so adding a new reaction never needs a change here.

import WebSocket from 'ws';

const WS_BASE = process.env.KICKPULSE_WS_BASE || 'wss://www.kickpulsebot.com/ws';

export interface WsClientHandle {
  close: () => void;
}

export function connectToKickPulse(broadcasterId: string, onMessage: (msg: any) => void): WsClientHandle {
  let ws: WebSocket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let dead = false;

  const connect = () => {
    if (dead) return;
    ws = new WebSocket(WS_BASE);

    ws.on('open', () => {
      // kind: 'desktop' (2026-10-20, replacing the previous same-day fix's
      // 'dashboard' — direct follow-up: "we need to fix that [YouTube/
      // TikTok chat only arriving when a real OBS widget is also open]").
      // This app is a dashboard-style consumer of this WS channel (jump-
      // scare/scene triggers, chat/events in), never a real OBS browser
      // source — the original 'widget' kind made Spotify's poller think a
      // real Now Playing widget was open the whole time this app was
      // connected (fixed by switching to 'dashboard'). But 'dashboard' ALSO
      // excludes this app from YouTube/TikTok Live's own "is anyone
      // connected" reconcile (server.js's currentlyConnectedForChatCapture)
      // — unlike Spotify, this app's own Live Chat dashboard genuinely DOES
      // want YouTube/TikTok chat to keep flowing with no OBS widget open at
      // all. 'desktop' is its own distinct kind so the server can tell
      // these two needs apart: still excluded from Spotify/Live Now's
      // "is a widget open" signal, but counted for YouTube/TikTok capture.
      // Every `wss.clients.forEach` broadcast loop in server.js still
      // matches only on broadcasterId, never subscribeKind, so this has
      // zero effect on actually receiving jumpscare/scene/chat messages
      // here either way.
      ws?.send(JSON.stringify({ type: 'subscribe', broadcasterId, kind: 'desktop' }));
      console.log('[ws] subscribed as broadcaster', broadcasterId);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        onMessage(msg);
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      ws = null;
      if (!dead) timer = setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
      console.error('[ws] error', err.message);
      ws?.close();
    });
  };

  connect();

  return {
    close: () => {
      dead = true;
      if (timer) clearTimeout(timer);
      ws?.close();
      ws = null;
    },
  };
}
