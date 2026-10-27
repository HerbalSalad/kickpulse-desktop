// src/pages/StreamInfoPage.tsx — direct title/category control, no Pulse
// Engine rule needed (2026-10-27, direct request: "for the desktop app, go
// ahead and add the stream title category presets, I like that idea and
// most people only play a few games so that could work well"). Mirrors the
// website's own /stream-info page (src/pages/StreamInfo.tsx) — same live
// category search, same set_stream_title/set_kick_category/
// set_twitch_category actions, fired right now via
// window.kickpulseDesktop.pulseRules.runAction (POST /pulse-rules/run-action,
// no saved rule needed) instead of saved as a rule. A separate "Presets"
// list (saved locally via electron-store, see electron/store.ts) lets a
// streamer save a few categories they actually switch between — "most
// people only play a few games" — as one-click buttons, on top of the live
// search for anything else.
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Page, Section, Row, TextInput, Button, IconButton, COLORS } from '../components/ui';

interface CategoryOption { id: string | number; name: string }
interface Preset { id: string; name: string; categoryId: string | number; platform: 'kick' | 'twitch' }

function CategorySearch({ platform, onPick }: { platform: 'kick' | 'twitch'; onPick: (opt: CategoryOption) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CategoryOption[]>([]);
  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const r = await window.kickpulseDesktop.pulseRules.searchCategories(platform, q.trim()).catch(() => []);
    setResults(r);
  };
  return (
    <div>
      <TextInput value={query} onChange={search} placeholder={`Search ${platform === 'kick' ? 'Kick' : 'Twitch'} categories…`} />
      {results.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
          {results.map((r) => (
            <button key={r.id} onClick={() => { onPick(r); setQuery(''); setResults([]); }}
              style={{ textAlign: 'left', padding: '6px 10px', borderRadius: 8, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 13, cursor: 'pointer' }}>
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PRESETS_KEY = 'kp_category_presets';

export default function StreamInfoPage() {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetPlatform, setNewPresetPlatform] = useState<'kick' | 'twitch'>('kick');
  const [pendingCategory, setPendingCategory] = useState<CategoryOption | null>(null);

  useEffect(() => {
    try { setPresets(JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]')); } catch { /* starts empty */ }
  }, []);

  const savePresets = (next: Preset[]) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* best-effort only */ }
  };

  const run = async (action: Record<string, unknown>, label: string) => {
    setStatus(`${label}…`);
    try {
      await window.kickpulseDesktop.pulseRules.runAction(action);
      setStatus(`${label} ✓`);
    } catch (err: any) {
      setStatus(`${label} failed: ${err?.message || 'unknown error'}`);
    }
  };

  const updateTitle = () => {
    if (!title.trim()) return;
    run({ type: 'set_stream_title', title: title.trim(), platform: 'both' }, 'Title updated');
  };

  const applyCategory = (opt: CategoryOption, platform: 'kick' | 'twitch') => {
    run(
      platform === 'kick' ? { type: 'set_kick_category', categoryId: opt.id } : { type: 'set_twitch_category', gameId: String(opt.id) },
      `Category set to "${opt.name}"`
    );
  };

  const addPreset = () => {
    if (!pendingCategory || !newPresetName.trim()) return;
    savePresets([...presets, { id: `preset_${Date.now()}`, name: newPresetName.trim(), categoryId: pendingCategory.id, platform: newPresetPlatform }]);
    setPendingCategory(null);
    setNewPresetName('');
  };

  return (
    <Page title="Stream Info" icon={<Pencil size={22} color={COLORS.accent} />}
      subtitle="Change your title and category on Kick and Twitch — no Pulse Engine rule needed.">
      <Section title="Title">
        <Row label="New title">
          <TextInput value={title} onChange={setTitle} placeholder="What's happening on stream?" />
        </Row>
        <Button variant="primary" onClick={updateTitle}>Update Title (Kick + Twitch)</Button>
      </Section>

      <Section title="Category Presets" right={<span style={{ fontSize: 12, color: COLORS.textFaint }}>most people only play a few games</span>}>
        {presets.length === 0 ? (
          <p style={{ fontSize: 13, color: COLORS.textFaint }}>No presets saved yet — search below and save one.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {presets.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Button onClick={() => applyCategory({ id: p.categoryId, name: p.name }, p.platform)}>
                  {p.name} ({p.platform === 'kick' ? 'Kick' : 'Twitch'})
                </Button>
                <IconButton title="Remove preset" danger onClick={() => savePresets(presets.filter((x) => x.id !== p.id))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        <Row label="Platform">
          <select value={newPresetPlatform} onChange={(e) => setNewPresetPlatform(e.target.value as 'kick' | 'twitch')}
            style={{ background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: '6px 10px', fontSize: 13 }}>
            <option value="kick">Kick</option>
            <option value="twitch">Twitch</option>
          </select>
        </Row>
        <CategorySearch platform={newPresetPlatform} onPick={setPendingCategory} />
        {pendingCategory && (
          <Row label={`Save "${pendingCategory.name}" as…`}>
            <TextInput value={newPresetName} onChange={setNewPresetName} placeholder="Button name, e.g. Valorant" />
            <Button variant="primary" onClick={addPreset}><Plus size={13} /> Save Preset</Button>
          </Row>
        )}
      </Section>

      {status && <p style={{ fontSize: 12.5, color: COLORS.textDim }}>{status}</p>}
    </Page>
  );
}
