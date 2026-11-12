// electron/kick-emotes.ts — Kick's own public, unauthenticated emote
// catalog (https://kick.com/emotes/<slug>) for the Live Chat reply box's
// emote picker (2026-11-11, direct request: "we fetch the emotes really
// well with the chat bot, global, emojis and the users own emotes are all
// available"). Same real endpoint the website's own
// src/lib/emoteUtils.ts/src/components/pulsewatch/ChatWindowPanel.tsx
// already fetch directly from the browser — ported here as a plain Node
// fetch since it needs no auth and no server round trip at all.
//
// Response shape (confirmed against those two real, working callers, not
// guessed): an array of sections, each { name, emotes: [{id, name}] } — one
// section per sub-emote-set Kick groups a channel's own emotes into (varies
// per channel), plus always a "Global" section and an "Emojis" section.

export interface KickEmoteInfo {
  id: string;
  name: string;
}

export interface KickEmoteCatalog {
  channelEmotes: KickEmoteInfo[];
  globalEmotes: KickEmoteInfo[];
  emojis: KickEmoteInfo[];
}

const EMPTY: KickEmoteCatalog = { channelEmotes: [], globalEmotes: [], emojis: [] };

// Per-slug cache, same shape as the website's own module-level cache — this
// app only ever has ONE connected Kick channel (the streamer's own) at a
// time, so there's nothing to invalidate across different channels the way
// PulseWatch's multi-stream cache has to handle.
const cache = new Map<string, KickEmoteCatalog>();

export async function getKickEmotes(slug: string): Promise<KickEmoteCatalog> {
  const key = slug.trim().toLowerCase();
  if (!key) return EMPTY;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(`https://kick.com/emotes/${encodeURIComponent(key)}`);
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as any;
    if (!Array.isArray(data)) return EMPTY;

    const channelSection = data.find((s) => s?.name !== 'Global' && s?.name !== 'Emojis');
    const globalSection = data.find((s) => s?.name === 'Global');
    const emojiSection = data.find((s) => s?.name === 'Emojis');

    const catalog: KickEmoteCatalog = {
      channelEmotes: channelSection?.emotes ?? [],
      globalEmotes: globalSection?.emotes ?? [],
      emojis: emojiSection?.emotes ?? [],
    };
    cache.set(key, catalog);
    return catalog;
  } catch {
    return EMPTY;
  }
}
