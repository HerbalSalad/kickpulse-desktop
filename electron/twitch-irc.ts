// electron/twitch-irc.ts — anonymous, read-only Twitch IRC-over-WebSocket
// connection (justinfan###, no auth needed to read public chat), ported
// from the website's own useTwitchIRC (kickpulse-new's
// src/hooks/useChatOverlay.ts) so the Live Chat & Event Feed page
// (src/pages/LiveChatPage.tsx) can show Twitch chat the same way Chat
// Overlay/Scrolling Chat already do on the website.
//
// Twitch chat was never part of this app's own WS hub fan-out (see
// ws-client.ts's header) — the server deliberately never forwards
// channel.chat.message over that connection, same reason the website's own
// chat widgets talk to Twitch IRC directly instead of through the server.
// This is a plain Node port of that same anonymous connection — same
// "dumb, no business logic" split ws-client.ts already established:
// main.ts owns what happens with a parsed message.

import WebSocket from 'ws';

export interface TwitchChatMessage {
  id: string;
  username: string;
  content: string;
  color: string | null;
  badges: { type: string; count: number }[];
  createdAt: string;
  // emotesTag — Twitch's raw IRC `emotes` tag ("id:start-end,start-end/id2:
  // ...", byte offsets into `content`), kept as-is rather than parsed here —
  // the renderer does the actual id->position->img splicing (see
  // src/lib/chatEmotes.ts), same split this app already has between main
  // process (transport) and renderer (render).
  emotesTag: string | null;
}

export interface TwitchIrcHandle {
  close: () => void;
}

export function connectTwitchIrc(channelName: string, onMessage: (msg: TwitchChatMessage) => void): TwitchIrcHandle {
  let ws: WebSocket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let dead = false;

  function connect() {
    if (dead) return;
    const nick = `justinfan${Math.floor(Math.random() * 89999) + 10000}`;
    const channel = `#${channelName.toLowerCase()}`;
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    ws.on('open', () => {
      ws?.send('CAP REQ :twitch.tv/commands twitch.tv/tags');
      ws?.send(`NICK ${nick}`);
      ws?.send(`JOIN ${channel}`);
      console.log(`[twitch irc] joined ${channel}`);
    });

    ws.on('message', (data) => {
      const lines = data.toString().split('\r\n');
      for (const raw of lines) {
        if (!raw) continue;
        if (raw.startsWith('PING')) { ws?.send(raw.replace('PING', 'PONG')); continue; }

        const m = raw.match(/^(?:@([^\s]*) )?:([^!]+)![^ ]+ PRIVMSG #\S+ :(.*)$/);
        if (!m) continue;
        const [, tagsStr, rawNick, content] = m;
        const text = content.trimEnd();

        const tags: Record<string, string> = {};
        if (tagsStr) tagsStr.split(';').forEach((t) => {
          const eq = t.indexOf('=');
          if (eq > -1) tags[t.slice(0, eq)] = t.slice(eq + 1);
        });

        const badgesRaw = tags['badges'] || '';
        const badges = badgesRaw
          ? badgesRaw.split(',').map((b) => { const [type, count] = b.split('/'); return { type, count: parseInt(count, 10) || 0 }; })
          : [];

        onMessage({
          id: tags['id'] ? `tw-${tags['id']}` : `tw-${Date.now()}-${Math.random()}`,
          username: tags['display-name'] || rawNick,
          content: text,
          color: tags['color'] || null,
          badges,
          createdAt: new Date().toISOString(),
          emotesTag: tags['emotes'] || null,
        });
      }
    });

    ws.on('close', () => {
      ws = null;
      if (!dead) timer = setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
      console.error('[twitch irc] error', err.message);
      ws?.close();
    });
  }

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
