// src/pages/SettingsPage.tsx — replaces HomePage.tsx (2026-10-19, direct
// feedback: "Home could turned into settings, with more account relevant
// settings... get rid of the test buttons, they can go to the overlay
// display page as thats the only place they are really relevant. and we
// dont even need the jumpscare one."). The account connect/disconnect card
// is the one thing that genuinely IS "account relevant settings" from the
// old Home page — kept as-is. Test Jumpscare Now is gone outright (Scenes
// already covers the same "see something on screen" need, and jumpscares
// are frequently configured in 'scenes' mode anyway — see electron/
// main.ts's own resolvePayload/fireJumpscare history). Test a Scene Now
// moved to OverlayDisplayPage.tsx, next to "Highlight This Screen" — the
// one place actually testing which physical monitor something appears on
// is relevant.
//
// Native rebuild (2026-10-22, direct feedback: "I want the settings and
// connections page on the desktop app to be actually on the app. Not
// loading the site... Fix these two pages of the app") — Discord live
// notification, legal links, and account deletion replace the old <webview>
// embed of the website's own /settings page. API key management is
// deliberately left as a "manage on the website" link, not rebuilt here —
// see electron/api.ts's own comment on why (letting an API-key-
// authenticated session mint/revoke API keys through itself would be a
// real privilege-persistence risk).
import { useEffect, useState, type CSSProperties } from 'react';
import { Settings, LogOut, Trash2, ExternalLink } from 'lucide-react';
import { Page, Section, Button, COLORS } from '../components/ui';

const WEBSITE = 'https://www.kickpulsebot.com';

export default function SettingsPage() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Login with Kick/Twitch" (2026-10-20) — separate busy flag from the API
  // key path so the two don't disable each other's buttons/messages.
  const [loggingIn, setLoggingIn] = useState<'kick' | 'twitch' | null>(null);

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then(setStatus);
    window.kickpulseDesktop.onStatus(setStatus);
  }, []);

  const connect = async () => {
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    setError(null);
    const res = await window.kickpulseDesktop.saveApiKey(apiKeyInput.trim());
    setSaving(false);
    if (!res.ok) setError(res.error || 'Could not connect');
    else setApiKeyInput('');
  };

  const loginWithKick = async () => {
    setLoggingIn('kick');
    setError(null);
    const res = await window.kickpulseDesktop.loginWithKick();
    setLoggingIn(null);
    if (!res.ok) setError(res.error || 'Kick login failed');
  };
  const loginWithTwitch = async () => {
    setLoggingIn('twitch');
    setError(null);
    const res = await window.kickpulseDesktop.loginWithTwitch();
    setLoggingIn(null);
    if (!res.ok) setError(res.error || 'Twitch login failed');
  };

  const disconnect = async () => {
    await window.kickpulseDesktop.disconnect();
    setStatus({ connected: false, me: null });
  };

  const userId = status?.me?.userId ?? null;

  // Discord live notification
  const [discordUrl, setDiscordUrl] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(true);
  const [discordLoaded, setDiscordLoaded] = useState(false);
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordTesting, setDiscordTesting] = useState(false);
  const [discordMsg, setDiscordMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    window.kickpulseDesktop.settings.getDiscordSettings()
      .then(d => { setDiscordUrl(d.webhookUrl || ''); setDiscordEnabled(d.enabled !== false); })
      .catch(() => {})
      .finally(() => setDiscordLoaded(true));
  }, [userId]);

  const saveDiscord = async () => {
    setDiscordSaving(true);
    setDiscordMsg(null);
    try {
      await window.kickpulseDesktop.settings.saveDiscordSettings({ webhookUrl: discordUrl.trim(), enabled: discordEnabled });
      setDiscordMsg('Saved!');
    } catch (e: any) {
      setDiscordMsg(e.message || 'Failed to save');
    } finally {
      setDiscordSaving(false);
    }
  };
  const testDiscord = async () => {
    if (!discordUrl.trim()) { setDiscordMsg('Paste a webhook URL first'); return; }
    setDiscordTesting(true);
    setDiscordMsg(null);
    try {
      await window.kickpulseDesktop.settings.testDiscordWebhook(discordUrl.trim());
      setDiscordMsg('Test message sent — check your Discord channel!');
    } catch (e: any) {
      setDiscordMsg(e.message || 'Discord rejected the request');
    } finally {
      setDiscordTesting(false);
    }
  };

  // Account deletion
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => {
    if (!confirm('Permanently delete your KickPulse account? This removes every connected platform, widget config, and setting — it cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? Type nothing further needed — this is the final confirmation.')) return;
    setDeleting(true);
    try {
      const res = await window.kickpulseDesktop.settings.deleteAccount();
      if (!res.ok) throw new Error(res.error || 'Failed to delete account');
      setStatus({ connected: false, me: null });
    } catch (e: any) {
      alert(e.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Page
      title="Settings"
      icon={<Settings size={22} color={COLORS.accent} />}
      subtitle="Your account connection, Discord live notifications, legal, and account deletion."
    >
      <Section title="Account">
        {status?.connected && status.me ? (
          <div>
            <div style={{ color: COLORS.success, fontWeight: 600, fontSize: 13 }}>Connected</div>
            <div style={{ fontSize: 13, color: COLORS.text, marginTop: 4 }}>
              {status.me.displayName || status.me.username || 'Unknown account'}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>
              {status.me.isUltimate ? 'Ultimate' : status.me.isPremium ? 'Premium' : 'Free'} account
              {!status.me.kickConnected && " — no Kick account linked, live events won't reach this app yet"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>
              Kick: {status.me.kickConnected ? 'Connected' : 'Not connected'} · Twitch: {status.me.twitchConnected ? 'Connected' : 'Not connected'}
            </div>
            <Button onClick={disconnect} variant="danger" style={{ marginTop: 12 }}>
              <LogOut size={14} /> Disconnect
            </Button>
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, color: COLORS.text }}>Connect your account</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={loginWithKick} disabled={loggingIn !== null} style={{ flex: 1, background: '#00ff9d', color: '#04120c' }}>
                {loggingIn === 'kick' ? 'Waiting for login…' : 'Login with Kick'}
              </Button>
              <Button onClick={loginWithTwitch} disabled={loggingIn !== null} style={{ flex: 1, background: '#9146ff', color: '#fff' }}>
                {loggingIn === 'twitch' ? 'Waiting for login…' : 'Login with Twitch'}
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
              <span style={{ fontSize: 11, color: COLORS.textFaint }}>OR</span>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
            </div>
            <label style={{ fontSize: 13, color: COLORS.textDim }}>
              API key (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  window.kickpulseDesktop.openExternal('https://www.kickpulsebot.com/settings');
                }}
                style={{ color: '#a78bfa' }}
              >
                Dashboard → Settings → API Keys
              </a>
              )
            </label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="kp_..."
              style={input}
            />
            <Button onClick={connect} disabled={saving || !apiKeyInput.trim() || loggingIn !== null} style={{ marginTop: 10 }}>
              {saving ? 'Connecting…' : 'Connect'}
            </Button>
            {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{error}</div>}
            {status?.error && !error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{status.error}</div>}
            <div style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 10 }}>
              This connects live triggers (chat commands, Pulse Engine, the meter maxing out) and the Dashboard's
              own chat/event feed. To edit your widgets and overlays, use the tabs on the left — those log in on
              their own, the same way the website does.
            </div>
          </div>
        )}
      </Section>

      {userId && discordLoaded && (
        <Section title="Discord Live Notification">
          <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
            Post a message to a Discord channel automatically when you go live on Kick. In Discord:
            channel settings → Integrations → Webhooks → New Webhook → copy URL.
          </p>
          <input
            type="text" value={discordUrl} onChange={e => setDiscordUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…" style={input}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COLORS.textDim, cursor: 'pointer' }}>
              <button onClick={() => setDiscordEnabled(v => !v)}
                style={{
                  position: 'relative', width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: discordEnabled ? '#6366f1' : COLORS.border,
                }}>
                <span style={{
                  position: 'absolute', top: 2, left: discordEnabled ? 20 : 2,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
                }} />
              </button>
              Enabled
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={saveDiscord} disabled={discordSaving}>{discordSaving ? 'Saving…' : 'Save'}</Button>
              <Button onClick={testDiscord} disabled={discordTesting || !discordUrl.trim()}>{discordTesting ? 'Sending…' : 'Send Test Message'}</Button>
            </div>
          </div>
          {discordMsg && <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 8 }}>{discordMsg}</div>}
        </Section>
      )}

      {userId && (
        <Section title="API Keys">
          <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
            Managed on the website only, deliberately — not rebuilt here, since letting this app mint
            or revoke keys through its own API-key credential would let a leaked key keep itself alive.
          </p>
          <Button onClick={() => window.kickpulseDesktop.openExternal(`${WEBSITE}/settings`)}>
            <ExternalLink size={13} /> Manage API Keys on the website
          </Button>
        </Section>
      )}

      <Section title="Legal">
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => window.kickpulseDesktop.openExternal(`${WEBSITE}/privacy`)}><ExternalLink size={13} /> Privacy Policy</Button>
          <Button onClick={() => window.kickpulseDesktop.openExternal(`${WEBSITE}/terms`)}><ExternalLink size={13} /> Terms of Service</Button>
        </div>
      </Section>

      {userId && (
        <Section title="Delete Account">
          <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
            Permanently deletes your KickPulse account — every connected platform, widget config, and
            setting. This cannot be undone.
          </p>
          <Button variant="danger" onClick={deleteAccount} disabled={deleting}>
            <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete Account'}
          </Button>
        </Section>
      )}
    </Page>
  );
}

const input: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.panelAlt,
  color: '#fff',
  boxSizing: 'border-box',
};
