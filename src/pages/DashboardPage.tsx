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
import { LayoutDashboard, ShieldAlert, Flag, ArrowDown } from 'lucide-react';
import { Page, Section, COLORS } from '../components/ui';
import { renderChatContent } from '../lib/chatEmotes';
import { renderBadgesHtml, renderTwitchBadgesHtml, type SubscriberBadgeDef } from '../lib/kickBadges';
import { useStickToBottom } from '../hooks/useStickToBottom';

const PLATFORM_COLOR: Record<string, string> = { kick: '#53fc18', twitch: '#9146ff', youtube: '#ff0000', tiktok: '#ff0050' };

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
                  display: 'flex', alignItems: 'baseline', gap: 6, padding: '4px 8px', fontSize: 13,
                  background: warn ? 'rgba(239,68,68,0.06)' : undefined, borderRadius: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: PLATFORM_COLOR[m.platform], flexShrink: 0 }} />
                  {m.badges?.length ? <span dangerouslySetInnerHTML={{ __html: renderBadges(m) }} /> : null}
                  <span style={{ fontWeight: 700, color: m.color || COLORS.text, flexShrink: 0 }}>{m.username}</span>
                  {warn && <ViewerBadge info={info} />}
                  <span
                    style={{ color: COLORS.textDim, wordBreak: 'break-word' }}
                    dangerouslySetInnerHTML={{ __html: renderChatContent(m) }}
                  />
                </div>
              );
            })}
          </div>
          {!chatStick.isStuck && <JumpToLatestButton onClick={chatStick.jumpToBottom} />}
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
