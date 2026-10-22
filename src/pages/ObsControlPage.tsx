// src/pages/ObsControlPage.tsx — connects to OBS's own built-in WebSocket
// server (Tools → WebSocket Server Settings, OBS 28+). Switch scenes,
// show/hide sources, and start/stop streaming+recording.
//
// 2026-10-15 — restyled onto the shared ui.tsx primitives (was its own
// hand-rolled inline-CSS page, visibly inconsistent with the rest of the
// app's design). Also: chat/Pulse-Engine-triggered scene switching has been
// real and live since this same day (a Pulse Engine rule's own "Switch OBS
// Scene" action broadcasts obs.switchScene, which electron/main.ts's
// handleWsMessage already reacts to) — the page used to say this was "a
// real follow-up, not built yet," which was stale the moment that shipped.
// Start/Stop Stream and Start/Stop Record are new the same day, both as
// buttons here and as their own Pulse Engine actions (obs_start_stream/
// obs_stop_stream/obs_start_record/obs_stop_record on the website).
import { useEffect, useState } from 'react';
import { Radio, Circle, Play, Square, Cast, Power, PowerOff } from 'lucide-react';
import { Page, Section, Row, TextInput, Button, Toggle, COLORS } from '../components/ui';

// 2026-10-16 — "lets also work on the OBS integration and try to make it as
// dummy proof as possible." 4009 is obs-websocket's own documented
// AuthenticationFailed close code (see electron/obs-client.ts/main.ts for
// where errorCode actually comes from — the real WebSocket close event's
// own code, not a guess). Everything else (connection refused, DNS
// failure, a timeout) collapses to one "couldn't reach OBS at all" message,
// since none of those are usefully distinguishable to someone who isn't
// already comfortable debugging network errors.
function friendlyObsError(error?: string, code?: number): string | null {
  if (!error) return null;
  if (code === 4009) {
    return "Wrong password. In OBS: Tools → WebSocket Server Settings → Show Connect Info, then copy the Server Password shown there (not your OBS login, if you have one).";
  }
  return "Couldn't reach OBS. Make sure OBS is open and Tools → WebSocket Server Settings → \"Enable WebSocket server\" is checked — then try again.";
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function ObsControlPage() {
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [url, setUrl] = useState('ws://127.0.0.1:4455');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [items, setItems] = useState<ObsSceneItemInfo[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  // Live-ticking local clock for the duration readouts — OBS only pushes a
  // fresh outputDuration on each state CHANGE, not every second, so this
  // just advances the last-known value locally between those pushes.
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    window.kickpulseDesktop.getConfig().then((cfg) => {
      setUrl(cfg.obsUrl || 'ws://127.0.0.1:4455');
      setPassword(cfg.obsPassword || '');
    });
    window.kickpulseDesktop.obsGetStatus().then(setStatus);
    window.kickpulseDesktop.onObsStatus(setStatus);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (status?.currentScene && !selectedScene) setSelectedScene(status.currentScene);
  }, [status?.currentScene]);

  useEffect(() => {
    if (!status?.connected || !selectedScene) {
      setItems([]);
      return;
    }
    setItemsLoading(true);
    window.kickpulseDesktop
      .obsGetSceneItems(selectedScene)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setItemsLoading(false));
  }, [status?.connected, selectedScene, status?.currentScene]);

  const connect = async () => {
    setConnecting(true);
    await window.kickpulseDesktop.obsConnect(url, password);
    setConnecting(false);
  };
  const disconnect = () => window.kickpulseDesktop.obsDisconnect();
  const switchScene = (sceneName: string) => {
    setSelectedScene(sceneName);
    window.kickpulseDesktop.obsSwitchScene(sceneName);
  };
  const toggleSource = (item: ObsSceneItemInfo) => {
    if (!selectedScene) return;
    const next = !item.sceneItemEnabled;
    setItems((prev) => prev.map((i) => (i.sceneItemId === item.sceneItemId ? { ...i, sceneItemEnabled: next } : i)));
    window.kickpulseDesktop.obsToggleSource(selectedScene, item.sceneItemId, next).then((res) => {
      if (!res.ok) setItems((prev) => prev.map((i) => (i.sceneItemId === item.sceneItemId ? { ...i, sceneItemEnabled: !next } : i)));
    });
  };

  const toggleStream = async () => {
    setStreamBusy(true);
    await (status?.streaming ? window.kickpulseDesktop.obsStopStream() : window.kickpulseDesktop.obsStartStream());
    setStreamBusy(false);
  };
  const toggleRecord = async () => {
    setRecordBusy(true);
    await (status?.recording ? window.kickpulseDesktop.obsStopRecord() : window.kickpulseDesktop.obsStartRecord());
    setRecordBusy(false);
  };

  // Local clock advance — only while active, anchored to the last real push
  // from OBS (status.streamDurationMs/recordDurationMs) rather than drifting
  // on its own across re-renders.
  const [anchor, setAnchor] = useState<{ ms: number; at: number } | null>(null);
  useEffect(() => {
    if (status?.streaming) setAnchor({ ms: status.streamDurationMs, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.streaming, status?.streamDurationMs]);
  const liveStreamMs = status?.streaming && anchor ? anchor.ms + (now - anchor.at) : 0;

  const [recordAnchor, setRecordAnchor] = useState<{ ms: number; at: number } | null>(null);
  useEffect(() => {
    if (status?.recording) setRecordAnchor({ ms: status.recordDurationMs, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.recording, status?.recordDurationMs]);
  const liveRecordMs = status?.recording && recordAnchor ? recordAnchor.ms + (now - recordAnchor.at) : 0;

  return (
    <Page
      title="OBS Control"
      icon={<Cast size={22} color={COLORS.accent} />}
      subtitle="Connects directly to OBS's own built-in WebSocket server. Switch scenes, show/hide sources, start/stop streaming or recording — and a Pulse Engine rule can trigger any of these too."
    >
      {!status?.connected && (
        <Section title="Connect to OBS">
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: COLORS.textDim,
            background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14,
          }}>
            <div style={{ fontWeight: 600, color: COLORS.text, marginBottom: 2 }}>One-time setup, in OBS itself:</div>
            <div>1. Open OBS → <strong style={{ color: COLORS.text }}>Tools</strong> → <strong style={{ color: COLORS.text }}>WebSocket Server Settings</strong></div>
            <div>2. Check <strong style={{ color: COLORS.text }}>"Enable WebSocket server"</strong> if it isn't already</div>
            <div>3. Click <strong style={{ color: COLORS.text }}>"Show Connect Info"</strong> and copy the Server Password shown there</div>
            <div>4. Paste it below and hit Connect — the default address below already matches OBS's own default</div>
          </div>
          <Row label="Server URL"><TextInput value={url} onChange={setUrl} /></Row>
          <Row label="Password" hint="From Show Connect Info — blank only if you unchecked Enable Authentication"><TextInput value={password} onChange={setPassword} placeholder="•••" /></Row>
          <Button variant="primary" onClick={connect} disabled={connecting}>
            {connecting || status?.connecting ? 'Connecting…' : 'Connect'}
          </Button>
          {status?.error && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>{friendlyObsError(status.error, status.errorCode)}</div>
              <div style={{ color: COLORS.textDim, fontSize: 11, marginTop: 4 }}>({status.error})</div>
            </div>
          )}
        </Section>
      )}

      {status?.connected && (
        <>
          <Section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: COLORS.accent, fontWeight: 700, fontSize: 14 }}>● Connected to OBS</div>
                <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>Live scene: {status.currentScene || '—'}</div>
              </div>
              <Button onClick={disconnect}>Disconnect</Button>
            </div>
          </Section>

          <Section title="Stream & Record">
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: status.streaming ? 'rgba(239,68,68,0.12)' : COLORS.panel, border: `1px solid ${status.streaming ? '#ef4444' : COLORS.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Radio size={16} color={status.streaming ? '#ef4444' : COLORS.textDim} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: status.streaming ? '#fca5a5' : COLORS.text }}>
                      {status.streaming ? 'Streaming' : 'Not streaming'}
                    </div>
                    {status.streaming && <div style={{ fontSize: 11, color: COLORS.textDim }}>{formatDuration(liveStreamMs)}</div>}
                  </div>
                </div>
                <Button variant={status.streaming ? 'danger' : 'primary'} onClick={toggleStream} disabled={streamBusy}>
                  {status.streaming ? <Square size={13} /> : <Play size={13} />}
                  {status.streaming ? 'Stop' : 'Start'}
                </Button>
              </div>

              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: status.recording ? 'rgba(239,68,68,0.12)' : COLORS.panel, border: `1px solid ${status.recording ? '#ef4444' : COLORS.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Circle size={16} color={status.recording ? '#ef4444' : COLORS.textDim} fill={status.recording ? '#ef4444' : 'none'} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: status.recording ? '#fca5a5' : COLORS.text }}>
                      {status.recording ? 'Recording' : 'Not recording'}
                    </div>
                    {status.recording && <div style={{ fontSize: 11, color: COLORS.textDim }}>{formatDuration(liveRecordMs)}</div>}
                  </div>
                </div>
                <Button variant={status.recording ? 'danger' : 'primary'} onClick={toggleRecord} disabled={recordBusy}>
                  {status.recording ? <Square size={13} /> : <Play size={13} />}
                  {status.recording ? 'Stop' : 'Start'}
                </Button>
              </div>
            </div>
          </Section>

          <div style={{ display: 'flex', gap: 16 }}>
            <Section title="Scenes" style={{ flex: 1, margin: 0 }}>
              {status.scenes.map((s) => (
                <button
                  key={s.sceneUuid}
                  onClick={() => switchScene(s.sceneName)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4,
                    borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
                    background: s.sceneName === status.currentScene ? COLORS.accentDim : COLORS.panel,
                    color: s.sceneName === status.currentScene ? COLORS.text : COLORS.textDim,
                    fontWeight: s.sceneName === selectedScene ? 600 : 400,
                    outline: s.sceneName === selectedScene && s.sceneName !== status.currentScene ? `1px solid ${COLORS.border}` : 'none',
                  }}
                >
                  {s.sceneName === status.currentScene ? '● ' : ''}{s.sceneName}
                </button>
              ))}
            </Section>

            <Section title={`Sources${selectedScene ? ` in "${selectedScene}"` : ''}`} style={{ flex: 1, margin: 0 }}>
              {itemsLoading && <div style={{ fontSize: 12, color: COLORS.textDim }}>Loading…</div>}
              {!itemsLoading && items.length === 0 && <div style={{ fontSize: 12, color: COLORS.textDim }}>No sources in this scene.</div>}
              {items.map((item) => (
                <Row key={item.sceneItemId} label={item.sourceName}>
                  <Toggle checked={item.sceneItemEnabled} onChange={() => toggleSource(item)} />
                </Row>
              ))}
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}
