// src/pages/LightScenesPage.tsx — the steady-state "mood" a streamer's
// lights sit at. Pulled out of the Devices page onto its own sidebar entry
// (2026-10-18, direct request) — Scenes and Reactions (LightReactionsPage.tsx)
// are a real lifecycle split, not two tabs of one thing: a Scene persists
// until deliberately changed and is applied once on app launch; a Reaction
// is a temporary, timed interruption that hands control back to whichever
// Scene is active when it ends. See electron/types.ts's own LightScene
// comment for the full reasoning.
import { useEffect, useState } from 'react';
import { Sun, Plus, Trash2, Pencil, Check } from 'lucide-react';
import { Page, Section, Row, TextInput, Button, IconButton, EmptyState, COLORS } from '../components/ui';
import { TargetMapEditor, emptyTarget, ColorChips } from '../components/LightTargetEditor';

// One chip per distinct color/state actually set in this scene — capped so a
// scene with many separately-configured devices still reads as a quick
// glance, not a wall of swatches.
function sceneSwatchTargets(s: LightScene): LightPresetStepTarget[] {
  const seen = new Set<string>();
  const out: LightPresetStepTarget[] = [];
  for (const t of Object.values(s.targets)) {
    const key = `${t.color ?? ''}|${t.random ?? ''}|${t.on ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

export default function LightScenesPage() {
  const [devices, setDevices] = useState<LightDeviceConfig[]>([]);
  const [scenes, setScenes] = useState<LightScene[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LightScene | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [d, list, active] = await Promise.all([
      window.kickpulseDesktop.lightsListDevices(),
      window.kickpulseDesktop.lightsListScenes(),
      window.kickpulseDesktop.lightsGetActiveSceneId(),
    ]);
    setDevices(d);
    setScenes(list);
    setActiveId(active);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const newScene = () => setEditing({ id: '', name: '', targets: { all: emptyTarget() } });
  const edit = (s: LightScene) => setEditing(JSON.parse(JSON.stringify(s)));
  const closeEditor = () => setEditing(null);

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    await window.kickpulseDesktop.lightsSaveScene({ id: editing.id || undefined, name: editing.name, targets: editing.targets });
    setSaving(false);
    closeEditor();
    await load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this scene?')) return;
    await window.kickpulseDesktop.lightsDeleteScene(id);
    await load();
  };

  const activate = async (id: string) => {
    await window.kickpulseDesktop.lightsSetActiveScene(id);
    await load();
  };

  if (loading) return null;

  const activeScene = scenes.find((s) => s.id === activeId);

  return (
    <Page
      title="Light Scenes"
      icon={<Sun size={22} color={COLORS.accent} />}
      subtitle="The baseline mood your lights sit at — applied the moment the app opens, and restored automatically after any Light Reaction finishes."
    >
      {!editing ? (
        <>
          <Section title="Current Baseline">
            {activeScene ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS.success, boxShadow: `0 0 6px ${COLORS.success}` }} />
                <span style={{ fontSize: 13, color: COLORS.text }}>{activeScene.name}</span>
                <ColorChips targets={sceneSwatchTargets(activeScene)} size={18} />
              </div>
            ) : (
              <span style={{ fontSize: 12, color: COLORS.textFaint }}>No baseline set yet — activate a scene below.</span>
            )}
          </Section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button variant="primary" onClick={newScene}><Plus size={14} />New Scene</Button>
          </div>
          <Section title="Saved Scenes">
            {scenes.length === 0 ? (
              <EmptyState
                title="No scenes yet"
                body="A scene can be a single color across everything, or a different color per device/light zone."
                action={<Button variant="primary" onClick={newScene}>New Scene</Button>}
              />
            ) : (
              scenes.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <ColorChips targets={sceneSwatchTargets(s)} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim }}>
                      {Object.keys(s.targets).length > 1 ? `${Object.keys(s.targets).length} devices set separately` : 'Same for all devices'}
                    </div>
                  </div>
                  {s.id === activeId ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.success, fontWeight: 600 }}>
                      <Check size={14} />Active
                    </span>
                  ) : (
                    <Button onClick={() => activate(s.id)}>Activate</Button>
                  )}
                  <IconButton title="Edit" onClick={() => edit(s)}><Pencil size={13} /></IconButton>
                  <IconButton title="Delete" danger onClick={() => remove(s.id)}><Trash2 size={13} /></IconButton>
                </div>
              ))
            )}
          </Section>
        </>
      ) : (
        <Section title={editing.id ? 'Edit Scene' : 'New Scene'}>
          <Row label="Name">
            <TextInput value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="e.g. Cozy Stream" />
          </Row>
          <div style={{ marginTop: 14 }}>
            <TargetMapEditor targets={editing.targets} devices={devices} onChange={(targets) => setEditing({ ...editing, targets })} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button variant="primary" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? 'Saving…' : 'Save Scene'}</Button>
            <Button onClick={closeEditor}>Cancel</Button>
          </div>
        </Section>
      )}
    </Page>
  );
}
