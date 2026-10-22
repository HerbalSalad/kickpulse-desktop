// src/pages/LightReactionsPage.tsx — timed, event-triggered temporary
// lighting effects (unifies what Lumia Stream calls Reactions AND
// Animations — see electron/light-reactions.ts's own header for the
// research behind that). Pulled out of the Devices page onto its own
// sidebar entry (2026-10-18, direct request), alongside Light Scenes
// (LightScenesPage.tsx) — a Reaction plays through its steps (once, or
// looping until stopped) and then hands control back to whichever Light
// Scene is currently active: "it can have a reaction, and then return to
// the same mood that it was afterwards" was the direct ask that drove the
// Scene/Reaction split.
import { useEffect, useState } from 'react';
import { Zap, Plus, Trash2, Pencil, Play, Square } from 'lucide-react';
import { Page, Section, Row, TextInput, NumberInput, Button, IconButton, EmptyState, COLORS, Select } from '../components/ui';
import { TargetMapEditor, emptyTarget, ColorChips } from '../components/LightTargetEditor';

function emptyStep(): LightReactionStep {
  return { durationMs: 1000, targets: { all: emptyTarget() } };
}

// One chip per STEP, in order — a reaction's steps already encode its real
// sequencing (step 1 red, step 2 blue IS what makes "Police Lights" police
// lights), so showing them in order is what makes the preview actually
// recognizable, not just "these colors exist somewhere in here." Picks one
// representative target per step (the 'all' target, or the first
// per-device one) rather than every device in every step — a step set
// differently per device is still, at a glance, "what did this step mostly
// do."
function reactionSwatchTargets(r: LightReaction): (LightPresetStepTarget | undefined)[] {
  return r.steps.map((step) => step.targets.all ?? Object.values(step.targets)[0]);
}

export default function LightReactionsPage() {
  const [devices, setDevices] = useState<LightDeviceConfig[]>([]);
  const [reactions, setReactions] = useState<LightReaction[]>([]);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<LightReaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [d, list, running] = await Promise.all([
      window.kickpulseDesktop.lightsListDevices(),
      window.kickpulseDesktop.lightsListReactions(),
      window.kickpulseDesktop.lightsListRunningReactions(),
    ]);
    setDevices(d);
    setReactions(list);
    setRunningIds(running);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const newReaction = () => setEditing({ id: '', name: '', playMode: 'once', steps: [emptyStep()] });
  const edit = (r: LightReaction) => setEditing(JSON.parse(JSON.stringify(r)));
  const closeEditor = () => setEditing(null);

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    await window.kickpulseDesktop.lightsSaveReaction({
      id: editing.id || undefined, name: editing.name, playMode: editing.playMode, durationSeconds: editing.durationSeconds, steps: editing.steps,
      soundUrl: editing.soundUrl, soundVolume: editing.soundVolume,
    });
    setSaving(false);
    closeEditor();
    await load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this reaction?')) return;
    await window.kickpulseDesktop.lightsDeleteReaction(id);
    await load();
  };

  const play = async (id: string) => { await window.kickpulseDesktop.lightsFireReaction(id); await load(); };
  const stop = async (id: string) => { await window.kickpulseDesktop.lightsStopReaction(id); await load(); };

  const browseSound = async () => {
    if (!editing) return;
    const item = await window.kickpulseDesktop.addMediaFile();
    if (!item) return;
    const info = await window.kickpulseDesktop.getMediaServerInfo();
    setEditing({ ...editing, soundUrl: `${info.baseUrl}/media/${item.id}` });
  };

  const describeReaction = (r: LightReaction): string => {
    const stepWord = `${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`;
    if (r.playMode === 'loop') return `${stepWord} — loops until stopped`;
    if (r.playMode === 'timed') return `${stepWord} — plays for ${r.durationSeconds ?? 10}s`;
    return `${stepWord} — plays once`;
  };

  if (loading) return null;

  return (
    <Page
      title="Light Reactions"
      icon={<Zap size={22} color={COLORS.accent} />}
      subtitle="Timed, event-triggered lighting effects — Pulse Engine can fire any of these by name, and your Light Scene baseline comes back automatically when it ends."
    >
      {!editing ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button variant="primary" onClick={newReaction}><Plus size={14} />New Reaction</Button>
          </div>
          <Section title="Saved Reactions">
            {reactions.length === 0 ? (
              <EmptyState
                title="No reactions yet"
                body="A reaction can be a one-shot flash (police lights, a flashbang) or a looping ambient effect — it always hands control back to your active Light Scene when it ends."
                action={<Button variant="primary" onClick={newReaction}>New Reaction</Button>}
              />
            ) : (
              reactions.map((r) => {
                const isRunning = runningIds.includes(r.id);
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: `1px solid ${COLORS.border}` }}>
                    <ColorChips targets={reactionSwatchTargets(r)} size={18} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: COLORS.textDim }}>{describeReaction(r)}</div>
                    </div>
                    {isRunning ? (
                      <Button onClick={() => stop(r.id)}><Square size={13} />Stop</Button>
                    ) : (
                      <Button onClick={() => play(r.id)}><Play size={13} />Play</Button>
                    )}
                    <IconButton title="Edit" onClick={() => edit(r)}><Pencil size={13} /></IconButton>
                    <IconButton title="Delete" danger onClick={() => remove(r.id)}><Trash2 size={13} /></IconButton>
                  </div>
                );
              })
            )}
          </Section>
        </>
      ) : (
        <Section title={editing.id ? 'Edit Reaction' : 'New Reaction'}>
          <Row label="Name">
            <TextInput value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="e.g. Police Lights" />
          </Row>

          <div style={{ marginTop: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {editing.steps.map((step, i) => (
              <div key={i} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14, background: 'rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent, textTransform: 'uppercase', letterSpacing: 0.4 }}>Step {i + 1}</span>
                  {editing.steps.length > 1 && (
                    <IconButton title="Remove step" danger onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, x) => x !== i) })}>
                      <Trash2 size={12} />
                    </IconButton>
                  )}
                </div>
                {editing.steps.length > 1 && (
                  <Row label="Hold for">
                    <NumberInput value={Math.round((step.durationMs || 1000) / 100) / 10} min={0.1} step={0.1}
                      onChange={(v) => setEditing({ ...editing, steps: editing.steps.map((s, x) => x === i ? { ...s, durationMs: Math.max(50, Math.round(v * 1000)) } : s) })}
                      style={{ width: 80 }} />
                    <span style={{ fontSize: 12, color: COLORS.textDim, marginLeft: 8 }}>seconds, then the next step</span>
                  </Row>
                )}
                <TargetMapEditor targets={step.targets} devices={devices}
                  onChange={(targets) => setEditing({ ...editing, steps: editing.steps.map((s, x) => (x === i ? { ...s, targets } : s)) })} />
              </div>
            ))}
            <Button onClick={() => setEditing({ ...editing, steps: [...editing.steps, emptyStep()] })}>
              <Plus size={13} />Add a step (sequence this with the one above)
            </Button>
          </div>

          {editing.steps.length > 1 && (
            <Row label="When it plays" hint="Plays through once, loops until stopped, or loops for a set amount of time">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Select value={editing.playMode} onChange={(v) => setEditing({ ...editing, playMode: v as LightReactionPlayMode })}
                  options={[
                    { value: 'once', label: 'Play once' },
                    { value: 'loop', label: 'Loop until stopped' },
                    { value: 'timed', label: 'Loop for a set time' },
                  ]}
                  style={{ width: 220 }} />
                {editing.playMode === 'timed' && (
                  <>
                    <NumberInput value={editing.durationSeconds ?? 10} min={1} max={3600}
                      onChange={(v) => setEditing({ ...editing, durationSeconds: v })} style={{ width: 80 }} />
                    <span style={{ fontSize: 12, color: COLORS.textDim }}>seconds, then back to normal</span>
                  </>
                )}
              </div>
            </Row>
          )}

          <Row label="Sound" hint="Optional — plays once when this reaction fires">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TextInput value={editing.soundUrl ?? ''} onChange={(v) => setEditing({ ...editing, soundUrl: v || undefined })} placeholder="https://…/sound.mp3" style={{ flex: 1 }} />
              <Button onClick={browseSound}>Browse on this PC</Button>
            </div>
          </Row>
          {editing.soundUrl && (
            <Row label={`Volume (${editing.soundVolume ?? 100}%)`}>
              <NumberInput value={editing.soundVolume ?? 100} min={0} max={100} onChange={(v) => setEditing({ ...editing, soundVolume: v })} style={{ width: 80 }} />
            </Row>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button variant="primary" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? 'Saving…' : 'Save Reaction'}</Button>
            <Button onClick={closeEditor}>Cancel</Button>
          </div>
        </Section>
      )}
    </Page>
  );
}
