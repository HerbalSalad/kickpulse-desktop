// src/pages/StreamInfoPage.tsx — direct title/category control, no Pulse
// Engine rule needed (2026-10-27, direct request: "for the desktop app, go
// ahead and add the stream title category presets, I like that idea and
// most people only play a few games so that could work well"). Mirrors the
// website's own /stream-info page (src/pages/StreamInfo.tsx).
//
// Rebuilt 2026-10-28 (direct, blunt feedback: "desktop app needs a way to
// quickly update the category for both kick and twitch without using a
// preset. Presets need to be able to do kick and twitch, its dumb to have
// to have one for each.") — the original version applied one platform at
// a time (pick a category, it fires immediately for just that platform)
// and its presets were localStorage-only, one platform per preset. Now:
// two independent category pickers (Kick + Twitch) feed ONE "Update
// Categories" button that applies both together, and Presets are real,
// server-backed rows (electron/api.ts's listStreamInfoPresets/etc, same
// /stream-info/presets routes the website's own page and the Stream Deck
// plugin's Stream Info button already use) — one preset can hold BOTH
// platforms' category (plus a title) at once, applied together in one
// click, exactly like the website.
import { useCallback, useEffect, useState } from 'react';
import { Pencil, RefreshCw, Trash2, Zap } from 'lucide-react';
import { Page, Section, Row, TextInput, Button, IconButton, COLORS } from '../components/ui';

interface CategoryOption { id: string | number; name: string }
interface Preset {
  id: string;
  name: string;
  title: string | null;
  kick_category_id: string | null;
  kick_category_name: string | null;
  twitch_game_id: string | null;
  twitch_game_name: string | null;
}

function CategorySearch({ platform, selected, onPick }: {
  platform: 'kick' | 'twitch';
  selected: CategoryOption | null;
  onPick: (opt: CategoryOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CategoryOption[]>([]);

  useEffect(() => { setQuery(selected?.name ?? ''); }, [selected?.name]);

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) onPick(null);
    if (q.trim().length < 2) { setResults([]); return; }
    const r = await window.kickpulseDesktop.pulseRules.searchCategories(platform, q.trim()).catch(() => []);
    setResults(r);
  };

  return (
    <div>
      <TextInput value={query} onChange={search} placeholder={`Search ${platform === 'kick' ? 'Kick' : 'Twitch'} categories…`} />
      {results.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
          {results.map((r) => (
            <button key={r.id} onClick={() => { onPick(r); setQuery(r.name); setResults([]); }}
              style={{ textAlign: 'left', padding: '6px 10px', borderRadius: 8, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 13, cursor: 'pointer' }}>
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StreamInfoPage() {
  const [title, setTitle] = useState('');
  const [kickCategory, setKickCategory] = useState<CategoryOption | null>(null);
  const [twitchCategory, setTwitchCategory] = useState<CategoryOption | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [applyingPresetId, setApplyingPresetId] = useState<string | null>(null);

  const loadPresets = useCallback(() => {
    setLoadingPresets(true);
    window.kickpulseDesktop.streamInfo.listPresets()
      .then((rows) => setPresets(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setLoadingPresets(false));
  }, []);

  useEffect(loadPresets, [loadPresets]);

  // Updates the title AND whichever category picker(s) actually have a
  // pending selection, together, in one press — the direct ask: "a way to
  // quickly update the category for both kick and twitch... without using
  // a preset." Kick and Twitch have entirely separate category id spaces,
  // so this still fires two underlying actions, just from one button
  // instead of two separate ones.
  const updateStreamInfo = async () => {
    if (!title.trim() && !kickCategory && !twitchCategory) return;
    setApplying(true);
    setStatus(null);
    const results: string[] = [];
    try {
      if (title.trim()) {
        await window.kickpulseDesktop.pulseRules.runAction({ type: 'set_stream_title', title: title.trim(), platform: 'both' });
        results.push('Title ✓');
      }
      if (kickCategory) {
        await window.kickpulseDesktop.pulseRules.runAction({ type: 'set_kick_category', categoryId: kickCategory.id });
        results.push(`Kick: ${kickCategory.name} ✓`);
      }
      if (twitchCategory) {
        await window.kickpulseDesktop.pulseRules.runAction({ type: 'set_twitch_category', gameId: String(twitchCategory.id) });
        results.push(`Twitch: ${twitchCategory.name} ✓`);
      }
      setStatus(results.join('  ·  '));
    } catch (err: any) {
      setStatus(`Failed: ${err?.message || 'unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  const savePreset = async () => {
    if (!presetName.trim()) return;
    setSavingPreset(true);
    try {
      await window.kickpulseDesktop.streamInfo.createPreset({
        name: presetName.trim(),
        title: title.trim() || undefined,
        kickCategoryId: kickCategory?.id,
        kickCategoryName: kickCategory?.name,
        twitchGameId: twitchCategory?.id,
        twitchGameName: twitchCategory?.name,
      });
      setPresetName('');
      loadPresets();
      setStatus('Preset saved ✓');
    } catch (err: any) {
      setStatus(`Failed to save preset: ${err?.message || 'unknown error'}`);
    } finally {
      setSavingPreset(false);
    }
  };

  const applyPreset = async (preset: Preset) => {
    setApplyingPresetId(preset.id);
    try {
      await window.kickpulseDesktop.streamInfo.applyPreset(preset.id);
      setStatus(`Applied "${preset.name}" ✓`);
    } catch (err: any) {
      setStatus(`Failed to apply preset: ${err?.message || 'unknown error'}`);
    } finally {
      setApplyingPresetId(null);
    }
  };

  const deletePreset = async (preset: Preset) => {
    try {
      await window.kickpulseDesktop.streamInfo.deletePreset(preset.id);
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
    } catch {
      setStatus('Failed to delete preset');
    }
  };

  return (
    <Page title="Stream Info" icon={<Pencil size={22} color={COLORS.accent} />}
      subtitle="Change your title and category on Kick and Twitch together — no Pulse Engine rule needed.">
      <Section title="Title & Category">
        <Row label="Title">
          <TextInput value={title} onChange={setTitle} placeholder="What's happening on stream?" />
        </Row>
        <Row label="Kick Category">
          <CategorySearch platform="kick" selected={kickCategory} onPick={setKickCategory} />
        </Row>
        <Row label="Twitch Category">
          <CategorySearch platform="twitch" selected={twitchCategory} onPick={setTwitchCategory} />
        </Row>
        <Button variant="primary" onClick={updateStreamInfo} disabled={applying}>
          {applying ? 'Updating…' : 'Update Title + Both Categories'}
        </Button>
      </Section>

      <Section
        title="Presets"
        right={<IconButton title="Refresh" onClick={loadPresets}><RefreshCw size={13} /></IconButton>}
      >
        <p style={{ fontSize: 12, color: COLORS.textFaint, marginBottom: 10 }}>
          Save the title/categories above as a named preset — one preset can hold Kick AND Twitch together, applied in one click. Shared with the website and the Stream Deck plugin.
        </p>

        {loadingPresets ? (
          <p style={{ fontSize: 13, color: COLORS.textFaint }}>Loading…</p>
        ) : presets.length === 0 ? (
          <p style={{ fontSize: 13, color: COLORS.textFaint }}>No presets saved yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {presets.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>
                    {[p.title, p.kick_category_name && `Kick: ${p.kick_category_name}`, p.twitch_game_name && `Twitch: ${p.twitch_game_name}`].filter(Boolean).join(' · ') || 'Nothing set'}
                  </div>
                </div>
                <Button onClick={() => applyPreset(p)} disabled={applyingPresetId === p.id}>
                  {applyingPresetId === p.id ? 'Applying…' : 'Apply'}
                </Button>
                <IconButton title="Delete preset" danger onClick={() => deletePreset(p)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        <Row label="New preset name">
          <TextInput value={presetName} onChange={setPresetName} placeholder="e.g. Ranked Valorant" />
        </Row>
        <Button variant="primary" onClick={savePreset} disabled={savingPreset || !presetName.trim()}>
          <Zap size={13} /> {savingPreset ? 'Saving…' : 'Save as Preset'}
        </Button>
      </Section>

      {status && <p style={{ fontSize: 12.5, color: COLORS.textDim }}>{status}</p>}
    </Page>
  );
}
