// src/pages/DashboardPage.tsx — the app's default landing page (2026-10-19,
// direct feedback replacing the first version of this, LiveChatPage.tsx:
// "I want it to be more of a live dashboard and it should be at the top
// (it should honestly be the default page)... kind of intended events and
// message to be able to both be seen, we shouldnt have to switch tabs to
// see the events"). Status strip (account/connection) on top, then Chat
// and the Event Feed side by side, both always visible — no tabs.
//
// Merged Kick + Twitch chat (Kick arrives over the existing WS hub
// connection every jumpscare/scene trigger already uses — see
// electron/main.ts's handleWsMessage; Twitch needs its own IRC connection,
// see electron/twitch-irc.ts) plus every real stream event this app
// previously just silently ignored (follow/sub/gift/kicks/reward/ban/live-
// status — see chat-feed.ts's KNOWN_KICK_EVENT_TYPES/KNOWN_TWITCH_EVENT_TYPES
// for the exact allowlist; frequent widget-control broadcasts like
// nowPlaying.update/spinWheel.*/timer.* are deliberately excluded, see that
// file's own comment on the spam incident this fixes).
//
// The warning badge next to a chatter's name is the real payoff of the
// Community Bans/Viewer Flags work on the website: a batched lookup
// (window.kickpulseDesktop.chatFeed.getViewerInfo) answers "has this
// account been banned elsewhere, or flagged for something?" for whoever's
// actively chatting, filtered by the streamer's own configured sensitivity
// (/community-bans page's Threat Warnings setting).
import { useEffect, useRef, useState, useCallback } from 'react';
import { LayoutDashboard, ShieldAlert, Flag, ArrowDown, Reply, X, Smile, Send, Clock, Ban, Trash2 } from 'lucide-react';
import { Page, Section, COLORS, Button } from '../components/ui';
import { renderChatContent, renderDraftWithEmotes, extractDraftContent } from '../lib/chatEmotes';
import { renderBadgesHtml, renderTwitchBadgesHtml, type SubscriberBadgeDef } from '../lib/kickBadges';
import { useStickToBottom } from '../hooks/useStickToBottom';
import EmotePicker, { type PickedEmote } from '../components/EmotePicker';

const PLATFORM_COLOR: Record<string, string> = { kick: '#53fc18', twitch: '#9146ff', youtube: '#ff0000', tiktok: '#ff0050' };

// Platform icons for the Chat panel (2026-10-27, direct request: "platform
// icon would be cool too") — replaces the plain colored dot with each
// platform's own real logo mark, same source paths as the website's own
// ChatHistory.tsx (kick/twitch) plus YouTube/TikTok since this feed, unlike
// that page, already carries all four.
// Sized and positioned identically to the badge icons right next to it
// (2026-10-28, direct feedback: "platform icon should be the same size as
// badges") — was 11x11 with no vertical-align set, while every badge
// (kickBadges.ts's renderBadgeHtml) renders at 16x16 with
// display:inline-block + vertical-align:middle. Mixing a bare, differently-
// sized, differently-aligned <svg> into the same `align-items: baseline`
// row as those is exactly the kind of mismatch that throws off a line's
// layout — matched here instead of guessed at.
function PlatformIcon({ platform }: { platform: FeedPlatform }) {
  const color = PLATFORM_COLOR[platform];
  const common = { width: 16, height: 16, style: { flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' } } as const;
  switch (platform) {
    case 'kick':
      return <svg {...common} viewBox="0 0 24 24" fill={color}><path d="M0 0H9V5.34H12V2.67H15V0H24V8.01H21V10.67H18V13.34H21V16.01H24V24H15V21.34H12V18.68H9V24H0Z" /></svg>;
    case 'twitch':
      return <svg {...common} viewBox="0 0 24 24" fill={color}><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>;
    case 'youtube':
      return <svg {...common} viewBox="0 0 24 24" fill={color}><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.5 15.6V8.4L15.8 12Z" /></svg>;
    case 'tiktok':
      return <svg {...common} viewBox="0 0 24 24" fill={color}><path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 15.54 3h-3.09v12.4a2.592 2.592 0 1 1-1.83-2.49V9.68a5.712 5.712 0 1 0 4.92 5.66V9.1a7.17 7.17 0 0 0 4.17 1.33V7.32a4.28 4.28 0 0 1-3.11-1.5Z" /></svg>;
    default:
      return null;
  }
}

// Short HH:MM, matching the Event Feed panel's own timestamp format below
// (toLocaleTimeString) minus seconds — chat rows are denser, so a compact
// time reads better here.
function formatChatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

const FLAG_CATEGORY_LABELS: Record<string, string> = {
  suspicious: 'Suspicious', harassment: 'Harassment/Bullying', hate_speech: 'Hate Speech/Slurs',
  spam: 'Spam', self_promo: 'Self Promo', ban_evasion: 'Ban Evasion', bot_viewbot: 'Bot/Viewbot',
  nsfw: 'NSFW', doxxing: 'Doxxing', threats: 'Threats', other: 'Other',
};

function ViewerBadge({ info }: { info: ViewerInfo | undefined }) {
  if (!info) return null;
  const parts: string[] = [];
  if (info.threat.level > 0) parts.push(info.threat.label);
  for (const f of info.flags) parts.push(FLAG_CATEGORY_LABELS[f.category] || f.category);
  if (!parts.length) return null;
  return (
    <span
      title={info.flags.map(f => f.reason ? `${FLAG_CATEGORY_LABELS[f.category] || f.category}: ${f.reason}` : (FLAG_CATEGORY_LABELS[f.category] || f.category)).join(' · ') || info.threat.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700,
        padding: '1px 6px', borderRadius: 999, background: 'rgba(239,68,68,0.18)', color: '#fca5a5',
        border: '1px solid rgba(239,68,68,0.35)', marginLeft: 6, verticalAlign: 'middle', flexShrink: 0,
      }}
    >
      <ShieldAlert size={10} /> {parts[0]}{parts.length > 1 ? ` +${parts.length - 1}` : ''}
    </span>
  );
}

// Shown only once the user has scrolled away from the bottom on purpose
// (useStickToBottom's isStuck goes false) — otherwise it never appears at
// all, so normal "always following the latest message" behavior has zero
// extra UI most of the time, same as the feed never needed a button before.
function JumpToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600,
        background: COLORS.accent, color: '#fff', border: 'none', borderRadius: 999, cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
      }}
    >
      <ArrowDown size={13} /> Jump to latest
    </button>
  );
}

// Per-message Reply/Timeout/Ban/Delete icons (2026-11-13, direct request:
// "small icons at the far right of the messages, same line") — sitting
// right after the message text span, which is `flex: 1` (see the row's own
// JSX), so this cluster naturally lands at the row's true right edge
// regardless of how short or long the message/username is.
function RowIconButton({ children, onClick, title, disabled, danger }: {
  children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 20, height: 20, padding: 0, border: 'none', background: 'none',
        color: danger ? '#f87171' : COLORS.textFaint, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function DashboardPage() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [messages, setMessages] = useState<ChatFeedMessage[]>([]);
  const [events, setEvents] = useState<EventFeedItem[]>([]);
  const [viewerInfo, setViewerInfo] = useState<Record<string, ViewerInfo>>({});
  const [minThreatLevel, setMinThreatLevel] = useState(2);
  const [subscriberBadges, setSubscriberBadges] = useState<SubscriberBadgeDef[]>([]);
  const chatStick = useStickToBottom<HTMLDivElement>([messages]);
  const eventStick = useStickToBottom<HTMLDivElement>([events]);
  const knownUsernames = useRef<Set<string>>(new Set());

  // Reply box (2026-11-11, direct request: "users would like to be able to
  // actually reply to their chats") — replyTarget locks the composer to
  // whichever platform a specific message came from and threads the reply
  // natively (reply_to_message_id/reply_parent_message_id — both platforms
  // support it) — a reply, by definition, can only thread on the one
  // platform the original message came from, so 'both' is never an option
  // once replyTarget is set. With no reply target, draftPlatform picks
  // between whatever platforms are actually connected for a fresh,
  // unthreaded message — including 'both' at once (2026-11-13, direct
  // request: "some users might want to send a[n] [announcement] to
  // viewers on both platforms").
  const [replyTarget, setReplyTarget] = useState<{ platform: 'kick' | 'twitch'; id: string; username: string } | null>(null);
  const [draftPlatform, setDraftPlatform] = useState<'kick' | 'twitch' | 'both'>('kick');
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emotePickerOpen, setEmotePickerOpen] = useState(false);
  const emoteButtonRef = useRef<HTMLButtonElement>(null);

  // Quick-moderation icons (2026-11-13, direct request: "it could also be
  // useful to have a timeout, ban, or delete message option on the
  // messages... small icons at the far right") — busyAction tracks exactly
  // one message+action in flight at a time (keyed "<id>:<action>") so a
  // double-click can't fire the same action twice; a real network round
  // trip per click is unavoidable since these are real moderation calls
  // (not an optimistic local toggle like, say, a Toggle switch would be).
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Rich draft editor (2026-11-12, direct request: "when adding emotes to
  // the message, I would prefer they actually show as the emotes there
  // too") — a contentEditable div, not a plain textarea, so a picked emote
  // renders as the real <img> while composing (see chatEmotes.ts's
  // renderDraftWithEmotes/extractDraftContent). draftText stays the single
  // source of truth (the raw [emote:]/[temote:] token string actually sent)
  // — lastEmittedRef distinguishes "the DOM just echoed back what I typed"
  // (don't re-seed, which would reset the cursor) from "draftText changed
  // for some other reason" (clearing after send, switching reply target —
  // DOES need a re-seed), same pattern the website's own
  // EmoteMessageEditor.tsx already uses for this exact problem.
  const draftRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedRef = useRef<string | null>(null);

  // Defaults to whichever platform is actually connected once status loads
  // — only matters for a FRESH (non-reply) message; a reply always locks to
  // whichever platform the message being replied to came from instead.
  useEffect(() => {
    if (status?.me?.kickConnected) setDraftPlatform('kick');
    else if (status?.me?.twitchConnected) setDraftPlatform('twitch');
  }, [status?.me?.kickConnected, status?.me?.twitchConnected]);

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then((s) => {
      setStatus(s);
      // Channel-specific subscriber badge tiers (2026-10-20, direct request:
      // "would also be cool to see badges in the desktop dashboard chat") —
      // same public, no-auth endpoint Chat Overlay/Scrolling Chat/PulseWatch
      // use on the website, for THIS streamer's own Kick channel.
      if (s.me?.kickConnected && s.me.username) {
        window.kickpulseDesktop.chatFeed.getKickSubscriberBadges(s.me.username)
          .then((r) => setSubscriberBadges(r.badges || []))
          .catch(() => {});
      }
    });
    window.kickpulseDesktop.onStatus(setStatus);

    window.kickpulseDesktop.chatFeed.getRecent().then(({ chat, events }) => {
      setMessages(chat);
      setEvents(events);
    });
    window.kickpulseDesktop.chatFeed.getThreatSettings().then(s => setMinThreatLevel(s.minThreatLevelToWarn)).catch(() => {});

    window.kickpulseDesktop.chatFeed.onMessage((msg) => {
      setMessages(prev => [...prev, msg].slice(-300));
    });
    // Kick message deletion (2026-11-12) — a message deleted anywhere else
    // (auto-mod, another mod, Kick itself) now disappears from this feed
    // too, same as the website's Chat Dock/Chat Overlay widget.
    window.kickpulseDesktop.chatFeed.onMessageDeleted((id) => {
      setMessages(prev => prev.filter(m => m.id !== id));
    });
    window.kickpulseDesktop.chatFeed.onEvent((evt) => {
      setEvents(prev => [...prev, evt].slice(-200));
    });
  }, []);

  // Batched viewer-info lookup — refreshes whenever a genuinely NEW username
  // shows up in the visible chat, not on every single message. Kick/Twitch
  // only — Community Bans/Viewer Flags (routes/desktop.js's own
  // /viewer-info) don't track YouTube/TikTok usernames at all yet, so
  // those messages are skipped here entirely rather than querying under
  // the wrong platform.
  const refreshViewerInfo = useCallback(async () => {
    const byPlatform: Record<'kick' | 'twitch', string[]> = { kick: [], twitch: [] };
    for (const m of messages) {
      if (m.platform !== 'kick' && m.platform !== 'twitch') continue;
      const key = m.username.toLowerCase();
      if (knownUsernames.current.has(`${m.platform}:${key}`)) continue;
      byPlatform[m.platform].push(m.username);
    }
    for (const platform of ['kick', 'twitch'] as const) {
      const usernames = [...new Set(byPlatform[platform])];
      if (!usernames.length) continue;
      try {
        const info = await window.kickpulseDesktop.chatFeed.getViewerInfo(usernames, platform);
        setViewerInfo(prev => ({ ...prev, ...info }));
      } catch { /* non-fatal — badges just stay absent for this batch */ }
      for (const u of usernames) knownUsernames.current.add(`${platform}:${u.toLowerCase()}`);
    }
  }, [messages]);

  useEffect(() => {
    const id = setTimeout(refreshViewerInfo, 400); // debounce a burst of messages into one lookup
    return () => clearTimeout(id);
  }, [messages, refreshViewerInfo]);

  const shouldWarn = (info: ViewerInfo | undefined) => {
    if (!info) return false;
    if (info.flags.length > 0) return true; // any flag always shows, regardless of threat threshold
    return minThreatLevel > 0 && info.threat.level >= minThreatLevel;
  };

  const renderBadges = (m: ChatFeedMessage): string => {
    if (!m.badges?.length) return '';
    if (m.platform === 'twitch') return renderTwitchBadgesHtml(m.badges, 16);
    // Kick's own SVG badge set is reused for YouTube too (2026-10-20) —
    // lib/youtubeLive.js's own broadcastYoutubeAlert tags its badges with
    // the exact same type strings ('broadcaster'/'moderator'/'subscriber'),
    // so the same renderer just works. TikTok's badges array is always
    // empty right now (lib/tiktokLive.js doesn't populate it), so this is
    // effectively a no-op for tiktok messages until that changes.
    return renderBadgesHtml(m.badges, 16, subscriberBadges);
  };

  const me = status?.me;
  const canKick = !!me?.kickConnected;
  const canTwitch = !!me?.twitchConnected;
  const effectivePlatform = replyTarget?.platform ?? draftPlatform;

  // Re-seeds the editor's HTML only when draftText changed from OUTSIDE a
  // keystroke (cleared after send, reply target switched) — see this
  // component's own state-block comment on lastEmittedRef.
  useEffect(() => {
    if (!draftRef.current) return;
    if (lastEmittedRef.current === draftText) return;
    lastEmittedRef.current = draftText;
    draftRef.current.innerHTML = renderDraftWithEmotes(draftText);
  }, [draftText]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && draftRef.current?.contains(sel.anchorNode)) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  }, []);

  const emitDraftChange = useCallback(() => {
    if (!draftRef.current) return;
    const next = extractDraftContent(draftRef.current);
    lastEmittedRef.current = next;
    setDraftText(next);
  }, []);

  const insertEmote = useCallback((emote: PickedEmote) => {
    const el = draftRef.current;
    if (!el) return;
    el.focus();
    const img = document.createElement('img');
    img.src = emote.kind === 'kick' ? `https://files.kick.com/emotes/${emote.id}/fullsize` : (emote.url || `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/3.0`);
    img.alt = emote.name;
    img.className = 'inline-emote-token';
    img.setAttribute('data-emote-code', emote.kind === 'kick' ? `[emote:${emote.id}:${emote.name}]` : `[temote:${emote.id}:${emote.name}]`);
    img.style.cssText = 'height:20px;width:auto;vertical-align:middle;display:inline;margin:0 1px;';
    img.contentEditable = 'false';

    const sel = window.getSelection();
    const range = (() => {
      if (savedRangeRef.current) { try { if (el.contains(savedRangeRef.current.startContainer)) return savedRangeRef.current; } catch { /* stale range from before a re-seed */ } }
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); return r;
    })();
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.setEndAfter(img);
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRangeRef.current = range.cloneRange();
    emitDraftChange();
    // Deliberately stays open (2026-11-13, direct report: "some people
    // like to put multiple emotes in a row and having to open the emote
    // menu to do this each time is kind of wack") — only a real outside
    // click (EmotePicker's own handler) or Send closes it now.
  }, [emitDraftChange]);

  const platformLabel = (p: 'kick' | 'twitch') => (p === 'kick' ? 'Kick' : 'Twitch');

  const handleSend = async () => {
    const content = draftText.trim();
    if (!content || sending) return;
    // 'both' (2026-11-13, direct request: "some users might want to send
    // a[n announcement] to viewers on both platforms") fans out into one
    // send per platform — a reply (replyTarget set) is never 'both', since
    // a reply can only thread on the one platform the original message
    // came from.
    const targets: ('kick' | 'twitch')[] = effectivePlatform === 'both' ? ['kick', 'twitch'] : [effectivePlatform];

    // Proactive reauth check (2026-11-12) — a stale/under-scoped token
    // would otherwise fail at the server with a generic rejection; this
    // points straight at Connections instead of leaving someone to guess
    // why a reply just silently didn't send. A platform that needs
    // reconnecting is skipped rather than blocking the whole send when
    // 'both' is picked — the other platform still goes out.
    const blocked = targets.filter((p) => (p === 'kick' ? me?.kickNeedsReauth : me?.twitchNeedsReauth));
    const attempt = targets.filter((p) => !blocked.includes(p));
    if (attempt.length === 0) {
      setSendError(`Your ${blocked.map(platformLabel).join(' and ')} connection${blocked.length > 1 ? 's' : ''} need${blocked.length > 1 ? '' : 's'} to be reconnected — see the Connections tab.`);
      return;
    }

    setSending(true); setSendError(null);
    const results = await Promise.all(attempt.map((platform) =>
      window.kickpulseDesktop.chatFeed.send({ platform, content, replyToId: replyTarget?.id ?? null }).then((res) => ({ platform, ...res }))
    ));
    setSending(false);

    const failParts = [
      ...blocked.map((p) => `${platformLabel(p)} needs reconnecting`),
      ...results.filter((r) => !r.ok).map((r) => `${platformLabel(r.platform)}: ${r.error || 'failed'}`),
    ];
    if (failParts.length) setSendError(failParts.join(' · '));
    // Clear the draft once at least one target actually sent — a full
    // failure leaves it in place so there's something to retry/fix.
    if (results.some((r) => r.ok)) { setDraftText(''); setReplyTarget(null); setEmotePickerOpen(false); }
  };

  // 10 minutes — same default this app's own standalone Moderation page
  // already uses (ModerationPage.tsx's durationSeconds state), so a quick
  // one-click timeout here lands on the exact same duration a streamer
  // would get typing it in manually there. Confirmation deliberately
  // skipped (unlike quickBan below) — a timeout is short and trivially
  // undoable, which is exactly the "small icon, no friction" shape this was
  // asked for; a ban gets one because it's materially harder to walk back.
  const QUICK_TIMEOUT_SECONDS = 600;

  const quickTimeout = async (m: ChatFeedMessage) => {
    const key = `${m.id}:timeout`;
    if (busyAction) return;
    setBusyAction(key);
    const res = await window.kickpulseDesktop.moderation.action('timeout', {
      platform: m.platform, targetUsername: m.username, durationSeconds: QUICK_TIMEOUT_SECONDS, reason: 'Timed out from the Live Chat feed',
    }).catch((e: any) => ({ ok: false, error: e?.message }));
    setBusyAction(null);
    if (res?.error) alert(res.error);
  };

  const quickBan = async (m: ChatFeedMessage) => {
    const key = `${m.id}:ban`;
    if (busyAction) return;
    if (!confirm(`Ban ${m.username} on ${platformLabel(m.platform as 'kick' | 'twitch')}?`)) return;
    setBusyAction(key);
    const res = await window.kickpulseDesktop.moderation.action('ban', {
      platform: m.platform, targetUsername: m.username, reason: 'Banned from the Live Chat feed',
    }).catch((e: any) => ({ ok: false, error: e?.message }));
    setBusyAction(null);
    if (res?.error) alert(res.error);
  };

  const quickDelete = async (m: ChatFeedMessage) => {
    const key = `${m.id}:delete`;
    if (busyAction) return;
    setBusyAction(key);
    const res = await window.kickpulseDesktop.moderation.deleteMessage(m.platform as 'kick' | 'twitch', m.id)
      .catch((e: any) => ({ ok: false, error: e?.message }));
    setBusyAction(null);
    if (!res.ok) { alert(res.error || 'Failed to delete message'); return; }
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  };

  return (
    <Page title="Dashboard" icon={<LayoutDashboard size={22} color={COLORS.accent} />} subtitle="Account status, live chat, and every stream event — all in one place." fullBleed>
      <Section style={{ marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
            background: status?.connected ? COLORS.success : COLORS.textFaint,
            boxShadow: status?.connected ? `0 0 6px ${COLORS.success}` : 'none',
          }} />
          {status?.connected && me ? (
            <span style={{ fontSize: 13, color: COLORS.text }}>
              Connected as <strong>{me.displayName || me.username}</strong>
              {me.isPremium && <span style={{ color: '#a78bfa' }}> · {me.isUltimate ? 'Ultimate' : 'Premium'}</span>}
              {!me.kickConnected && <span style={{ color: COLORS.warn }}> — no Kick account linked, live events won't reach this app</span>}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: COLORS.textFaint }}>Not connected — add your API key on the Settings tab</span>
          )}
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
        <Section title={`Chat (${messages.length})`} style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', marginBottom: 0, position: 'relative' }}>
          <div ref={chatStick.ref} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {messages.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: COLORS.textFaint, fontSize: 13 }}>No chat messages yet.</div>
            ) : messages.map((m) => {
              const info = viewerInfo[m.username.toLowerCase()];
              const warn = shouldWarn(info);
              return (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 8px', fontSize: 13,
                  background: warn ? 'rgba(239,68,68,0.06)' : undefined, borderRadius: 6,
                }}>
                  {/*
                    Metadata (time/platform icon/badges/username/warning)
                    as one atomic, non-wrapping inline-flex cluster — 2026-
                    10-28, direct feedback: "all badges should show on the
                    same line... desktop app is pushing badges down in a
                    column." Previously these were direct flex children of
                    the OUTER row, `align-items: baseline` mixed with a
                    differently-sized/aligned platform icon (now fixed
                    above) and the long message span right beside them —
                    once the message text actually wrapped (word-break:
                    break-word, on any real window width), baseline
                    alignment pinned the badges/icon to the first line's
                    text baseline while the row's own height grew around
                    the wrapped message, reading exactly like "badges
                    pushed down into a column." Grouping them with their
                    own `align-items: center` and `flexShrink: 0` makes
                    this cluster immune to that regardless of how the
                    message text wraps.
                  */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10.5, color: COLORS.textFaint, fontVariantNumeric: 'tabular-nums' }}>
                      {formatChatTime(m.createdAt)}
                    </span>
                    <PlatformIcon platform={m.platform} />
                    {m.badges?.length ? <span style={{ display: 'inline-flex', alignItems: 'center' }} dangerouslySetInnerHTML={{ __html: renderBadges(m) }} /> : null}
                    <span style={{ fontWeight: 700, color: m.color || COLORS.text }}>{m.username}</span>
                    {warn && <ViewerBadge info={info} />}
                  </span>
                  <span
                    style={{ color: COLORS.textDim, wordBreak: 'break-word', flex: 1 }}
                    dangerouslySetInnerHTML={{ __html: renderChatContent(m) }}
                  />
                  {((m.platform === 'kick' && canKick) || (m.platform === 'twitch' && canTwitch)) && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 4 }}>
                      <RowIconButton
                        title={`Reply to ${m.username}`}
                        onClick={() => setReplyTarget({ platform: m.platform as 'kick' | 'twitch', id: m.id, username: m.username })}
                      >
                        <Reply size={13} />
                      </RowIconButton>
                      <RowIconButton
                        title={`Timeout ${m.username} (10 min)`}
                        disabled={busyAction === `${m.id}:timeout`}
                        onClick={() => quickTimeout(m)}
                      >
                        <Clock size={13} />
                      </RowIconButton>
                      <RowIconButton
                        title={`Ban ${m.username}`} danger
                        disabled={busyAction === `${m.id}:ban`}
                        onClick={() => quickBan(m)}
                      >
                        <Ban size={13} />
                      </RowIconButton>
                      <RowIconButton
                        title="Delete message" danger
                        disabled={busyAction === `${m.id}:delete`}
                        onClick={() => quickDelete(m)}
                      >
                        <Trash2 size={13} />
                      </RowIconButton>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {!chatStick.isStuck && <JumpToLatestButton onClick={chatStick.jumpToBottom} />}
          {(canKick || canTwitch) && (
            <div style={{ flexShrink: 0, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
              {replyTarget && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: COLORS.textDim, marginBottom: 6 }}>
                  Replying to <strong style={{ color: COLORS.text }}>{replyTarget.username}</strong> on {replyTarget.platform === 'kick' ? 'Kick' : 'Twitch'}
                  <button onClick={() => setReplyTarget(null)} title="Cancel reply" style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16,
                    border: 'none', background: 'none', color: COLORS.textFaint, cursor: 'pointer', padding: 0,
                  }}>
                    <X size={12} />
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', position: 'relative' }}>
                {!replyTarget && canKick && canTwitch && (
                  <select
                    value={draftPlatform}
                    onChange={(e) => setDraftPlatform(e.target.value as 'kick' | 'twitch' | 'both')}
                    style={{
                      background: '#0e0e14', border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text,
                      fontSize: 12, padding: '0 6px', outline: 'none', flexShrink: 0, cursor: 'pointer',
                      height: 32, boxSizing: 'border-box',
                    }}
                  >
                    <option value="kick">Kick</option>
                    <option value="twitch">Twitch</option>
                    <option value="both">Both</option>
                  </select>
                )}
                <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                  <div
                    ref={draftRef}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={saveSelection}
                    onInput={emitDraftChange}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    style={{
                      background: '#0e0e14', border: `1px solid ${COLORS.border}`, borderRadius: 8,
                      color: COLORS.text, fontSize: 13, padding: '7px 32px 7px 10px', outline: 'none',
                      // Same 32px as the select/emote-button/Send below (direct
                      // report: "I want everything to be the same size, so
                      // make it shorter to match the buttons and other
                      // elements") — boxSizing:'border-box' is what makes
                      // minHeight actually mean "32px total," border included,
                      // same as every sibling here; still grows past that for
                      // a longer message via maxHeight/overflowY, just no
                      // longer taller than everything else at rest.
                      minHeight: 32, maxHeight: 90, boxSizing: 'border-box',
                      overflowY: 'auto', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    }}
                  />
                  {!draftText && (
                    <div style={{ position: 'absolute', top: 7, left: 10, fontSize: 13, color: COLORS.textFaint, pointerEvents: 'none' }}>
                      {replyTarget ? `Reply to ${replyTarget.username}…` : `Send a message as yourself on ${effectivePlatform === 'both' ? 'Kick + Twitch' : platformLabel(effectivePlatform)}…`}
                    </div>
                  )}
                </div>
                <button
                  ref={emoteButtonRef} type="button" title="Emotes"
                  onClick={() => setEmotePickerOpen((o) => !o)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
                    borderRadius: 7, border: `1px solid ${COLORS.border}`, background: '#1b1b24',
                    color: COLORS.textDim, cursor: 'pointer', flexShrink: 0, boxSizing: 'border-box',
                  }}
                >
                  <Smile size={14} />
                </button>
                <Button variant="primary" onClick={handleSend} disabled={sending || !draftText.trim()}
                  style={{ height: 32, boxSizing: 'border-box', padding: '0 14px' }}
                >
                  <Send size={13} />{sending ? 'Sending…' : 'Send'}
                </Button>
                {emotePickerOpen && (
                  <EmotePicker
                    showKick={canKick} showTwitch={canTwitch}
                    onPick={insertEmote}
                    onClose={() => setEmotePickerOpen(false)}
                    triggerRef={emoteButtonRef}
                  />
                )}
              </div>
              {sendError && <div style={{ color: '#f87171', fontSize: 11.5, marginTop: 4 }}>{sendError}</div>}
            </div>
          )}
        </Section>

        <Section title={`Events (${events.length})`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', marginBottom: 0, position: 'relative' }}>
          <div ref={eventStick.ref} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {events.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: COLORS.textFaint, fontSize: 13 }}>No events yet.</div>
            ) : events.map((e) => (
              <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 8px', fontSize: 12.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: PLATFORM_COLOR[e.platform], flexShrink: 0 }} />
                  <span style={{ color: COLORS.text }}>{e.summary}</span>
                </div>
                <span style={{ fontSize: 10.5, color: COLORS.textFaint, marginLeft: 12 }}>{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
          {!eventStick.isStuck && <JumpToLatestButton onClick={eventStick.jumpToBottom} />}
        </Section>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: COLORS.textFaint, padding: '8px 4px 0', flexShrink: 0 }}>
        <Flag size={12} /> Threat/flag warnings follow your sensitivity setting on the website's Community Bans page — any Viewer Flag always shows regardless of that setting.
      </div>
    </Page>
  );
}
