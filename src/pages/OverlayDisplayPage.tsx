// src/pages/OverlayDisplayPage.tsx — 2026-10-18, direct request: "add some
// config for the screen overlay portion, so people actually know they have
// it setup, and maybe can choose what screen it triggers on, in case we
// dont get the right one." The always-on overlay window (electron/
// overlay-window.ts) used to silently grab screen.getPrimaryDisplay() with
// no way to change it and nothing on screen confirming it was even running
// — a real problem on any multi-monitor setup, since "Windows' primary
// display" and "the monitor OBS/the game is actually on" are two
// independent things that can easily disagree.
import { useEffect, useState } from 'react';
import { Monitor, Sparkles, Clapperboard } from 'lucide-react';
import { Page, Section, Button, COLORS } from '../components/ui';

export default function OverlayDisplayPage() {
  const [displays, setDisplays] = useState<DisplayOption[]>([]);
  const [configuredId, setConfiguredId] = useState<number | null>(null);
  const [current, setCurrent] = useState<DisplayOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [flashing, setFlashing] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);

  const refresh = async () => {
    const [list, status] = await Promise.all([
      window.kickpulseDesktop.overlayListDisplays(),
      window.kickpulseDesktop.overlayGetCurrent(),
    ]);
    setDisplays(list);
    setConfiguredId(status.configuredId);
    setCurrent(status.current);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const pick = async (id: number | null) => {
    const resolved = await window.kickpulseDesktop.overlaySetDisplay(id);
    setConfiguredId(id);
    setCurrent(resolved);
  };

  const highlight = async () => {
    setFlashing(true);
    await window.kickpulseDesktop.overlayTestHighlight();
    setTimeout(() => setFlashing(false), 4000);
  };

  // Test a Scene Now (2026-10-19) — moved here from the old Home page,
  // direct feedback: "get rid of the test buttons, they can go to the
  // overlay display page as thats the only place they are really
  // relevant." Jumpscare's own test button was dropped outright, not moved
  // — not kept here either.
  const testScene = async () => {
    setSceneError(null);
    const res = await window.kickpulseDesktop.testScene();
    if (!res.ok) setSceneError(res.error || 'Could not play a scene');
  };

  if (loading) return null;

  return (
    <Page
      title="Overlay Display"
      icon={<Monitor size={22} color={COLORS.accent} />}
      subtitle="Which physical monitor jumpscares and Scenes actually appear on — separate from which OBS scene/source shows your widgets."
    >
      <Section title="Status">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS.success, boxShadow: `0 0 6px ${COLORS.success}`, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: COLORS.text }}>
            Overlay is active{current ? <> — currently showing on <strong>{current.label}</strong></> : ''}
          </span>
        </div>
        {!current && (
          <p style={{ fontSize: 12, color: '#f59e0b', margin: '0 0 10px' }}>
            Couldn't confirm the configured display is actually connected right now — it may have fallen back to your primary monitor.
          </p>
        )}
        <Button onClick={highlight} disabled={flashing}>
          <Sparkles size={14} />{flashing ? 'Check your monitors…' : 'Highlight This Screen'}
        </Button>
        <p style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 8, marginBottom: 0 }}>
          Flashes a large banner for 4 seconds on the real overlay window, so you can see with your own eyes which
          physical monitor it's actually on — the only way to be sure, since "Display 1/2/3" doesn't always match
          how your monitors are physically arranged.
        </p>
      </Section>

      <Section title="Test a Scene">
        <Button onClick={testScene}>
          <Clapperboard size={14} /> Test a Scene Now
        </Button>
        <p style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 8, marginBottom: 0 }}>
          Plays the first Pulse Scene on your account (website → Scenes) with placeholder text — or a bundled
          sample scene if you haven't built one yet — on the real overlay window above, so you can confirm both
          that it looks right AND that it's showing up on the monitor you expect. Or press Ctrl+Alt+S anytime.
        </p>
        {sceneError && <div style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{sceneError}</div>}
      </Section>

      <Section title="Which screen?">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <OptionRow
            label="Follow Windows' Primary Display (recommended)"
            hint="Automatically follows whichever monitor Windows currently calls primary, even if that changes later"
            selected={configuredId === null}
            onClick={() => pick(null)}
          />
          {displays.map((d) => (
            <OptionRow key={d.id} label={d.label} selected={configuredId === d.id} onClick={() => pick(d.id)} />
          ))}
        </div>
        {displays.length <= 1 && (
          <p style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 10, marginBottom: 0 }}>
            Only one monitor detected right now — this list fills in with every connected display.
          </p>
        )}
      </Section>

      <Section title="Known limitation">
        <p style={{ fontSize: 12, color: COLORS.textDim, margin: 0 }}>
          This only reliably draws over borderless/windowed games (and anything running in a normal desktop
          compositor). A true fullscreen-exclusive game bypasses that entirely and the overlay may simply not
          appear above it — try switching the game to borderless/windowed mode if jumpscares or Scenes don't show
          up while playing.
        </p>
      </Section>
    </Page>
  );
}

function OptionRow({ label, hint, selected, onClick }: { label: string; hint?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
        background: selected ? COLORS.accentDim : 'rgba(255,255,255,0.03)',
        border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${selected ? COLORS.accent : COLORS.textFaint}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.accent }} />}
      </span>
      <span>
        <div style={{ fontSize: 13, color: COLORS.text }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 2 }}>{hint}</div>}
      </span>
    </button>
  );
}
