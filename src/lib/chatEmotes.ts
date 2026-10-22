// src/lib/chatEmotes.ts — renders raw chat content (Kick's inline
// [emote:id:name] tokens, Twitch's position-based `emotes` IRC tag) into
// real emote <img> tags for the Dashboard's chat feed. Ported from
// kickpulse-new's own src/hooks/useChatOverlay.ts (parseEmotes/
// parseTwitchEmotes) — same CDN URL patterns, same token format — rather
// than reinvented, since those are already proven against real Kick/Twitch
// traffic.
//
// Both renderers escape the PLAIN-TEXT portions of a message before this
// app ever hands the result to dangerouslySetInnerHTML — a chat message is
// untrusted input (anyone watching can type literal HTML/script into it),
// and nothing upstream of this file has sanitized it. Only the <img> tags
// this file itself constructs are ever allowed through unescaped.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Kick: emotes are plain inline tokens already inside `content` — a regex
// substitution is immune to the character-offset-shifting problem escaping
// would otherwise cause (see renderTwitchContent's own comment below),
// since it doesn't rely on positions at all.
export function renderKickContent(content: string, size = 20): string {
  return escapeHtml(content).replace(
    /\[emote:(\d+):([^\]]+)\]/g,
    (_m, id, name) =>
      `<img src="https://files.kick.com/emotes/${id}/fullsize" alt="${name}" title="${name}" style="height:${size}px;width:auto;display:inline;vertical-align:middle;margin:0 1px;" />`,
  );
}

// Twitch: the `emotes` IRC tag gives emote positions as character offsets
// into the ORIGINAL, unescaped message ("id:start-end,start-end/id2:...").
// Escaping the whole string first would shift every offset after the first
// `&`/`<`/etc. (one raw char becoming a multi-char HTML entity) and corrupt
// the splice — so this escapes each PLAIN-TEXT segment individually, after
// slicing the raw string at its real positions, never the <img> tags it
// inserts itself.
export function renderTwitchContent(content: string, emotesTag: string | null | undefined, size = 20): string {
  if (!emotesTag) return escapeHtml(content);
  const replacements: { start: number; end: number; id: string }[] = [];
  emotesTag.split('/').forEach((entry) => {
    const [id, positions] = entry.split(':');
    if (!positions) return;
    positions.split(',').forEach((range) => {
      const [s, e] = range.split('-').map(Number);
      if (!isNaN(s) && !isNaN(e)) replacements.push({ start: s, end: e, id });
    });
  });
  if (!replacements.length) return escapeHtml(content);
  replacements.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end, id } of replacements) {
    parts.push(escapeHtml(content.slice(cursor, start)));
    parts.push(
      `<img src="https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0" alt="" style="height:${size}px;width:auto;display:inline;vertical-align:middle;margin:0 1px;" loading="lazy" />`,
    );
    cursor = end + 1;
  }
  parts.push(escapeHtml(content.slice(cursor)));
  return parts.join('');
}

export function renderChatContent(msg: ChatFeedMessage, size = 20): string {
  if (msg.platform === 'twitch') return renderTwitchContent(msg.content, msg.emotesTag, size);
  if (msg.platform === 'kick') return renderKickContent(msg.content, size);
  // YouTube/TikTok — no documented inline emote-token format in either
  // lib/youtubeLive.js's or lib/tiktokLive.js's own chat payload (TikTok's
  // own `emotes` field isn't even rendered into `content` yet there, see
  // that file's own comment on the leading theory for its "blank message"
  // reports) — plain escaped text until there's a real format to parse.
  return escapeHtml(msg.content);
}
