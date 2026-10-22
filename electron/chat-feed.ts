// electron/chat-feed.ts — rolling in-memory history for the Live Chat &
// Event Feed page (src/pages/LiveChatPage.tsx). main.ts pushes every chat
// message / stream event it already receives (Kick's `chat.message.sent`
// and the other real webhook events over the WS hub, Twitch chat over its
// own IRC connection — see twitch-irc.ts) into this buffer AND forwards it
// live to the renderer over IPC; the renderer also pulls the buffer once on
// mount ('chat-feed:get-recent') so opening the page late still shows
// recent history, not just whatever arrives from that point on.
//
// In-memory only, lost on restart — same accepted limitation every other
// in-memory desktop-app state already has (jumpscare/scenes config
// snapshots, OBS scene lists reported up to the website, etc. — see
// main.ts's own connectAccount comment).

export type FeedPlatform = 'kick' | 'twitch' | 'youtube' | 'tiktok';

export interface ChatFeedMessage {
  id: string;
  platform: FeedPlatform;
  username: string;
  content: string;
  color: string | null;
  badges: { type: string; count?: number }[];
  createdAt: string;
  // emotesTag — Twitch only (its raw IRC `emotes` tag, see twitch-irc.ts);
  // Kick emotes arrive as inline [emote:id:name] tokens already inside
  // `content` and need no extra field. The renderer (src/lib/chatEmotes.ts)
  // does the actual rendering either way.
  emotesTag?: string | null;
}

export interface EventFeedItem {
  id: string;
  platform: FeedPlatform;
  eventType: string;
  summary: string;
  createdAt: string;
}

const CHAT_CAP = 300;
const EVENT_CAP = 200;

const chatBuffer: ChatFeedMessage[] = [];
const eventBuffer: EventFeedItem[] = [];

export function pushChatMessage(msg: ChatFeedMessage): void {
  chatBuffer.push(msg);
  if (chatBuffer.length > CHAT_CAP) chatBuffer.shift();
}

export function pushEvent(evt: EventFeedItem): void {
  eventBuffer.push(evt);
  if (eventBuffer.length > EVENT_CAP) eventBuffer.shift();
}

export function getRecentChat(): ChatFeedMessage[] { return chatBuffer.slice(); }
export function getRecentEvents(): EventFeedItem[] { return eventBuffer.slice(); }

// Cleared on disconnect/API-key-swap (config:disconnect, config:save-api-key
// in main.ts) — an old account's chat/events have no business lingering
// into a newly-connected one.
export function clearAll(): void {
  chatBuffer.length = 0;
  eventBuffer.length = 0;
}

// ── Human-readable one-line summaries ───────────────────────────────────────
// Built from the exact payload shapes documented in kickpulse-new's
// src/lib/kickWebhookEvents.ts (Kick) and its Twitch EventSub subscription
// list (server.js) — not guessed. Anything not explicitly listed here (a
// future event type, or one of this app's own internal desktop-control
// signals like obs.*/light.*/scenes.play, which main.ts already intercepts
// before ever reaching this function) falls through to a plain, honest
// "eventType fired" line instead of silently dropping it.

// Explicit ALLOWLIST, not a blocklist (2026-10-19 fix — direct report:
// "nowplaying.update fired... 143 [times]... Surely there is no reason for
// a process like that to be running in the background all the time").
// nowPlaying.update is real, legitimate traffic — the Song Requests
// dashboard page polls Spotify every ~5s and broadcasts it to feed the
// real Now Playing OBS widget, same WS channel this app's own
// jumpscare/scenes triggers arrive on — but it's state-sync telemetry, not
// a "something happened" event, and the server broadcasts a LOT of other
// per-widget control signals the exact same way (spinWheel.*, nameRoller.*,
// timer.*, credits.roll, progressRing.*, etc. — see server.js's own list of
// every `kickEvent` name it ever sends). The original design treated
// "anything not already handled above" as a real event worth showing,
// which is exactly backwards: it means ANY of those frequent widget
// broadcasts would flood this feed too, not just nowPlaying. Only
// explicitly-recognized real Kick/Twitch webhook events (the same ones
// summarizeKickEvent/summarizeTwitchEvent below have named cases for) ever
// reach the Event Feed now; everything else is silently ignored, not
// logged with a generic fallback line.
// Includes youtube.member/giftedMember/superchat/gift (2026-10-20) — these
// arrive over the exact same generic `{type:'kickEvent', event, payload}`
// envelope Kick's own events use (see lib/youtubeLive.js's own
// broadcastYoutubeAlert — it's not Kick-specific, just this app's one
// shared WS relay shape), so they belong in this same allowlist despite
// the constant's name. youtube.chatMessage/tiktok.chatMessage are handled
// as chat, not events — see main.ts's own early-return branches for those,
// same shape as chat.message.sent.
export const KNOWN_KICK_EVENT_TYPES = new Set([
  'channel.followed', 'channel.subscription.new', 'channel.subscription.renewal',
  'channel.subscription.gifts', 'kicks.gifted', 'channel.reward.redemption.updated',
  'moderation.banned', 'livestream.status.updated', 'livestream.metadata.updated',
  'channel.host', 'youtube.member', 'youtube.giftedMember', 'youtube.superchat', 'youtube.gift',
]);
export const KNOWN_TWITCH_EVENT_TYPES = new Set([
  'channel.follow', 'channel.subscribe', 'channel.subscription.gift', 'channel.subscription.message',
  'channel.cheer', 'channel.raid', 'channel.channel_points_custom_reward_redemption.add',
]);

export function summarizeKickEvent(eventType: string, payload: any): string {
  switch (eventType) {
    case 'channel.followed':
      return `${payload?.follower?.username ?? 'Someone'} followed`;
    case 'channel.subscription.new':
      return `${payload?.subscriber?.username ?? 'Someone'} subscribed`;
    case 'channel.subscription.renewal':
      return `${payload?.subscriber?.username ?? 'Someone'} resubscribed (${payload?.duration ?? '?'} mo)`;
    case 'channel.subscription.gifts': {
      const count = payload?.giftees?.length ?? 0;
      return `${payload?.gifter?.username ?? 'Someone'} gifted ${count} sub${count === 1 ? '' : 's'}`;
    }
    case 'kicks.gifted':
      return `${payload?.sender?.username ?? 'Someone'} gifted ${payload?.gift?.amount ?? '?'} ${payload?.gift?.name ?? 'Kicks'}`;
    case 'channel.reward.redemption.updated':
      return `${payload?.redeemer?.username ?? 'Someone'} redeemed "${payload?.reward?.title ?? 'a reward'}"`;
    case 'moderation.banned': {
      const action = payload?.metadata?.expires_at ? 'timed out' : 'banned';
      return `${payload?.moderator?.username ?? 'A mod'} ${action} ${payload?.banned_user?.username ?? 'a viewer'}`;
    }
    case 'livestream.status.updated':
      return payload?.is_live ? 'Stream went live' : 'Stream went offline';
    case 'livestream.metadata.updated':
      return `Stream info updated${payload?.metadata?.category?.name ? ` — ${payload.metadata.category.name}` : ''}`;
    case 'youtube.member':
      return `${payload?.username ?? 'Someone'} became a member${payload?.memberLevel ? ` (${payload.memberLevel})` : ''}`;
    case 'youtube.giftedMember':
      return `${payload?.username ?? 'Someone'} gifted ${payload?.amount ?? '?'} membership${payload?.amount === 1 ? '' : 's'}`;
    case 'youtube.superchat':
      return `${payload?.username ?? 'Someone'} sent a Super Chat${payload?.amountDisplay ? ` (${payload.amountDisplay})` : ''}`;
    case 'youtube.gift':
      return `${payload?.username ?? 'Someone'} sent a gift${payload?.giftName ? ` — ${payload.giftName}` : ''}`;
    default:
      return `${eventType} fired`;
  }
}

export function summarizeTwitchEvent(eventType: string, payload: any): string {
  switch (eventType) {
    case 'channel.follow':
      return `${payload?.user_name ?? 'Someone'} followed`;
    case 'channel.subscribe':
      return `${payload?.user_name ?? 'Someone'} subscribed${payload?.is_gift ? ' (gifted)' : ''}`;
    case 'channel.subscription.gift':
      return `${payload?.is_anonymous ? 'Someone' : (payload?.user_name ?? 'Someone')} gifted ${payload?.total ?? '?'} sub${payload?.total === 1 ? '' : 's'}`;
    case 'channel.subscription.message':
      return `${payload?.user_name ?? 'Someone'} resubscribed (${payload?.cumulative_months ?? '?'} mo)`;
    case 'channel.cheer':
      return `${payload?.is_anonymous ? 'Someone' : (payload?.user_name ?? 'Someone')} cheered ${payload?.bits ?? '?'} bits`;
    case 'channel.raid':
      return `${payload?.from_broadcaster_user_name ?? 'Someone'} raided with ${payload?.viewers ?? '?'} viewers`;
    case 'channel.channel_points_custom_reward_redemption.add':
      return `${payload?.user_name ?? 'Someone'} redeemed "${payload?.reward?.title ?? 'a reward'}"`;
    default:
      return `${eventType} fired`;
  }
}
