// src/pages/ClipSettingsPage.tsx — who can use !clip and what the bot
// replies (2026-10-29, direct request: "do we have anywhere to configure
// that clip command, who can use it, what it replies, etc. If not, make it
// for the website and app"). Calls the SAME /clip-settings route the
// website's own ClipSettings.tsx uses (window.kickpulseDesktop.clipSettings,
// routes/clipSettings.js) — a change here and a change there both land in
// the same clip_settings row.
import { useState, useEffect, useCallback } from 'react';
import { Scissors } from 'lucide-react';
import { Page, Section, Button, COLORS } from '../components/ui';

type Permission = 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';

interface ClipSettingsData {
  permission: Permission;
  onRequestMessage: string;
  onSuccessMessage: string;
  onFailureMessage: string;
}

const DEFAULTS: ClipSettingsData = {
  permission: 'moderator',
  onRequestMessage: '🎬 Clip requested by {sender}! (needs KickPulse Desktop connected — give it a few seconds)',
  onSuccessMessage: '🎬 Clip created: {clipUrl}',
  onFailureMessage: '❌ Clip failed: {error}',
};

// Same 5 tiers/labels as the website's ChatBot.tsx/ClipSettings.tsx —
// local copy, not shared code, matching how every permission picker in
// this codebase already works (no cross-repo or cross-page shared module
// for this exists today).
const PERM_OPTIONS: { value: Permission; label: string }[] = [
  { value: 'everyone',    label: '👥 Everyone' },
  { value: 'subscriber',  label: '⭐ Subs+' },
  { value: 'vip',         label: '💎 VIPs+' },
  { value: 'moderator',   label: '🛡️ Mods+' },
  { value: 'broadcaster', label: '👑 Me Only' },
];

function MessageField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 6 }}>{hint}</div>
      <input value={value} onChange={e => onChange(e.target.value)} maxLength={300}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
          border: `1px solid ${COLORS.border}`, background: COLORS.panel, color: COLORS.text, fontSize: 13,
        }} />
    </div>
  );
}

export default function ClipSettingsPage() {
  const [settings, setSettings] = useState<ClipSettingsData>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    window.kickpulseDesktop.clipSettings.get()
      .then(data => setSettings({ ...DEFAULTS, ...data }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof ClipSettingsData>(key: K, val: ClipSettingsData[K]) => {
    setSettings(prev => ({ ...prev, [key]: val }));
  };

  const save = async () => {
    setSaving(true);
    await window.kickpulseDesktop.clipSettings.set(settings).catch(() => {});
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <Page title="Clip Settings" icon={<Scissors size={22} color={COLORS.accent} />}
      subtitle="Who can use !clip, and what the bot says — needs the Connections page's Kick Clips login to actually work">
      <Section title="Who Can Use !clip">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERM_OPTIONS.map(p => (
            <button key={p.value} onClick={() => set('permission', p.value)}
              style={{
                padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: settings.permission === p.value ? COLORS.accent : '#1b1b24',
                color: settings.permission === p.value ? '#fff' : COLORS.textDim,
              }}>
              {p.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 10 }}>
          Usage: <code style={{ color: COLORS.accent }}>!clip 30</code> (seconds, 10-60, defaults to 30) — clips the most recent footage on your Kick channel.
        </p>
      </Section>

      <Section title="Bot Replies">
        <MessageField
          label="On Request"
          hint="Sent immediately when someone runs !clip. {sender} = their username."
          value={settings.onRequestMessage}
          onChange={v => set('onRequestMessage', v)}
        />
        <MessageField
          label="On Success"
          hint="Sent once this app actually finishes creating the clip (also used for the Create Kick Clip Pulse Engine action). {clipUrl} = the real clip link."
          value={settings.onSuccessMessage}
          onChange={v => set('onSuccessMessage', v)}
        />
        <MessageField
          label="On Failure"
          hint="Sent if the clip couldn't be created (also used for the Pulse Engine action). {error} = the real reason."
          value={settings.onFailureMessage}
          onChange={v => set('onFailureMessage', v)}
        />
      </Section>

      <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
    </Page>
  );
}
