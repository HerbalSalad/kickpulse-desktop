// src/pages/ModerationPage.tsx — Moderation, rebuilt as a real native page
// (2026-10-18, direct feedback — see ChatBotPage.tsx's own header for the
// full quote). Ported from the website's own src/pages/Moderation.tsx —
// same Pending queue (song requests / point redemptions / donations) and
// Ban/Timeout/Unban action, same REST endpoints (widened for this app's
// API key the same day, see routes/moderation.js's own comment).
//
// Chat Mode tab (ported 2026-10-19 — it was deliberately deferred, not
// broken: see the git history on the comment this replaces) hits the same
// server routes the website's own ChatModeTab already uses
// (/moderation/chat-settings, /moderation/chat-mode). It's Twitch-only —
// Kick has no chat-mode-setting API at all (confirmed against Kick's own
// public API docs, docs.kick.com/apis/chat — only POST/DELETE on individual
// messages exists there), so every label on this tab says so explicitly
// rather than leaving it implied.
//
// Deliberately NOT ported, disclosed rather than silently dropped:
//   - Scenes tab — redundant here: this app already has a real Scenes page
//     (webview-embedded) and native OBS Control, which cover the same
//     "switch an OBS scene" need directly.
import { useEffect, useState } from 'react';
import { ShieldCheck, Check, X, Ban, Clock, MessagesSquare } from 'lucide-react';
import { Page, Section, Row, TextInput, NumberInput, Select, Button, IconButton, EmptyState, COLORS, Tabs } from '../components/ui';

type Tab = 'pending' | 'moderate' | 'chat-mode';

export default function ModerationPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [songRequests, setSongRequests] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [donations, setDonations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await window.kickpulseDesktop.moderation.pending();
      setSongRequests(res.songRequests || []);
      setRedemptions(res.redemptions || []);
      setDonations(res.donations || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load — Teams manage_moderation permission required');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const total = songRequests.length + redemptions.length + donations.length;

  const resolveSong = async (id: string, status: 'approved' | 'denied') => { await window.kickpulseDesktop.moderation.resolveSongRequest(id, status); await load(); };
  const resolveRedemption = async (id: string, status: 'fulfilled' | 'rejected') => { await window.kickpulseDesktop.moderation.resolveRedemption(id, status); await load(); };
  const approveDonation = async (id: string) => { await window.kickpulseDesktop.moderation.approveDonation(id); await load(); };
  const dismissDonation = async (id: string) => { await window.kickpulseDesktop.moderation.dismissDonation(id); await load(); };

  if (loading) return null;

  return (
    <Page title="Moderation" icon={<ShieldCheck size={22} color={COLORS.accent} />} subtitle="Everything waiting on a decision, and a real timeout/ban form.">
      <Tabs value={tab} onChange={(v) => setTab(v as Tab)} options={[
        { value: 'pending', label: `Pending (${total})`, icon: <ShieldCheck size={14} /> },
        { value: 'moderate', label: 'Ban / Timeout', icon: <Ban size={14} /> },
        { value: 'chat-mode', label: 'Chat Mode (Twitch)', icon: <MessagesSquare size={14} /> },
      ]} />

      {error && <Section style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}><span style={{ color: '#fca5a5', fontSize: 13 }}>{error}</span></Section>}

      {tab === 'pending' ? (
        <>
          {songRequests.length > 0 && (
            <Section title={`Song Requests (${songRequests.length})`}>
              {songRequests.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{r.video_title || r.request_text}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim }}>{r.display_name || r.viewer_username}</div>
                  </div>
                  <IconButton title="Approve" onClick={() => resolveSong(r.id, 'approved')}><Check size={14} /></IconButton>
                  <IconButton title="Deny & refund" danger onClick={() => resolveSong(r.id, 'denied')}><X size={14} /></IconButton>
                </div>
              ))}
            </Section>
          )}
          {redemptions.length > 0 && (
            <Section title={`Point Redemptions (${redemptions.length})`}>
              {redemptions.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{r.reward_title || r.reward_name}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim }}>{r.viewer_username} · {r.cost} pts</div>
                  </div>
                  <IconButton title="Fulfill" onClick={() => resolveRedemption(r.id, 'fulfilled')}><Check size={14} /></IconButton>
                  <IconButton title="Reject & refund" danger onClick={() => resolveRedemption(r.id, 'rejected')}><X size={14} /></IconButton>
                </div>
              ))}
            </Section>
          )}
          {donations.length > 0 && (
            <Section title={`Held Donations (${donations.length})`}>
              {donations.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{d.donor_name || 'Anonymous'} — {d.amount} {d.currency}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.message}</div>
                  </div>
                  <IconButton title="Approve (plays effects)" onClick={() => approveDonation(d.id)}><Check size={14} /></IconButton>
                  <IconButton title="Dismiss (no effects, money already theirs)" danger onClick={() => dismissDonation(d.id)}><X size={14} /></IconButton>
                </div>
              ))}
            </Section>
          )}
          {total === 0 && <EmptyState title="Nothing pending" body="Song requests, redemptions, and donations needing a decision show up here." />}
        </>
      ) : tab === 'moderate' ? (
        <BanTimeoutTab />
      ) : (
        <ChatModeTab />
      )}
    </Page>
  );
}

function BanTimeoutTab() {
  const [platform, setPlatform] = useState<'kick' | 'twitch'>('kick');
  const [targetUsername, setTargetUsername] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(600);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async (kind: 'timeout' | 'ban' | 'unban') => {
    if (!targetUsername.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      await window.kickpulseDesktop.moderation.action(kind, { platform, targetUsername: targetUsername.trim(), durationSeconds, reason: reason || undefined });
      setResult(`✓ ${kind === 'timeout' ? 'Timed out' : kind === 'ban' ? 'Banned' : 'Unbanned'} ${targetUsername.trim()}`);
    } catch (e: any) {
      setResult(e?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Timeout / Ban / Unban">
      <Row label="Platform">
        <Select value={platform} onChange={(v) => setPlatform(v as 'kick' | 'twitch')} options={[{ value: 'kick', label: 'Kick' }, { value: 'twitch', label: 'Twitch' }]} />
      </Row>
      <Row label="Username">
        <TextInput value={targetUsername} onChange={setTargetUsername} placeholder="viewer username" />
      </Row>
      <Row label="Timeout duration (sec)">
        <NumberInput value={durationSeconds} min={1} onChange={setDurationSeconds} style={{ width: 90 }} />
      </Row>
      <Row label="Reason" hint="Optional">
        <TextInput value={reason} onChange={setReason} />
      </Row>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Button onClick={() => run('timeout')} disabled={busy || !targetUsername.trim()}><Clock size={14} />Timeout</Button>
        <Button variant="danger" onClick={() => run('ban')} disabled={busy || !targetUsername.trim()}><Ban size={14} />Ban</Button>
        <Button onClick={() => run('unban')} disabled={busy || !targetUsername.trim()}>Unban</Button>
      </div>
      {result && <p style={{ fontSize: 13, color: result.startsWith('✓') ? COLORS.success : '#fca5a5', marginTop: 10 }}>{result}</p>}
    </Section>
  );
}

interface ChatSettingsState {
  slow_mode?: boolean; slow_mode_wait_time?: number;
  follower_mode?: boolean; follower_mode_duration?: number;
  subscriber_mode?: boolean;
  emote_mode?: boolean;
  unique_chat_mode?: boolean;
  non_moderator_chat_delay?: boolean; non_moderator_chat_delay_duration?: number;
}

const CHAT_MODE_ROWS: { key: keyof ChatSettingsState; label: string; durationKey?: keyof ChatSettingsState; defaultDuration?: number }[] = [
  { key: 'slow_mode', label: 'Slow Mode', durationKey: 'slow_mode_wait_time', defaultDuration: 30 },
  { key: 'follower_mode', label: 'Followers-Only Mode', durationKey: 'follower_mode_duration', defaultDuration: 0 },
  { key: 'subscriber_mode', label: 'Subscriber-Only Mode' },
  { key: 'emote_mode', label: 'Emote-Only Mode' },
  { key: 'unique_chat_mode', label: 'Unique Chat (R9K)' },
  { key: 'non_moderator_chat_delay', label: 'Non-Mod Chat Delay', durationKey: 'non_moderator_chat_delay_duration', defaultDuration: 2 },
];

// Twitch-only — Kick has no chat-mode-setting API at all (only POST/DELETE
// on individual messages, see routes/moderation.js on the server for the
// confirmed-against-Kick's-own-docs writeup). Every label here says so
// directly so it's never mistaken for something that also reaches Kick.
function ChatModeTab() {
  const [settings, setSettings] = useState<ChatSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await window.kickpulseDesktop.moderation.getChatSettings();
      setSettings(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load Twitch chat settings — this account may need to connect Twitch, or reconnect it to grant the newer chat-settings permission.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (field: keyof ChatSettingsState, durationField?: keyof ChatSettingsState, defaultDuration?: number) => {
    if (!settings) return;
    const next = !settings[field];
    const bodyKey = String(field).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const durKey = durationField ? String(durationField).replace(/_([a-z])/g, (_, c) => c.toUpperCase()) : undefined;
    setSaving(true);
    try {
      await window.kickpulseDesktop.moderation.setChatMode({
        [bodyKey]: next,
        ...(durKey && next ? { [durKey]: settings[durationField!] ?? defaultDuration } : {}),
      });
      setSettings({ ...settings, [field]: next });
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to update Twitch chat settings — try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Chat Mode — Twitch only" style={{ maxWidth: 520 }}>
      <p style={{ fontSize: 12, color: COLORS.textDim, marginTop: -4, marginBottom: 14 }}>
        These options only apply to your Twitch chat. Kick has no chat-mode API yet (slow mode,
        followers-only, etc.) — we haven't found a way to do this on Kick.
      </p>
      {error && (
        <div style={{ fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: 10, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {loading ? null : settings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CHAT_MODE_ROWS.map((row) => (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'rgba(0,0,0,0.2)', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '10px 14px' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</span>
              <Button onClick={() => toggle(row.key, row.durationKey, row.defaultDuration)} disabled={saving} variant={settings[row.key] ? 'primary' : 'default'}>
                {settings[row.key] ? 'On' : 'Off'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
