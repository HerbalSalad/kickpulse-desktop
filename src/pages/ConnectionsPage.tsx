// src/pages/ConnectionsPage.tsx — native rebuild (2026-10-22, direct
// feedback: "I want the settings and connections page on the desktop app
// to be actually on the app. Not loading the site... Fix these two pages
// of the app"). Was a <webview> embed of the website's own /connections
// page — replaced because a cold webview load inside this app's own
// router/session bootstrap could land on the wrong route entirely (the
// reported "streamer not found" symptom came from the embed, not from
// anything wrong with the real data). Every action here goes through
// electron/main.ts's own IPC handlers (window.kickpulseDesktop.connections),
// which call the SAME server routes the website's own Connections.tsx uses
// — routes/youtube.js, routes/tiktok.js, server.js's /bot-identity/*,
// /platform-accounts/disconnect, /subscribe-events, /subscription-status —
// each widened server-side to also accept this app's own API-key
// credential (see each route's own comment on the server for why that's
// safe). Kick/Twitch "Connect" buttons and bot-account connect both open a
// real OAuth window via electron/oauth-login.ts, same as the Home tab's own
// "Login with Kick/Twitch" already does — never a webview.
import { useState, useEffect, useCallback } from 'react';
import { Link2, Zap, RefreshCw, Bot, Lock, Crown } from 'lucide-react';
import { Page, Section, Button, COLORS } from '../components/ui';

interface ConnectionsPageProps {
  userId: string | null;
}

const KICK_COLOR = '#53fc18';
const TWITCH_COLOR = '#9146ff';
const YOUTUBE_COLOR = '#ff0000';

export default function ConnectionsPage({ userId }: ConnectionsPageProps) {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [linking, setLinking] = useState<'kick' | 'twitch' | null>(null);
  const [disconnectingTwitch, setDisconnectingTwitch] = useState(false);

  const loadStatus = useCallback(() => { window.kickpulseDesktop.getStatus().then(setStatus); }, []);
  useEffect(() => { loadStatus(); window.kickpulseDesktop.onStatus(setStatus); }, [loadStatus]);

  const [youtubeInfo, setYoutubeInfo] = useState<Awaited<ReturnType<typeof window.kickpulseDesktop.connections.getYoutubeStatus>> | null>(null);
  const [ytHandleInput, setYtHandleInput] = useState('');
  const [ytSecondaryInput, setYtSecondaryInput] = useState('');
  const [connectingYt, setConnectingYt] = useState(false);
  const [connectingYtSecondary, setConnectingYtSecondary] = useState(false);
  const [disconnectingYt, setDisconnectingYt] = useState(false);
  const [disconnectingYtSecondary, setDisconnectingYtSecondary] = useState(false);
  const loadYoutube = useCallback(() => { window.kickpulseDesktop.connections.getYoutubeStatus().then(setYoutubeInfo).catch(() => {}); }, []);

  const [tiktokInfo, setTiktokInfo] = useState<Awaited<ReturnType<typeof window.kickpulseDesktop.connections.getTiktokStatus>> | null>(null);
  const [tiktokHandleInput, setTiktokHandleInput] = useState('');
  const [connectingTiktok, setConnectingTiktok] = useState(false);
  const [disconnectingTiktok, setDisconnectingTiktok] = useState(false);
  const loadTiktok = useCallback(() => { window.kickpulseDesktop.connections.getTiktokStatus().then(setTiktokInfo).catch(() => {}); }, []);

  const [botStatus, setBotStatus] = useState<Awaited<ReturnType<typeof window.kickpulseDesktop.connections.getBotStatus>> | null>(null);
  const [botConnecting, setBotConnecting] = useState<'kick' | 'twitch' | null>(null);
  const [botDisconnecting, setBotDisconnecting] = useState<'kick' | 'twitch' | null>(null);
  const loadBotStatus = useCallback(() => { window.kickpulseDesktop.connections.getBotStatus().then(setBotStatus).catch(() => {}); }, []);

  const [subs, setSubs] = useState<{ kick: boolean; twitch: boolean }>({ kick: false, twitch: false });
  const [subsLoading, setSubsLoading] = useState(false);
  const [subscribing, setSubscribing] = useState<'kick' | 'twitch' | null>(null);
  const loadSubs = useCallback(() => {
    setSubsLoading(true);
    window.kickpulseDesktop.connections.getSubscriptionStatus().then(setSubs).catch(() => {}).finally(() => setSubsLoading(false));
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadYoutube(); loadTiktok(); loadBotStatus(); loadSubs();
  }, [userId, loadYoutube, loadTiktok, loadBotStatus, loadSubs]);

  if (!userId || !status) {
    return (
      <Page title="Connections" icon={<Link2 size={22} color={COLORS.accent} />} subtitle="Platforms, bot accounts, and everything else your stream connects to.">
        <Section><p style={{ fontSize: 13, color: COLORS.textDim }}>Connect your account first (Home tab).</p></Section>
      </Page>
    );
  }
  const me = status.me;

  const linkKick = async () => {
    setLinking('kick');
    const res = await window.kickpulseDesktop.connections.linkKick();
    setLinking(null);
    if (!res.ok) alert(res.error || 'Failed to connect Kick');
    else loadStatus();
  };
  const linkTwitch = async () => {
    setLinking('twitch');
    const res = await window.kickpulseDesktop.connections.linkTwitch();
    setLinking(null);
    if (!res.ok) alert(res.error || 'Failed to connect Twitch');
    else loadStatus();
  };
  const disconnectTwitch = async () => {
    if (!me?.kickConnected) {
      alert("Can't disconnect Twitch — it's your only connected platform. Connect Kick first.");
      return;
    }
    if (!confirm('Disconnect Twitch? This will stop Twitch events and chat from working.')) return;
    setDisconnectingTwitch(true);
    await window.kickpulseDesktop.connections.disconnectTwitch();
    setDisconnectingTwitch(false);
    loadStatus();
    loadSubs();
  };

  const connectYoutube = async () => {
    if (!ytHandleInput.trim()) return;
    setConnectingYt(true);
    try {
      await window.kickpulseDesktop.connections.connectYoutube(ytHandleInput.trim());
      setYtHandleInput('');
      loadYoutube();
    } catch (e: any) { alert(e.message || 'Failed to connect'); }
    finally { setConnectingYt(false); }
  };
  const connectYoutubeSecondary = async () => {
    if (!ytSecondaryInput.trim()) return;
    setConnectingYtSecondary(true);
    try {
      await window.kickpulseDesktop.connections.connectYoutubeSecondary(ytSecondaryInput.trim());
      setYtSecondaryInput('');
      loadYoutube();
    } catch (e: any) { alert(e.message || 'Failed to connect'); }
    finally { setConnectingYtSecondary(false); }
  };
  const disconnectYoutube = async () => {
    if (!confirm('Disconnect YouTube? This will stop YouTube live chat capture and song requests from that platform.')) return;
    setDisconnectingYt(true);
    await window.kickpulseDesktop.connections.disconnectYoutube();
    setDisconnectingYt(false);
    loadYoutube();
  };
  const disconnectYoutubeSecondary = async () => {
    setDisconnectingYtSecondary(true);
    await window.kickpulseDesktop.connections.disconnectYoutubeSecondary();
    setDisconnectingYtSecondary(false);
    loadYoutube();
  };

  const connectTiktok = async () => {
    if (!tiktokHandleInput.trim()) return;
    setConnectingTiktok(true);
    try {
      await window.kickpulseDesktop.connections.connectTiktok(tiktokHandleInput.trim());
      setTiktokHandleInput('');
      loadTiktok();
    } catch (e: any) { alert(e.message || 'Failed to connect'); }
    finally { setConnectingTiktok(false); }
  };
  const disconnectTiktok = async () => {
    if (!confirm('Disconnect TikTok? This will stop TikTok live chat capture.')) return;
    setDisconnectingTiktok(true);
    await window.kickpulseDesktop.connections.disconnectTiktok();
    setDisconnectingTiktok(false);
    loadTiktok();
  };

  const connectBot = async (platform: 'kick' | 'twitch') => {
    setBotConnecting(platform);
    const res = await window.kickpulseDesktop.connections.connectBot(platform);
    setBotConnecting(null);
    if (!res.ok) alert(res.error || 'Failed to connect bot account');
    else loadBotStatus();
  };
  const disconnectBot = async (platform: 'kick' | 'twitch') => {
    setBotDisconnecting(platform);
    await window.kickpulseDesktop.connections.disconnectBot(platform);
    setBotDisconnecting(null);
    loadBotStatus();
  };
  const toggleOfficialBotPref = async (platform: 'kick' | 'twitch', value: boolean) => {
    setBotStatus(prev => prev ? { ...prev, preferences: { ...prev.preferences, [platform]: value } } : prev);
    await window.kickpulseDesktop.connections.setBotPreference(platform, value).catch(() => loadBotStatus());
  };

  const subscribe = async (platform: 'kick' | 'twitch') => {
    setSubscribing(platform);
    try {
      await window.kickpulseDesktop.connections.subscribeEvents(platform);
      setSubs(prev => ({ ...prev, [platform]: true }));
    } catch (e: any) {
      alert(`Subscription failed: ${e.message || 'unknown error'}`);
    } finally {
      setSubscribing(null);
    }
  };

  return (
    <Page title="Connections" icon={<Link2 size={22} color={COLORS.accent} />} subtitle="Platforms, bot accounts, and everything else your stream connects to.">
      {/* Connected Platforms */}
      <Section title="Connected Platforms">
        <PlatformRow
          icon={<span style={{ color: KICK_COLOR, fontWeight: 900, fontSize: 13 }}>K</span>}
          name="Kick" color={KICK_COLOR}
          connected={!!me?.kickConnected} username={me?.username || undefined}
          onConnect={linkKick} connecting={linking === 'kick'}
        />
        <PlatformRow
          icon={<span style={{ color: TWITCH_COLOR, fontWeight: 900, fontSize: 13 }}>T</span>}
          name="Twitch" color={TWITCH_COLOR}
          connected={!!me?.twitchConnected} username={me?.twitchUsername || undefined}
          onConnect={linkTwitch} connecting={linking === 'twitch'}
          onDisconnect={me?.twitchConnected ? disconnectTwitch : undefined} disconnecting={disconnectingTwitch}
        />

        {/* YouTube — typed handle, no OAuth (no official API at all — see
            CLAUDE.md's YouTube live chat capture section). */}
        <div style={rowBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: YOUTUBE_COLOR, fontWeight: 900, fontSize: 13 }}>▶</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>YouTube</div>
                {youtubeInfo?.connected
                  ? <div style={{ fontSize: 11, color: YOUTUBE_COLOR }}>{youtubeInfo.channelTitle}</div>
                  : <div style={{ fontSize: 11, color: COLORS.textFaint }}>Live chat capture + song requests</div>}
              </div>
            </div>
            {youtubeInfo?.connected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={connectedPill(YOUTUBE_COLOR)}>Connected ✓</span>
                <Button onClick={disconnectYoutube} disabled={disconnectingYt}>{disconnectingYt ? 'Disconnecting…' : 'Disconnect'}</Button>
              </div>
            )}
          </div>
          {!youtubeInfo?.connected && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={ytHandleInput} onChange={e => setYtHandleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') connectYoutube(); }}
                placeholder="@yourchannel" style={{ ...inputStyle, flex: 1 }} />
              <Button variant="primary" onClick={connectYoutube} disabled={connectingYt || !ytHandleInput.trim()}>
                {connectingYt ? 'Connecting…' : 'Connect →'}
              </Button>
            </div>
          )}
          {youtubeInfo?.connected && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
              <p style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 6 }}>Second channel (optional) — both merge into one feed.</p>
              {youtubeInfo.secondary ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: YOUTUBE_COLOR }}>{youtubeInfo.secondary.channelTitle}</span>
                  <Button onClick={disconnectYoutubeSecondary} disabled={disconnectingYtSecondary}>
                    {disconnectingYtSecondary ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={ytSecondaryInput} onChange={e => setYtSecondaryInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') connectYoutubeSecondary(); }}
                    placeholder="@anotherchannel" style={{ ...inputStyle, flex: 1 }} />
                  <Button onClick={connectYoutubeSecondary} disabled={connectingYtSecondary || !ytSecondaryInput.trim()}>
                    {connectingYtSecondary ? 'Connecting…' : 'Add →'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* TikTok — typed handle only, no API/verification at all exists. */}
        <div style={rowBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>TikTok</div>
              {tiktokInfo?.connected
                ? <div style={{ fontSize: 11, color: COLORS.textDim }}>@{tiktokInfo.username}</div>
                : <div style={{ fontSize: 11, color: COLORS.textFaint }}>Live chat capture</div>}
            </div>
            {tiktokInfo?.connected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={connectedPill(COLORS.textDim)}>Connected ✓</span>
                <Button onClick={disconnectTiktok} disabled={disconnectingTiktok}>{disconnectingTiktok ? 'Disconnecting…' : 'Disconnect'}</Button>
              </div>
            )}
          </div>
          {!tiktokInfo?.connected && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={tiktokHandleInput} onChange={e => setTiktokHandleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') connectTiktok(); }}
                placeholder="@yourusername" style={{ ...inputStyle, flex: 1 }} />
              <Button onClick={connectTiktok} disabled={connectingTiktok || !tiktokHandleInput.trim()}>
                {connectingTiktok ? 'Connecting…' : 'Connect →'}
              </Button>
            </div>
          )}
        </div>
      </Section>

      {/* Bot Account */}
      <Section title="Bot Account">
        <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
          By default, your bot messages post using Kick's own bot identity (or, on Twitch, your own
          account). Connect a separate account to have chat commands, alerts, and moderation post as
          THAT account instead.
        </p>
        {(['kick', 'twitch'] as const).map(platform => {
          const custom = botStatus?.custom.find(b => b.platform === platform);
          const official = botStatus?.official.find(b => b.platform === platform);
          return (
            <div key={platform} style={rowBox}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, textTransform: 'capitalize' }}>{platform}</div>
              {!botStatus?.isUltimate ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, background: COLORS.panel, border: `1px solid ${COLORS.border}` }}>
                  <span style={{ fontSize: 11, color: COLORS.textFaint, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={12} /> Connecting your own bot account requires Ultimate
                  </span>
                  <button onClick={() => window.kickpulseDesktop.openExternal('https://www.kickpulsebot.com/pricing')}
                    style={{ ...linkBtn, color: COLORS.warn, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Crown size={12} /> Upgrade
                  </button>
                </div>
              ) : custom ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#38bdf8' }}>@{custom.username}{custom.needs_reauth && ' — needs reconnect'}</span>
                  <Button onClick={() => disconnectBot(platform)} disabled={botDisconnecting === platform}>
                    {botDisconnecting === platform ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </div>
              ) : (
                <Button onClick={() => connectBot(platform)} disabled={botConnecting === platform}>
                  <Bot size={13} /> {botConnecting === platform ? 'Connecting…' : 'Connect your own bot account →'}
                </Button>
              )}

              {official && !custom && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                  <div>
                    <div style={{ fontSize: 12, color: COLORS.text }}>Use KickPulse's official bot (@{official.username})</div>
                    <div style={{ fontSize: 11, color: COLORS.textFaint }}>No setup needed unless your chat has follower/sub-only restrictions.</div>
                  </div>
                  <button onClick={() => toggleOfficialBotPref(platform, !botStatus?.preferences[platform])}
                    style={{
                      position: 'relative', width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: botStatus?.preferences[platform] ? '#38bdf8' : COLORS.border,
                    }}>
                    <span style={{
                      position: 'absolute', top: 2, left: botStatus?.preferences[platform] ? 20 : 2,
                      width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
                    }} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* Event Subscriptions */}
      <Section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={15} color={COLORS.success} /> Event Subscriptions
          </div>
          <button onClick={loadSubs} disabled={subsLoading} title="Refresh status" style={{ ...linkBtn, color: COLORS.textFaint }}>
            <RefreshCw size={14} style={{ opacity: subsLoading ? 0.5 : 1 }} />
          </button>
        </div>
        <SubRow label="Kick Events" sub="Follows, subs, gifts, kicks, raids" active={subs.kick}
          onSubscribe={() => subscribe('kick')} subscribing={subscribing === 'kick'} />
        <SubRow label="Twitch Events" sub="Follows, subs, bits, gifts, chat" active={subs.twitch}
          onSubscribe={() => subscribe('twitch')} subscribing={subscribing === 'twitch'}
          disabled={!me?.twitchConnected} disabledReason="Connect Twitch first" />
      </Section>
    </Page>
  );
}

function PlatformRow({ icon, name, color, connected, username, onConnect, connecting, onDisconnect, disconnecting }: {
  icon: React.ReactNode; name: string; color: string; connected: boolean; username?: string;
  onConnect: () => void; connecting: boolean; onDisconnect?: () => void; disconnecting?: boolean;
}) {
  return (
    <div style={rowBox}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: COLORS.panel, border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
            {connected && username && <div style={{ fontSize: 11, color }}>@{username}</div>}
          </div>
        </div>
        {connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={connectedPill(color)}>Connected ✓</span>
            {onDisconnect && <Button onClick={onDisconnect} disabled={disconnecting}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</Button>}
          </div>
        ) : (
          <Button variant="primary" onClick={onConnect} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect →'}</Button>
        )}
      </div>
    </div>
  );
}

function SubRow({ label, sub, active, onSubscribe, subscribing, disabled, disabledReason }: {
  label: string; sub: string; active: boolean; onSubscribe: () => void; subscribing: boolean;
  disabled?: boolean; disabledReason?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: COLORS.panelAlt, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: COLORS.textFaint }}>{sub}</div>
      </div>
      {active ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={connectedPill(COLORS.success)}>Active ✓</span>
          <button onClick={onSubscribe} disabled={subscribing} title="Re-subscribe" style={{ ...linkBtn, color: COLORS.textFaint }}>
            <RefreshCw size={13} />
          </button>
        </div>
      ) : disabled ? (
        <span style={{ fontSize: 11, color: COLORS.textFaint }}>{disabledReason}</span>
      ) : (
        <Button variant="primary" onClick={onSubscribe} disabled={subscribing}>{subscribing ? 'Subscribing…' : 'Subscribe'}</Button>
      )}
    </div>
  );
}

function connectedPill(color: string): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: `${color}22`, color, border: `1px solid ${color}44` };
}
const rowBox: React.CSSProperties = { padding: 12, borderRadius: 10, background: COLORS.panelAlt, marginBottom: 10 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' };
const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${COLORS.border}`,
  background: COLORS.panel, color: COLORS.text, fontSize: 13,
};
