// src/pages/ChatAlertsPage.tsx — Chat Alerts, rebuilt as a real native page
// (2026-10-18, direct feedback — see ChatBotPage.tsx's own header for the
// full quote). Ported from the website's own src/pages/ChatAlertsSettings.tsx
// — same `chat_alert_configs` table, read/written directly via Supabase
// (anon-open, category-2 table — exactly like Scenes/Alert Studio already
// do natively), same per-kind message/variants/TTS shape. Only the two
// "Send Test" buttons are real server routes (widened for this app's API
// key the same day).
//
// Known, disclosed scope cut: alert kind labels/emojis are written fresh
// here (not pulled from the website's own ALERT_TABS, which isn't exposed
// anywhere outside that component) — the event TYPE KEYS themselves
// (kickFollow, twitchSub, etc.) are exact, so saved data round-trips
// correctly with the website either way; only the display label wording
// could differ cosmetically.
import { useEffect, useState } from 'react';
import { Bell, Plus, X, Send } from 'lucide-react';
import { Page, Section, Row, TextInput, NumberInput, Select, Toggle, Button, COLORS } from '../components/ui';
import { supabase } from '../lib/supabase';

type AlertKind =
  | 'kickFollow' | 'kickSub' | 'kickGift' | 'kickKicks' | 'kickHost' | 'kickReward' | 'kickBan'
  | 'twitchFollow' | 'twitchSub' | 'twitchGift' | 'twitchCheer' | 'twitchHost'
  | 'youtubeMember' | 'youtubeGiftedMember' | 'youtubeSuperchat';

const PLATFORM_TABS = [
  { id: 'kick', label: 'Kick', color: '#00ff9d' },
  { id: 'twitch', label: 'Twitch', color: '#9146ff' },
  { id: 'youtube', label: 'YouTube', color: '#ff0000' },
  { id: 'general', label: 'General', color: '#00ffff' },
] as const;

const KINDS_BY_PLATFORM: Record<string, { id: AlertKind; label: string; hasResub?: boolean }[]> = {
  kick: [
    { id: 'kickFollow', label: 'Follow' },
    { id: 'kickSub', label: 'Subscription', hasResub: true },
    { id: 'kickGift', label: 'Gifted Subs' },
    { id: 'kickKicks', label: 'Kicks Gifted' },
    { id: 'kickHost', label: 'Host' },
    { id: 'kickReward', label: 'Reward Redeemed' },
    { id: 'kickBan', label: 'Ban' },
  ],
  twitch: [
    { id: 'twitchFollow', label: 'Follow' },
    { id: 'twitchSub', label: 'Subscription', hasResub: true },
    { id: 'twitchGift', label: 'Gifted Subs' },
    { id: 'twitchCheer', label: 'Bits Cheered' },
    { id: 'twitchHost', label: 'Host' },
  ],
  youtube: [
    { id: 'youtubeMember', label: 'New Member' },
    { id: 'youtubeGiftedMember', label: 'Gifted Member' },
    { id: 'youtubeSuperchat', label: 'Super Chat' },
  ],
};

const CHAT_ALERT_TOKENS = ['{username}', '{amount}', '{viewers}', '{reward}', '{months}'];

// Amount-based kinds (2026-10-22 parity fix) — these are the only kinds
// whose real payload carries a usable {amount} (gifts/kicks/bits/super
// chats), same set the website derives from each ALERT_TABS entry's own
// `variables` list containing '{amount}' (useAlerts.ts) — mirrored here by
// exact event-type key since this page doesn't carry that metadata.
const AMOUNT_KINDS: AlertKind[] = ['kickGift', 'kickKicks', 'twitchGift', 'twitchCheer', 'youtubeGiftedMember', 'youtubeSuperchat'];

// minAmount + variantOrder (2026-10-22) — ported from the website's own
// VariantMessageList.tsx/ChatAlertsSettings.tsx: a variant can require a
// minimum amount to be eligible (e.g. a "super awesome" message only for a
// 5000+ kick gift, instead of diluting the pool for every gift regardless
// of size), and the pool as a whole can step through in order instead of
// always drawing at random. Server-side resolution (buildTieredVariantPool/
// pickChatAlertMessage, server.js) already handles both — this page was
// just missing the fields to actually set them.
interface VariantRow { text: string; platform?: 'kick' | 'twitch'; minAmount?: number }
interface EventConfig {
  enabled?: boolean;
  chatMessage?: string; chatMessages?: VariantRow[];
  resubChatMessage?: string; resubChatMessages?: VariantRow[];
  variantOrder?: 'random' | 'sequential';
  ttsEnabled?: boolean; ttsVoiceProvider?: string; ttsVoiceId?: string; ttsVoiceLabel?: string;
}

export default function ChatAlertsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [broadcasterId, setBroadcasterId] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, EventConfig>>({});
  const [levelUp, setLevelUp] = useState<{ enabled: boolean; message: string; platform: 'kick' | 'twitch' }>({ enabled: false, message: '🎉 @{username} leveled up to Level {level}!', platform: 'kick' });
  const [platform, setPlatform] = useState<typeof PLATFORM_TABS[number]['id']>('kick');
  const [activeKind, setActiveKind] = useState<AlertKind>('kickFollow');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voices, setVoices] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const status = await window.kickpulseDesktop.getStatus();
      const uid = status.me?.userId;
      setUserId(uid ?? null);
      setBroadcasterId(status.me?.kickBroadcasterId ?? null);
      if (uid) {
        const { data } = await supabase.from('chat_alert_configs').select('id, config').eq('user_id', uid).maybeSingle();
        if (data) {
          setRowId((data as any).id);
          setEvents((data as any).config?.events || {});
          if ((data as any).config?.pointsLevelUp) setLevelUp((data as any).config.pointsLevelUp);
        }
      }
      window.kickpulseDesktop.pulseRules.ttsVoices().then(setVoices).catch(() => {});
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const config = { events, pointsLevelUp: levelUp };
    if (rowId) {
      await supabase.from('chat_alert_configs').update({ config }).eq('id', rowId);
    } else if (userId) {
      const { data } = await supabase.from('chat_alert_configs').insert({ user_id: userId, broadcaster_id: broadcasterId, config }).select('id').single();
      if (data) setRowId((data as any).id);
    }
    setSaving(false);
  };

  const setKindConfig = (kind: AlertKind, patch: Partial<EventConfig>) => {
    setEvents((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  };

  const testSendAlert = async (kind: AlertKind) => {
    const p = kind.startsWith('twitch') ? 'twitch' : 'kick';
    await window.kickpulseDesktop.chatAlerts.testSend({ eventType: kind, platform: p, isResub: false, payload: { amount: 1, viewers: 42, reward: 'Test Reward' } }).catch(() => {});
  };

  if (loading) return null;

  const kinds = KINDS_BY_PLATFORM[platform] || [];
  const cfg = events[activeKind] || {};
  const kindDef = kinds.find((k) => k.id === activeKind);
  const isAmountKind = AMOUNT_KINDS.includes(activeKind);

  return (
    <Page title="Chat Alerts" icon={<Bell size={22} color={COLORS.accent} />} subtitle="What the bot says in chat for each alert — random variants, Level Up messages.">
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {PLATFORM_TABS.map((p) => (
          <button key={p.id} onClick={() => { setPlatform(p.id); if (p.id !== 'general') setActiveKind((KINDS_BY_PLATFORM[p.id]?.[0]?.id) as AlertKind); }}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${platform === p.id ? p.color : COLORS.border}`, background: platform === p.id ? `${p.color}22` : 'transparent', color: platform === p.id ? p.color : COLORS.textDim }}>
            {p.label}
          </button>
        ))}
      </div>

      {platform === 'general' ? (
        <Section title="Points Level Up">
          <Row label="Enabled"><Toggle checked={levelUp.enabled} onChange={(v) => setLevelUp({ ...levelUp, enabled: v })} /></Row>
          <Row label="Message" align="flex-start">
            <TextInput multiline value={levelUp.message} onChange={(v) => setLevelUp({ ...levelUp, message: v })} />
          </Row>
          <Row label="Platform">
            <Select value={levelUp.platform} onChange={(v) => setLevelUp({ ...levelUp, platform: v as 'kick' | 'twitch' })}
              options={[{ value: 'kick', label: 'Kick' }, { value: 'twitch', label: 'Twitch' }]} />
          </Row>
          <Button onClick={() => window.kickpulseDesktop.chatAlerts.testSendLevelUp().catch(() => {})}><Send size={13} />Send Test</Button>
        </Section>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {kinds.map((k) => (
              <button key={k.id} onClick={() => setActiveKind(k.id)}
                style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: activeKind === k.id ? COLORS.accent : 'rgba(255,255,255,0.06)', color: activeKind === k.id ? '#fff' : COLORS.textDim }}>
                {k.label}
              </button>
            ))}
          </div>

          <Section title={kindDef?.label || ''}>
            <Row label="Post in chat"><Toggle checked={cfg.enabled !== false} onChange={(v) => setKindConfig(activeKind, { enabled: v })} /></Row>
            <Row label="Message" align="flex-start">
              <div>
                <TextInput multiline value={cfg.chatMessage ?? ''} onChange={(v) => setKindConfig(activeKind, { chatMessage: v })} />
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  {CHAT_ALERT_TOKENS.map((t) => (
                    <button key={t} onClick={() => setKindConfig(activeKind, { chatMessage: `${cfg.chatMessage ?? ''}${cfg.chatMessage ? ' ' : ''}${t}` })}
                      style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, color: COLORS.textDim, cursor: 'pointer', fontFamily: 'monospace' }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </Row>

            {kindDef?.hasResub && (
              <Row label="Resub message" align="flex-start" hint="Shown for a renewal instead of a brand-new sub">
                <TextInput multiline value={cfg.resubChatMessage ?? ''} onChange={(v) => setKindConfig(activeKind, { resubChatMessage: v })} />
              </Row>
            )}

            <Row label="Random variants" align="flex-start" hint={isAmountKind ? 'Give a variant a min amount to save it for a bigger gift/cheer/kicks — it replaces the regular pool once that amount is actually hit.' : undefined}>
              <div style={{ width: '100%' }}>
                {(cfg.chatMessages ?? []).map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <TextInput value={r.text} onChange={(v) => setKindConfig(activeKind, { chatMessages: (cfg.chatMessages ?? []).map((x, xi) => xi === i ? { ...x, text: v } : x) })} style={{ flex: 1 }} />
                    <Select value={r.platform ?? 'all'} onChange={(v) => setKindConfig(activeKind, { chatMessages: (cfg.chatMessages ?? []).map((x, xi) => xi === i ? { ...x, platform: v === 'all' ? undefined : v as 'kick' | 'twitch' } : x) })}
                      options={[{ value: 'all', label: 'All' }, { value: 'kick', label: 'Kick' }, { value: 'twitch', label: 'Twitch' }]} style={{ width: 90 }} />
                    {isAmountKind && (
                      <NumberInput value={r.minAmount ?? 0} min={0} onChange={(v) => setKindConfig(activeKind, { chatMessages: (cfg.chatMessages ?? []).map((x, xi) => xi === i ? { ...x, minAmount: v || undefined } : x) })} style={{ width: 64 }} />
                    )}
                    <button onClick={() => setKindConfig(activeKind, { chatMessages: (cfg.chatMessages ?? []).filter((_, xi) => xi !== i) })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}><X size={14} /></button>
                  </div>
                ))}
                <Button onClick={() => setKindConfig(activeKind, { chatMessages: [...(cfg.chatMessages ?? []), { text: '' }] })}><Plus size={12} />Add variant</Button>
              </div>
            </Row>

            {kindDef?.hasResub && (
              <Row label="Resub variants" align="flex-start">
                <div style={{ width: '100%' }}>
                  {(cfg.resubChatMessages ?? []).map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <TextInput value={r.text} onChange={(v) => setKindConfig(activeKind, { resubChatMessages: (cfg.resubChatMessages ?? []).map((x, xi) => xi === i ? { ...x, text: v } : x) })} style={{ flex: 1 }} />
                      <Select value={r.platform ?? 'all'} onChange={(v) => setKindConfig(activeKind, { resubChatMessages: (cfg.resubChatMessages ?? []).map((x, xi) => xi === i ? { ...x, platform: v === 'all' ? undefined : v as 'kick' | 'twitch' } : x) })}
                        options={[{ value: 'all', label: 'All' }, { value: 'kick', label: 'Kick' }, { value: 'twitch', label: 'Twitch' }]} style={{ width: 90 }} />
                      <button onClick={() => setKindConfig(activeKind, { resubChatMessages: (cfg.resubChatMessages ?? []).filter((_, xi) => xi !== i) })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}><X size={14} /></button>
                    </div>
                  ))}
                  <Button onClick={() => setKindConfig(activeKind, { resubChatMessages: [...(cfg.resubChatMessages ?? []), { text: '' }] })}><Plus size={12} />Add resub variant</Button>
                </div>
              </Row>
            )}

            {((cfg.chatMessages?.length ?? 0) > 0 || (cfg.resubChatMessages?.length ?? 0) > 0) && (
              <Row label="Variant order" hint="Shared by random variants and resub variants above">
                <Select value={cfg.variantOrder ?? 'random'} onChange={(v) => setKindConfig(activeKind, { variantOrder: v as 'random' | 'sequential' })}
                  options={[{ value: 'random', label: 'Random' }, { value: 'sequential', label: 'In order (cycles back to start)' }]} style={{ width: 240 }} />
              </Row>
            )}

            <Row label="Read with TTS">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle checked={!!cfg.ttsEnabled} onChange={(v) => setKindConfig(activeKind, { ttsEnabled: v })} />
                {cfg.ttsEnabled && voices.length > 0 && (
                  <Select value={cfg.ttsVoiceProvider ? `${cfg.ttsVoiceProvider}:${cfg.ttsVoiceId}` : ''}
                    onChange={(v) => {
                      const voice = voices.find((x: any) => `${x.voice_provider}:${x.voice_id}` === v);
                      if (voice) setKindConfig(activeKind, { ttsVoiceProvider: voice.voice_provider, ttsVoiceId: voice.voice_id, ttsVoiceLabel: voice.voice_label || voice.voice_id });
                    }}
                    options={[{ value: '', label: 'Pick a voice…' }, ...voices.map((v: any) => ({ value: `${v.voice_provider}:${v.voice_id}`, label: v.voice_label || v.voice_id }))]} style={{ width: 200 }} />
                )}
              </div>
            </Row>

            <Button onClick={() => testSendAlert(activeKind)}><Send size={13} />Send Test</Button>
          </Section>
        </>
      )}

      <Button variant="primary" onClick={save} disabled={saving} style={{ marginTop: 16 }}>{saving ? 'Saving…' : 'Save'}</Button>
    </Page>
  );
}
