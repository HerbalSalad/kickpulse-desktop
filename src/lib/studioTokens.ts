// src/lib/studioTokens.ts — Alert Studio's own event metadata + real-time
// matching, ported from the website's useAlertStudio.ts (STUDIO_KINDS/
// AMOUNT_BASED_KINDS/resolveSceneForKindAmount/extractStudioAmount/
// eventTextFor/eventVerbFor) and AlertStudioWidget.tsx's own handleWsEvent
// switch (the raw Kick/Twitch event → StudioEventType mapping). Trimmed the
// same documented way sceneTypes.ts/SceneElements.tsx already are: no
// YouTube, no general/pulseReward (Alert Studio itself is Kick+Twitch only
// on the website too — "lets just do twitch and kick support for this
// one"), and no per-kind color/variable metadata beyond what a notification/
// test-fire UI actually needs (label/emoji/testPayload).
import type { AlertScene } from './sceneTypes';

export type StudioEventType =
  | 'kickFollow' | 'kickSub' | 'kickResub' | 'kickGift' | 'kickKicks' | 'kickHost' | 'kickReward' | 'kickBan'
  | 'twitchFollow' | 'twitchSub' | 'twitchResub' | 'twitchGift' | 'twitchCheer' | 'twitchHost';

export interface StudioKindDef {
  id: StudioEventType;
  label: string;
  emoji: string;
  testPayload: Record<string, any>;
}

export const STUDIO_KINDS: StudioKindDef[] = [
  { id: 'kickFollow',    label: 'Follow (Kick)',       emoji: '➕', testPayload: { username: 'NewFollower99' } },
  { id: 'kickSub',       label: 'Sub (Kick)',          emoji: '⭐', testPayload: { username: 'CoolSubscriber', months: 1 } },
  { id: 'kickResub',     label: 'Resub (Kick)',        emoji: '🔁', testPayload: { username: 'LoyalViewer', months: 6 } },
  { id: 'kickGift',      label: 'Gift Subs (Kick)',    emoji: '🎁', testPayload: { username: 'BigGifter', amount: 3, giftees: ['a', 'b', 'c'] } },
  { id: 'kickKicks',     label: 'Kicks Gifted',        emoji: '👢', testPayload: { username: 'KickMaster', amount: 250 } },
  { id: 'kickHost',      label: 'Host/Raid (Kick)',    emoji: '📡', testPayload: { username: 'FriendlyStreamer', viewers: 42 } },
  { id: 'kickReward',    label: 'Reward Redeemed',     emoji: '🎟️', testPayload: { username: 'PointsSpender', reward_title: 'Test Reward' } },
  { id: 'kickBan',       label: 'Ban (Kick)',          emoji: '🔨', testPayload: { username: 'Troublemaker' } },
  { id: 'twitchFollow',  label: 'Follow (Twitch)',     emoji: '➕', testPayload: { username: 'NewFollower99' } },
  { id: 'twitchSub',     label: 'Sub (Twitch)',        emoji: '⭐', testPayload: { username: 'CoolSubscriber', months: 1 } },
  { id: 'twitchResub',   label: 'Resub (Twitch)',      emoji: '🔁', testPayload: { username: 'LoyalViewer', months: 6 } },
  { id: 'twitchGift',    label: 'Gift Subs (Twitch)',  emoji: '🎁', testPayload: { username: 'BigGifter', amount: 3 } },
  { id: 'twitchCheer',   label: 'Cheer (Twitch)',      emoji: '💎', testPayload: { username: 'BitsDonor', amount: 500 } },
  { id: 'twitchHost',    label: 'Raid (Twitch)',       emoji: '📡', testPayload: { username: 'FriendlyStreamer', viewers: 42 } },
];

export function studioKindDef(kind: string): StudioKindDef {
  return STUDIO_KINDS.find((k) => k.id === kind) || STUDIO_KINDS[0];
}

export function studioPlatformOf(kind: string): 'kick' | 'twitch' {
  return kind.startsWith('twitch') ? 'twitch' : 'kick';
}

export const AMOUNT_BASED_KINDS: StudioEventType[] = ['kickKicks', 'twitchCheer', 'kickGift', 'twitchGift'];
export function isAmountBasedKind(kind: string): boolean {
  return (AMOUNT_BASED_KINDS as string[]).includes(kind);
}

export function extractStudioAmount(kind: string, payload: Record<string, any>): number {
  const giftees = payload.giftees || payload.gifted_usernames || [];
  let amount = payload.amount ?? payload.bits ?? payload.gift?.amount ?? payload.gift_count ?? 1;
  if (kind === 'kickGift' || kind === 'twitchGift') amount = giftees.length || amount;
  return amount;
}

// Same "highest minAmount that's <= amount, else the base tier" algorithm
// the website's own resolveSceneForKindAmount uses — works uniformly for a
// non-amount kind too (at most one scene will ever list that kind, with an
// unset/0 minAmount, which is always <= any amount).
export function resolveSceneForKindAmount(scenes: AlertScene[], kind: string, amount: number): AlertScene | null {
  const candidates = scenes.filter((s) => s.kinds.includes(kind));
  if (candidates.length === 0) return null;
  let best: AlertScene | null = null;
  for (const s of candidates) {
    const min = s.minAmount || 0;
    if (amount >= min) {
      if (!best || min > (best.minAmount || 0)) best = s;
    }
  }
  return best || candidates.reduce((lo, s) => ((s.minAmount || 0) < (lo.minAmount || 0) ? s : lo), candidates[0]);
}

function eventTextFor(kind: string, o: { months: number; amount: number; amountText: string; viewers: number; reward: string }): string {
  switch (kind) {
    case 'kickFollow': case 'twitchFollow': return 'followed';
    case 'kickSub':    case 'twitchSub':    return 'subscribed';
    case 'kickResub':  case 'twitchResub':  return `resubscribed — ${o.months} months`;
    case 'kickGift':   case 'twitchGift':   return `gifted ${o.amount} ${o.amountText}`;
    case 'kickKicks':                       return `sent ${o.amount} ${o.amountText}`;
    case 'twitchCheer':                     return `cheered ${o.amount} ${o.amountText}`;
    case 'kickHost':   case 'twitchHost':   return `raided with ${o.viewers} viewers`;
    case 'kickReward':                      return `redeemed ${o.reward}`;
    case 'kickBan':                         return 'was banned';
    default:                                return 'showed up';
  }
}

function eventVerbFor(kind: string): string {
  switch (kind) {
    case 'kickFollow': case 'twitchFollow': return 'followed';
    case 'kickSub':    case 'twitchSub':    return 'subscribed';
    case 'kickResub':  case 'twitchResub':  return 'resubscribed';
    case 'kickGift':   case 'twitchGift':   return 'gifted';
    case 'kickKicks':                       return 'sent';
    case 'twitchCheer':                     return 'cheered';
    case 'kickHost':   case 'twitchHost':   return 'raided';
    case 'kickReward':                      return 'redeemed';
    case 'kickBan':                         return 'was banned';
    default:                                return 'showed up';
  }
}

// Resolves every token an Alert Studio scene's text/counter elements can
// reference, including the 5 that overlap with Pulse Scenes' own flat
// vocabulary (username/amount/viewers/reward/months) — this return shape is
// handed straight to sceneTokens.ts's buildSceneText/resolveSceneCounterTarget
// via SceneFirePayload.extraTokens (for the TEXT-only extras — eventText/
// eventVerb/amountText/subType) plus the plain fields (username/amount/
// viewers/reward/months), so the EXACT SAME render path already built for
// Pulse Scenes (SceneElementView/CounterElementView) renders an Alert
// Studio scene correctly with zero rendering code of its own.
export function resolveStudioPayload(kind: string, raw: Record<string, any>): {
  username: string; amount: number; viewers: number; months: number; reward: string; extraTokens: Record<string, string>;
} {
  const username = raw.username || 'Someone';
  const viewers = raw.viewers ?? raw.number_viewers ?? raw.viewer_count ?? 0;
  const months = raw.months ?? raw.duration ?? 0;
  const amount = extractStudioAmount(kind, raw);
  const reward = raw.reward_title || raw.reward?.title || 'Reward';
  const amountText = kind === 'kickKicks' ? (amount === 1 ? 'Kick' : 'Kicks')
    : kind === 'twitchCheer' ? (amount === 1 ? 'bit' : 'bits')
    : (amount === 1 ? 'sub' : 'subs');
  const subType = months >= 2 ? `${months}-month resub` : 'subscribed';
  return {
    username, amount, viewers, months, reward,
    extraTokens: {
      '{amountText}': amountText,
      '{subType}':    subType,
      '{eventText}':  eventTextFor(kind, { months, amount, amountText, viewers, reward }),
      '{eventVerb}':  eventVerbFor(kind),
    },
  };
}

// ─── Raw event → kind, trimmed mirror of AlertStudioWidget.tsx's own
// handleWsEvent switch — kept as its own copy for the identical reason that
// file's own comment gives: so this and any future website-side change to
// that mapping can never silently drift into each other's concerns without
// someone noticing both places need updating.
export function mapRawEventToStudioKind(eventName: string, payload: any): { kind: StudioEventType; raw: Record<string, any> } | null {
  switch (eventName) {
    case 'channel.followed':
      return { kind: 'kickFollow', raw: { username: payload.follower?.username } };
    case 'channel.subscription.new':
      return { kind: 'kickSub', raw: { username: payload.subscriber?.username, months: payload.duration || 1 } };
    case 'channel.subscription.renewal':
      return { kind: 'kickResub', raw: { username: payload.subscriber?.username, months: payload.duration || 1 } };
    case 'channel.subscription.gifts':
      return {
        kind: 'kickGift',
        raw: {
          username: payload.gifter?.username || 'Anonymous',
          giftees: payload.giftees?.map((g: any) => g.username) || [],
          amount: payload.giftees?.length || 0,
        },
      };
    case 'kicks.gifted':
      return { kind: 'kickKicks', raw: { username: payload.sender?.username, amount: payload.gift?.amount || payload.amount || 1 } };
    case 'channel.host':
      return { kind: 'kickHost', raw: { username: payload.host_username, viewers: payload.number_viewers || 0 } };
    case 'channel.reward.redemption.updated':
      if (payload.status !== 'accepted') return null;
      return { kind: 'kickReward', raw: { username: payload.redeemer?.username, reward_title: payload.reward?.title } };
    case 'moderation.banned':
      return { kind: 'kickBan', raw: { username: payload.banned_user?.username } };
    case 'channel.follow':
      return { kind: 'twitchFollow', raw: { username: payload.user_name || payload.user_login } };
    case 'channel.subscribe':
      if (payload.is_gift) return null;
      return { kind: 'twitchSub', raw: { username: payload.user_name || payload.user_login, months: payload.duration_months || 1 } };
    case 'channel.subscription.message':
      return { kind: 'twitchResub', raw: { username: payload.user_name || payload.user_login, months: payload.cumulative_months || payload.duration_months || 1 } };
    case 'channel.subscription.gift':
      return { kind: 'twitchGift', raw: { username: payload.user_name || payload.user_login || 'Anonymous', amount: payload.total || 1, giftees: [] } };
    case 'channel.raid':
      return { kind: 'twitchHost', raw: { username: payload.from_broadcaster_user_name || payload.from_broadcaster_user_login, viewers: payload.viewers || 0 } };
    case 'channel.cheer':
      return { kind: 'twitchCheer', raw: { username: payload.user_name || payload.user_login || 'Anonymous', amount: payload.bits || 0 } };
    default:
      return null;
  }
}
