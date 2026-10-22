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
import { useEffect, useState, type CSSProperties } from 'react';
import { Settings, LogOut } from 'lucide-react';
import { Page, Section, Button, COLORS } from '../components/ui';

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

  return (
    <Page title="Settings" icon={<Settings size={22} color={COLORS.accent} />} subtitle="Your account connection — everything else (widgets, overlays, Pulse Engine) logs in on its own.">
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
