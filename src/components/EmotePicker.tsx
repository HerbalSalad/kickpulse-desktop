// src/components/EmotePicker.tsx — a popup emote grid for the Live Chat
// reply box (2026-11-11, "bonus points if we get our emote menu" — desktop-
// native counterpart to the website's own EmoteMessageEditor.tsx). Same
// real emote sources (Kick global/channel/emoji + Twitch global/channel),
// just inserting plain [emote:id:name]/[temote:id:name] bracket tokens at
// the end of the draft rather than a rich contentEditable field with inline
// <img> previews — the server resolves these tokens exactly the same way
// regardless of which editor produced them (kickpulse-new's server.js
// resolveEmoteTokensForPlatform), so this is a real functional match, just
// a simpler editing surface than porting a full contentEditable component.
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { COLORS } from './ui';

type KickTab = 'global' | 'channel' | 'emoji';
type PickedEmote = { id: string; name: string; kind: 'kick' | 'twitch'; url?: string };

export interface EmotePickerProps {
  showKick: boolean;
  showTwitch: boolean;
  onPick: (token: string) => void;
  onClose: () => void;
  /** The button that opens/closes this picker — excluded from the outside-click-closes check so toggling it doesn't immediately re-close itself. */
  triggerRef: React.RefObject<HTMLElement>;
}

export default function EmotePicker({ showKick, showTwitch, onPick, onClose, triggerRef }: EmotePickerProps) {
  const [platform, setPlatform] = useState<'kick' | 'twitch'>(showKick ? 'kick' : 'twitch');
  const [kickTab, setKickTab] = useState<KickTab>('global');
  const [kickCatalog, setKickCatalog] = useState<KickEmoteCatalog>({ channelEmotes: [], globalEmotes: [], emojis: [] });
  const [twitchEmotes, setTwitchEmotes] = useState<{ channelEmotes: TwitchEmoteInfo[]; globalEmotes: TwitchEmoteInfo[] }>({ channelEmotes: [], globalEmotes: [] });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      showKick ? window.kickpulseDesktop.chatFeed.getKickEmotes() : Promise.resolve<KickEmoteCatalog>({ channelEmotes: [], globalEmotes: [], emojis: [] }),
      showTwitch ? window.kickpulseDesktop.chatFeed.getTwitchEmotes() : Promise.resolve({ channelEmotes: [], globalEmotes: [] }),
    ]).then(([kick, twitch]) => { setKickCatalog(kick); setTwitchEmotes(twitch); setLoading(false); });
  }, [showKick, showTwitch]);

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, triggerRef]);

  const kickActive: PickedEmote[] = (kickTab === 'channel' ? kickCatalog.channelEmotes : kickTab === 'emoji' ? kickCatalog.emojis : kickCatalog.globalEmotes)
    .map((e) => ({ ...e, kind: 'kick' as const }));
  const twitchActive: PickedEmote[] = [...twitchEmotes.channelEmotes, ...twitchEmotes.globalEmotes]
    .map((e) => ({ ...e, kind: 'twitch' as const }));

  const visible: PickedEmote[] = search.trim()
    ? [
        ...kickCatalog.channelEmotes.map((e) => ({ ...e, kind: 'kick' as const })),
        ...kickCatalog.globalEmotes.map((e) => ({ ...e, kind: 'kick' as const })),
        ...kickCatalog.emojis.map((e) => ({ ...e, kind: 'kick' as const })),
        ...twitchActive,
      ].filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : platform === 'kick' ? kickActive : twitchActive;

  const imgUrl = (e: PickedEmote) => e.kind === 'kick'
    ? `https://files.kick.com/emotes/${e.id}/fullsize`
    : e.url || `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/3.0`;

  const pick = (e: PickedEmote) => onPick(e.kind === 'kick' ? `[emote:${e.id}:${e.name}]` : `[temote:${e.id}:${e.name}]`);

  return (
    <div ref={rootRef} style={{
      position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, width: 300, maxHeight: 280,
      background: COLORS.panelAlt, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10,
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: 8, borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0e0e14', border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: '4px 8px' }}>
          <Search size={12} color={COLORS.textFaint} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search emotes…" autoFocus
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: COLORS.text, fontSize: 12 }}
          />
        </div>
      </div>
      {!search.trim() && showKick && showTwitch && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
          {(['kick', 'twitch'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPlatform(p)} style={{
              flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
              background: 'none', border: 'none', cursor: 'pointer',
              color: platform === p ? COLORS.accent : COLORS.textFaint,
              borderBottom: platform === p ? `2px solid ${COLORS.accent}` : '2px solid transparent',
            }}>{p === 'kick' ? 'Kick' : 'Twitch'}</button>
          ))}
        </div>
      )}
      {!search.trim() && platform === 'kick' && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
          {(['global', 'channel', 'emoji'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setKickTab(t)} style={{
              flex: 1, padding: '5px 0', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3,
              background: 'none', border: 'none', cursor: 'pointer',
              color: kickTab === t ? COLORS.text : COLORS.textFaint,
              borderBottom: kickTab === t ? `2px solid ${COLORS.borderStrong}` : '2px solid transparent',
            }}>{t === 'global' ? 'Global' : t === 'channel' ? 'Channel' : 'Emoji'}</button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: COLORS.textFaint, fontSize: 12, padding: 16 }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: COLORS.textFaint, fontSize: 12, padding: 16 }}>{search ? 'No results' : 'No emotes'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
            {visible.map((e, i) => (
              <button key={`${e.kind}-${e.id}-${i}`} type="button" title={e.name} onClick={() => pick(e)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, borderRadius: 6,
                border: 'none', background: 'none', cursor: 'pointer',
              }}>
                <img src={imgUrl(e)} alt={e.name} style={{ width: 26, height: 26, objectFit: 'contain' }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
