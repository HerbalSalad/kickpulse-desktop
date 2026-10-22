// src/pages/DevicesPage.tsx — renamed from LightsPage.tsx (2026-10-18,
// direct request: "lights should probably be called devices, as there are
// smart plugs and other things we could hook up (printers even)"). Every
// provider today (WLED/Hue/Govee) IS still a light, but the page/nav name
// no longer bakes that assumption in for whatever gets added next.
//
// Pure hardware management now — pairing/discovery/live on-off-color
// controls. "Presets" (Colors/Scenes/Reactions/Animations) used to live
// here as a second tab; split out onto their own sidebar pages instead
// (LightScenesPage.tsx / LightReactionsPage.tsx, 2026-10-18 direct
// request: "pull those tabs out of devices and just put them on the
// sidebar") once it became clear Scenes and Reactions are a real lifecycle
// difference, not two tabs of one thing — see electron/types.ts's own
// LightScene/LightReaction comment.
import { useEffect, useState } from 'react';
import {
  Plug, Plus, Trash2, RefreshCw, Wifi, Link2, Radar,
} from 'lucide-react';
import {
  Page, Section, Row, TextInput, NumberInput, ColorInput, Button, IconButton, Toggle,
  EmptyState, COLORS,
} from '../components/ui';

export default function DevicesPage() {
  const [devices, setDevices] = useState<LightDeviceConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.kickpulseDesktop.lightsListDevices().then((d) => { setDevices(d); setLoading(false); });
  }, []);

  if (loading) return null;

  return (
    <Page
      title="Devices"
      icon={<Plug size={22} color={COLORS.accent} />}
      subtitle="Smart lights (and whatever else plugs in later) — pair hardware here, then build Light Scenes/Reactions on their own pages."
    >
      <MyDevicesTab devices={devices} onDevicesChange={setDevices} />
    </Page>
  );
}

function MyDevicesTab({ devices, onDevicesChange }: { devices: LightDeviceConfig[]; onDevicesChange: (d: LightDeviceConfig[]) => void }) {
  const [states, setStates] = useState<Record<string, LightState>>({});
  const [refreshing, setRefreshing] = useState(false);

  const [wledIp, setWledIp] = useState('');
  const [wledBusy, setWledBusy] = useState(false);
  const [wledError, setWledError] = useState<string | null>(null);
  const [wledScanning, setWledScanning] = useState(false);
  const [wledScanProgress, setWledScanProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [wledFound, setWledFound] = useState<WledDiscoveryResult[]>([]);

  const [goveeScanning, setGoveeScanning] = useState(false);
  const [goveeFound, setGoveeFound] = useState<GoveeDiscoveryResult[]>([]);
  const [goveeError, setGoveeError] = useState<string | null>(null);
  const [goveeManualIp, setGoveeManualIp] = useState('');
  const [goveeBusy, setGoveeBusy] = useState(false);

  const [hueStep, setHueStep] = useState<'idle' | 'discovering' | 'pairing' | 'pick-lights'>('idle');
  const [discoveredBridges, setDiscoveredBridges] = useState<DiscoveredBridge[]>([]);
  const [pairingBridgeIp, setPairingBridgeIp] = useState('');
  const [manualBridgeIp, setManualBridgeIp] = useState('');
  const [hueError, setHueError] = useState<string | null>(null);
  const [pairedBridges, setPairedBridges] = useState<HueBridgeConfig[]>([]);
  const [bridgeLights, setBridgeLights] = useState<Record<string, HueLightInfo[]>>({});

  const refreshStates = async () => {
    setRefreshing(true);
    const live = await window.kickpulseDesktop.lightsListLiveStates();
    setStates(Object.fromEntries(live.map((s) => [s.id, s])));
    setRefreshing(false);
  };

  const loadAll = async () => {
    const [d, bridges] = await Promise.all([
      window.kickpulseDesktop.lightsListDevices(),
      window.kickpulseDesktop.lightsListPairedHueBridges(),
    ]);
    onDevicesChange(d);
    setPairedBridges(bridges);
    await refreshStates();
  };

  useEffect(() => { refreshStates(); }, []);
  useEffect(() => { window.kickpulseDesktop.onLightsDiscoverWledProgress(setWledScanProgress); }, []);

  const addWled = async () => {
    if (!wledIp.trim()) return;
    setWledBusy(true); setWledError(null);
    const res = await window.kickpulseDesktop.lightsAddWled(wledIp.trim());
    setWledBusy(false);
    if (!res.ok) { setWledError(res.error || 'Failed to add device'); return; }
    setWledIp(''); await loadAll();
  };

  const scanForWled = async () => {
    setWledScanning(true); setWledError(null); setWledFound([]); setWledScanProgress(null);
    try { setWledFound(await window.kickpulseDesktop.lightsDiscoverWled()); }
    catch (err: any) { setWledError(err?.message || 'Scan failed'); }
    finally { setWledScanning(false); setWledScanProgress(null); }
  };

  const addDiscoveredWled = async (ip: string, name: string) => {
    setWledBusy(true); setWledError(null);
    const res = await window.kickpulseDesktop.lightsAddWled(ip, name);
    setWledBusy(false);
    if (!res.ok) { setWledError(res.error || 'Failed to add device'); return; }
    setWledFound((prev) => prev.filter((d) => d.ip !== ip)); await loadAll();
  };

  const scanForGovee = async () => {
    setGoveeScanning(true); setGoveeError(null); setGoveeFound([]);
    const outcome = await window.kickpulseDesktop.lightsDiscoverGovee();
    setGoveeScanning(false);
    if (!outcome.ok) { setGoveeError(outcome.error || 'Scan failed'); return; }
    setGoveeFound(outcome.devices);
    if (outcome.devices.length === 0) {
      setGoveeError('No Govee devices answered. Make sure "LAN Control" is switched on for each light in the Govee Home app — it\'s off by default.');
    }
  };

  const addDiscoveredGovee = async (ip: string, sku?: string) => {
    setGoveeBusy(true); setGoveeError(null);
    const res = await window.kickpulseDesktop.lightsAddGovee(ip, undefined, sku);
    setGoveeBusy(false);
    if (!res.ok) { setGoveeError(res.error || 'Failed to add device'); return; }
    setGoveeFound((prev) => prev.filter((d) => d.ip !== ip)); await loadAll();
  };

  const addGoveeManualIp = async () => {
    if (!goveeManualIp.trim()) return;
    await addDiscoveredGovee(goveeManualIp.trim());
    setGoveeManualIp('');
  };

  const startHueDiscovery = async () => {
    setHueStep('discovering'); setHueError(null);
    setDiscoveredBridges(await window.kickpulseDesktop.lightsDiscoverHueBridges());
    setHueStep('idle');
  };

  const startPairing = (ip: string) => {
    setPairingBridgeIp(ip); setHueStep('pairing'); setHueError(null);
    let cancelled = false;
    const tryOnce = async () => {
      if (cancelled) return;
      const res = await window.kickpulseDesktop.lightsPairHueBridge(ip);
      if (cancelled) return;
      if (res.ok) { setHueStep('idle'); await loadAll(); return; }
      if (!res.needsButtonPress) { setHueError(res.error); setHueStep('idle'); return; }
      setTimeout(tryOnce, 1500);
    };
    tryOnce();
    return () => { cancelled = true; };
  };
  const cancelPairing = () => { setHueStep('idle'); setPairingBridgeIp(''); };

  const loadBridgeLights = async (bridgeIp: string) => {
    const res = await window.kickpulseDesktop.lightsListHueBridgeLights(bridgeIp);
    if (res.ok) setBridgeLights((prev) => ({ ...prev, [bridgeIp]: res.lights }));
    else setHueError(res.error || 'Failed to load lights');
  };

  const addHueLight = async (bridgeIp: string, light: HueLightInfo) => {
    const res = await window.kickpulseDesktop.lightsAddHueLight(bridgeIp, light.id, light.name);
    if (!res.ok) { setHueError(res.error || 'Failed to add that light'); return; }
    await loadAll();
  };

  const removeDeviceById = async (id: string) => { await window.kickpulseDesktop.lightsRemoveDevice(id); await loadAll(); };

  const setLight = (id: string, patch: { on?: boolean; brightness?: number; color?: string }) => {
    setStates((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
    window.kickpulseDesktop.lightsSetState(id, patch);
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button onClick={refreshStates} disabled={refreshing}><RefreshCw size={14} />{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
      </div>
      <Section title="Your Devices">
        {devices.length === 0 ? (
          <EmptyState title="No devices added yet" body="Add a WLED device or pair a Philips Hue bridge below." />
        ) : (
          devices.map((d) => {
            const s = states[d.id];
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s?.reachable ? COLORS.success : COLORS.textFaint, flexShrink: 0 }} title={s?.reachable ? 'Reachable' : 'Unreachable'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: COLORS.textDim }}>
                    {d.provider === 'wled' ? `WLED · ${d.ip}` : d.provider === 'govee' ? `Govee · ${d.ip}` : 'Philips Hue'}
                  </div>
                </div>
                {s?.reachable && (
                  <>
                    <Toggle checked={s.on} onChange={(v) => setLight(d.id, { on: v })} />
                    <ColorInput value={s.color} onChange={(v) => setLight(d.id, { color: v, on: true })} bare />
                    <div style={{ width: 90 }}>
                      <NumberInput value={s.brightness} onChange={(v) => setLight(d.id, { brightness: v })} min={0} max={100} />
                    </div>
                  </>
                )}
                <IconButton title="Remove" danger onClick={() => removeDeviceById(d.id)}><Trash2 size={13} /></IconButton>
              </div>
            );
          })
        )}
      </Section>

      <Section title="Add a WLED Device" right={<Wifi size={15} color={COLORS.textDim} />}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button onClick={scanForWled} disabled={wledScanning}>
            <Radar size={13} />
            {wledScanning ? (wledScanProgress ? `Scanning… ${wledScanProgress.scanned}/${wledScanProgress.total}` : 'Scanning…') : 'Scan my network'}
          </Button>
        </div>
        {wledFound.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {wledFound.map((d) => {
              const already = devices.some((x) => x.provider === 'wled' && x.ip === d.ip);
              return (
                <div key={d.ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px' }}>
                  <span style={{ fontSize: 13 }}>{d.name} <span style={{ color: COLORS.textDim, fontSize: 11 }}>({d.ip})</span></span>
                  <Button variant="primary" disabled={already || wledBusy} onClick={() => addDiscoveredWled(d.ip, d.name)}>{already ? 'Added' : 'Add'}</Button>
                </div>
              );
            })}
          </div>
        )}
        {!wledScanning && wledFound.length === 0 && (
          <Row label="Or enter the local IP manually" hint="Found in your router's device list, or WLED's own AP setup page">
            <div style={{ display: 'flex', gap: 8 }}>
              <TextInput value={wledIp} onChange={setWledIp} placeholder="192.168.1.50" style={{ flex: 1 }} />
              <Button variant="primary" onClick={addWled} disabled={wledBusy || !wledIp.trim()}><Plus size={13} />{wledBusy ? 'Checking…' : 'Add'}</Button>
            </div>
          </Row>
        )}
        {wledError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{wledError}</div>}
      </Section>

      <Section title="Add a Govee Light" right={<Radar size={15} color={COLORS.textDim} />}>
        <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
          Needs "LAN Control" switched on for each light in the Govee Home app first (Device Settings → LAN Control) — it's off by default.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button onClick={scanForGovee} disabled={goveeScanning}><Radar size={13} />{goveeScanning ? 'Scanning…' : 'Scan my network'}</Button>
        </div>
        {goveeFound.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {goveeFound.map((d) => {
              const already = devices.some((x) => x.provider === 'govee' && x.ip === d.ip);
              return (
                <div key={d.ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px' }}>
                  <span style={{ fontSize: 13 }}>{d.sku || 'Govee light'} <span style={{ color: COLORS.textDim, fontSize: 11 }}>({d.ip})</span></span>
                  <Button variant="primary" disabled={already || goveeBusy} onClick={() => addDiscoveredGovee(d.ip, d.sku)}>{already ? 'Added' : 'Add'}</Button>
                </div>
              );
            })}
          </div>
        )}
        <Row label="Or enter the local IP manually">
          <div style={{ display: 'flex', gap: 8 }}>
            <TextInput value={goveeManualIp} onChange={setGoveeManualIp} placeholder="192.168.1.60" style={{ flex: 1 }} />
            <Button variant="primary" onClick={addGoveeManualIp} disabled={goveeBusy || !goveeManualIp.trim()}><Plus size={13} />{goveeBusy ? 'Adding…' : 'Add'}</Button>
          </div>
        </Row>
        {goveeError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{goveeError}</div>}
      </Section>

      <Section title="Add a Philips Hue Bridge" right={<Link2 size={15} color={COLORS.textDim} />}>
        {hueStep === 'idle' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <Button onClick={startHueDiscovery}><RefreshCw size={13} />Find bridges on my network</Button>
            </div>
            {discoveredBridges.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {discoveredBridges.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px' }}>
                    <span style={{ fontSize: 13 }}>{b.ip}</span>
                    <Button variant="primary" onClick={() => startPairing(b.ip)}>Pair</Button>
                  </div>
                ))}
              </div>
            )}
            <Row label="Or enter the bridge IP manually">
              <div style={{ display: 'flex', gap: 8 }}>
                <TextInput value={manualBridgeIp} onChange={setManualBridgeIp} placeholder="192.168.1.20" style={{ flex: 1 }} />
                <Button variant="primary" onClick={() => startPairing(manualBridgeIp.trim())} disabled={!manualBridgeIp.trim()}>Pair</Button>
              </div>
            </Row>
            {hueError && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{hueError}</div>}
          </>
        )}
        {hueStep === 'pairing' && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Press the link button on your Hue bridge</div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 14 }}>Waiting for a press — this checks every couple seconds, no rush.</div>
            <Button onClick={cancelPairing}>Cancel</Button>
          </div>
        )}
        {pairedBridges.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Paired bridges</div>
            {pairedBridges.map((b) => (
              <div key={b.bridgeIp} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: COLORS.text }}>{b.bridgeIp}</span>
                  <Button onClick={() => loadBridgeLights(b.bridgeIp)}>Browse lights</Button>
                </div>
                {bridgeLights[b.bridgeIp] && (
                  <div style={{ marginTop: 6, paddingLeft: 10 }}>
                    {bridgeLights[b.bridgeIp].length === 0 && <div style={{ fontSize: 12, color: COLORS.textFaint }}>No lights found on this bridge.</div>}
                    {bridgeLights[b.bridgeIp].map((l) => {
                      const already = devices.some((d) => d.provider === 'hue' && d.bridgeIp === b.bridgeIp && d.hueLightId === l.id);
                      return (
                        <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span style={{ fontSize: 12, color: COLORS.textDim }}>{l.name}</span>
                          <Button disabled={already} onClick={() => addHueLight(b.bridgeIp, l)}>{already ? 'Added' : 'Add'}</Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
