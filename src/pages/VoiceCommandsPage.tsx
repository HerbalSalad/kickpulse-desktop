// src/pages/VoiceCommandsPage.tsx — Voice Commands' own dedicated page
// (2026-10-23 rewrite — direct correction: "I didnt want voice command to
// only be in pulse engine rules. I wanted it to be its own page in the
// desktop app"). Every voice command created here IS a real pulse_rules
// row with trigger.type:'voice_command' — the exact same row the generic
// Pulse Engine page's own trigger-type picker can also create/edit (same
// "two front doors, one source of truth" shape Chat Bot Commands already
// have alongside Pulse Engine's own generic chat_command trigger) — this
// page just skips the generic type dropdown (PulseTriggerEditor's own
// hideTypePicker prop) and drops straight into phrase/match/confidence
// fields + the full action editor, since a voice command never needs to be
// anything other than that.
//
// Recognition itself runs in the main process (electron/voiceCommands.ts,
// real Vosk via vosk-koffi — see that file's own header for why this is a
// native module instead of the WASM approach the first pass used, and why
// that's actually a better fit for everything this page controls: real
// per-word confidence, a real grammar/word-list mechanism, true streaming
// partial results). Collapsed to the Small model only (2026-11-06, direct
// decision) — this only ever matches a short closed phrase list, where
// Small's own strict-grammar mode already works great; Medium/Large/Extra
// Large just cost more RAM/CPU for open-vocabulary accuracy this feature
// never needed (that's what Live Captions' separate whisper.cpp engine is
// for — see its own Engine setting further down this page).
import { useCallback, useEffect, useState } from 'react';
import { Mic, MicOff, Plus, Trash2, Pencil, Download, ExternalLink } from 'lucide-react';
import {
  Page, Section, Row, Select, NumberInput, TextInput, Toggle, Button, IconButton, EmptyState, COLORS, Tabs,
} from '../components/ui';
import PulseActionEditor, { type PulseAction, describeAction } from '../components/PulseActionEditor';
import PulseTriggerEditor, { type Trigger, DEFAULT_TRIGGERS } from '../components/PulseTriggerEditor';

const WEBSITE = 'https://www.kickpulsebot.com';

interface Rule {
  id: string; name: string; enabled: boolean; trigger: Trigger; actions: PulseAction[];
  cooldown_seconds: number; user_cooldown_seconds: number;
}
interface Draft { name: string; trigger: Trigger; actions: PulseAction[]; cooldownSeconds: number }

// Live Captions runs on a separate engine (whisper.cpp, not Vosk — see
// electron/whisperCaptions.ts) specifically because Vosk's grammar is the
// wrong tool for open-vocabulary speech: "strict" mode only hears your own
// bound phrases, "open" mode is noticeably inaccurate on arbitrary speech.
// These two options are the real survivors of a 6-model benchmark (base
// through large-v3-turbo, timed + accuracy-checked) — medium and
// large-v3-turbo both came back slower than real time on this hardware
// (9-18s of CPU time per ~10s of speech), so they're not offered here at
// all even though whisper.cpp supports them.
const CAPTIONS_MODEL_OPTIONS: { value: WhisperModelKey; label: string; hint: string }[] = [
  { value: 'base', label: 'Base (fast)', hint: '~57MB — lowest CPU cost, misses less-common names/words more often' },
  { value: 'small', label: 'Small (accurate)', hint: '~465MB — still comfortably faster than real time, noticeably better at names/brands/usernames' },
];

export default function VoiceCommandsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [apiKeyReady, setApiKeyReady] = useState(false);

  // ── Global settings ──────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [inputDeviceId, setInputDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [strictVocabulary, setStrictVocabulary] = useState(false);
  const [recognitionWordsText, setRecognitionWordsText] = useState('');
  const [liveCaptionsEnabled, setLiveCaptionsEnabled] = useState(false);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [captionsModel, setCaptionsModel] = useState<WhisperModelKey>('small');
  const [captionsModelReady, setCaptionsModelReady] = useState<boolean | null>(null);
  const [captionsDownloadPct, setCaptionsDownloadPct] = useState<number | null>(null);
  const [compareModeEnabled, setCompareModeEnabledState] = useState(false);
  const [compareLog, setCompareLog] = useState<{ at: number; results: { model: WhisperModelKey; text: string; ms: number }[] }[]>([]);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareMissing, setCompareMissing] = useState<WhisperModelKey[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then((status) => {
      setUserId(status.me?.userId ?? null);
      setApiKeyReady(!!status.connected);
    });
  }, []);

  useEffect(() => {
    (async () => {
      const s = await window.kickpulseDesktop.voice.getSettings();
      setEnabled(s.enabled);
      setInputDeviceId(s.inputDeviceId);
      setStrictVocabulary(s.strictVocabulary);
      setRecognitionWordsText(s.recognitionWords.join('\n'));
      setLiveCaptionsEnabled(s.liveCaptionsEnabled);
      setCaptionsModel(s.captionsModel);
      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    window.kickpulseDesktop.voice.isModelReady().then(setModelReady);
  }, [settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    window.kickpulseDesktop.voice.isWhisperModelReady(captionsModel).then(setCaptionsModelReady);
  }, [settingsLoaded, captionsModel]);

  const refreshDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch { /* picker just stays empty */ }
  };
  useEffect(() => { refreshDevices(); }, [enabled]);

  const toggleEnabled = async (next: boolean) => {
    if (next) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { /* the hidden listener window surfaces the real failure if denied */ }
      await refreshDevices();
    }
    const result = await window.kickpulseDesktop.voice.setEnabled(next);
    if (!result.ok && result.needsModelDownload) {
      alert('Download the Vosk model first — use the Download button below.');
      return;
    }
    setEnabled(next);
  };

  const changeDevice = async (deviceId: string) => {
    const next = deviceId || null;
    setInputDeviceId(next);
    await window.kickpulseDesktop.voice.setInputDevice(next);
  };

  const downloadModel = async () => {
    setDownloadPct(0);
    window.kickpulseDesktop.voice.onDownloadProgress(setDownloadPct);
    const result = await window.kickpulseDesktop.voice.downloadModel();
    setDownloadPct(null);
    if (!result.ok) { alert(`Download failed: ${result.error}`); return; }
    setModelReady(true);
  };

  const changeStrictVocabulary = async (v: boolean) => {
    setStrictVocabulary(v);
    await window.kickpulseDesktop.voice.setStrictVocabulary(v);
  };

  const [wordsSaved, setWordsSaved] = useState(true);
  const saveRecognitionWords = async () => {
    const words = recognitionWordsText.split('\n').map((w) => w.trim()).filter(Boolean);
    await window.kickpulseDesktop.voice.setRecognitionWords(words);
    setWordsSaved(true);
  };

  const changeLiveCaptions = async (v: boolean) => {
    setLiveCaptionsEnabled(v);
    await window.kickpulseDesktop.voice.setLiveCaptionsEnabled(v);
  };

  const changeCaptionsModel = async (key: WhisperModelKey) => {
    setCaptionsModel(key);
    await window.kickpulseDesktop.voice.setCaptionsModel(key);
  };

  const downloadCaptionsModel = async () => {
    setCaptionsDownloadPct(0);
    window.kickpulseDesktop.voice.onDownloadWhisperProgress(setCaptionsDownloadPct);
    const result = await window.kickpulseDesktop.voice.downloadWhisperModel(captionsModel);
    setCaptionsDownloadPct(null);
    if (!result.ok) { alert(`Download failed: ${result.error}`); return; }
    setCaptionsModelReady(true);
  };

  // Live compare monitor (2026-11-06) — see electron/main.ts's
  // 'voice:set-compare-mode' handler for the full flow (temporarily starts
  // the mic listener if Voice Commands itself isn't already on, for as
  // long as this stays toggled on). No button to press per utterance —
  // flip it once, then just talk; the poll loop below picks up new entries.
  const toggleCompareMode = async (next: boolean) => {
    setCompareError(null);
    setCompareMissing([]);
    if (next) setCompareLog([]);
    const result = await window.kickpulseDesktop.voice.setCompareMode(next);
    if (!result.ok) {
      if (result.error === 'missing-models') {
        setCompareError('Download both models first to compare them.');
        setCompareMissing(result.missing || []);
      } else {
        setCompareError(result.error || 'Could not start the compare monitor.');
      }
      return;
    }
    setCompareModeEnabledState(next);
  };

  const downloadMissingCompareModel = (key: WhisperModelKey) => async () => {
    const label = CAPTIONS_MODEL_OPTIONS.find((m) => m.value === key)?.label;
    setCompareError(`Downloading ${label}…`);
    window.kickpulseDesktop.voice.onDownloadWhisperProgress((pct) => setCompareError(`Downloading ${label}… ${pct}%`));
    const result = await window.kickpulseDesktop.voice.downloadWhisperModel(key);
    if (!result.ok) { setCompareError(`Download failed: ${result.error}`); return; }
    setCompareMissing((m) => m.filter((k) => k !== key));
    setCompareError(null);
    if (key === captionsModel) setCaptionsModelReady(true);
  };

  useEffect(() => {
    if (!compareModeEnabled) return;
    let dead = false;
    const tick = async () => {
      const log = await window.kickpulseDesktop.voice.getCompareLog();
      if (!dead) setCompareLog(log);
    };
    tick();
    const id = setInterval(tick, 600);
    return () => { dead = true; clearInterval(id); };
  }, [compareModeEnabled]);

  // ── In-app live monitor ──────────────────────────────────────────────────
  const [livePartial, setLivePartial] = useState('');
  const [heardLog, setHeardLog] = useState<{ text: string; confidence: number; matchedPhrase: string | null; at: number }[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const tick = async () => {
      const [partial, log] = await Promise.all([
        window.kickpulseDesktop.voice.getLivePartial(),
        window.kickpulseDesktop.voice.getHeardLog(),
      ]);
      if (dead) return;
      setLivePartial(partial);
      setHeardLog(log);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => { dead = true; clearInterval(id); };
  }, [enabled]);

  // Own tab vs. Settings (2026-10-24, direct request) — the command list
  // used to live below every global setting, so seeing what you'd already
  // set up meant scrolling past the whole Listening/Model/Live Captions
  // block every time. Commands is the default tab so opening this page
  // goes straight to "what do I have set up" instead.
  const [tab, setTab] = useState<'commands' | 'settings'>('commands');

  // ── Voice command rules (pulse_rules filtered to voice_command) ─────────
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRules = useCallback(() => {
    if (!apiKeyReady) return;
    window.kickpulseDesktop.pulseRules.list()
      .then((d: Rule[]) => { if (Array.isArray(d)) setRules(d.filter((r) => r.trigger?.type === 'voice_command')); setLoadError(null); })
      .catch((err) => setLoadError(err?.message || 'Failed to load voice commands — Premium required'));
  }, [apiKeyReady]);
  useEffect(loadRules, [loadRules]);

  const newDraft = () => {
    setEditingId(null);
    setDraft({ name: '', trigger: { ...DEFAULT_TRIGGERS.voice_command }, actions: [{ type: 'bot_message', message: '' }], cooldownSeconds: 0 });
  };
  const startEdit = (rule: Rule) => {
    setEditingId(rule.id);
    setDraft({ name: rule.name, trigger: { ...rule.trigger }, actions: JSON.parse(JSON.stringify(rule.actions)), cooldownSeconds: rule.cooldown_seconds ?? 0 });
  };
  const closeDraft = () => { setDraft(null); setEditingId(null); };

  const saveDraft = async () => {
    if (!draft || !draft.trigger.phrase?.trim()) return;
    setSaving(true);
    setLoadError(null);
    try {
      const body = {
        name: draft.trigger.phrase.trim(), enabled: true, cooldown_seconds: Math.max(0, draft.cooldownSeconds || 0), user_cooldown_seconds: 0,
        trigger: draft.trigger, actions: draft.actions,
      };
      if (editingId) await window.kickpulseDesktop.pulseRules.update(editingId, body);
      else await window.kickpulseDesktop.pulseRules.create(body);
      closeDraft();
      loadRules();
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to save voice command');
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm('Delete this voice command?')) return;
    await window.kickpulseDesktop.pulseRules.remove(id).catch(() => {});
    loadRules();
  };

  if (!apiKeyReady) {
    return (
      <Page title="Voice Commands" icon={<Mic size={22} color={COLORS.accent} />}>
        <EmptyState title="Connect your account first" body="Voice Commands needs your KickPulse account connected (Home tab → API key)." />
      </Page>
    );
  }

  return (
    <Page
      title="Voice Commands"
      icon={enabled ? <Mic size={22} color={COLORS.accent} /> : <MicOff size={22} color={COLORS.textFaint} />}
      subtitle="Bind a spoken word or phrase to any action — lights, chat messages, wheel spins, anything Pulse Engine can do. Recognition runs fully on this PC; nothing is ever sent anywhere until a phrase actually matches."
      actions={<Button onClick={() => window.kickpulseDesktop.openExternal(`${WEBSITE}/pulse-engine`)}><ExternalLink size={14} />Open full Pulse Engine</Button>}
    >
      <Row label="Voice Commands" hint="Always listens in the background while on — nothing leaves this PC except the one phrase that matched, when it matches.">
        <Toggle checked={enabled} onChange={toggleEnabled} />
      </Row>

      <div style={{ marginTop: 14, marginBottom: 18 }}>
        <Tabs value={tab} onChange={setTab} options={[
          { value: 'commands', label: 'Voice Commands' },
          { value: 'settings', label: 'Settings' },
        ]} />
      </div>

      {tab === 'commands' && (
        <>
          {enabled && (
            <Section title="Live monitor" right={<span style={{ fontSize: 12, color: COLORS.textFaint }}>confirms recognition is actually working</span>}>
              <div style={{ fontSize: 14, color: livePartial ? COLORS.text : COLORS.textFaint, fontStyle: livePartial ? 'normal' : 'italic', marginBottom: 10, minHeight: 20 }}>
                {livePartial || 'listening…'}
              </div>
              {heardLog.length === 0 ? (
                <EmptyState title="Nothing heard yet" body="Say something — a transcript will show up here within a moment." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {heardLog.map((h, i) => (
                    <div key={i} style={{ fontSize: 12, color: h.matchedPhrase ? COLORS.success : COLORS.textDim, display: 'flex', gap: 8 }}>
                      <span style={{ color: COLORS.textFaint, fontFamily: 'monospace' }}>{new Date(h.at).toLocaleTimeString()}</span>
                      <span>{h.text}</span>
                      <span style={{ color: COLORS.textFaint }}>({h.confidence}%)</span>
                      {h.matchedPhrase && <span>— matched "{h.matchedPhrase}"</span>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {!draft && (
            <div style={{ marginBottom: 16 }}>
              <Button variant="primary" onClick={newDraft}><Plus size={14} />New Voice Command</Button>
            </div>
          )}

          {draft && (
            <Section style={{ borderColor: 'rgba(124,58,237,0.4)' }}>
              {editingId && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#c4b5fd', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, padding: '4px 10px', marginBottom: 12 }}>
                  <Pencil size={12} /> Editing an existing voice command
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 14 }}>
                <PulseTriggerEditor value={draft.trigger} onChange={(t) => setDraft((d) => d && { ...d, trigger: t })} userId={userId} hideTypePicker />
              </div>
              <Row label="Cooldown" hint="Blocks this exact phrase from firing again until this many seconds have passed since it last fired — e.g. stops 'clip that' from spamming if you say it twice in excitement. Just one shared clock, since you're the only one who can trigger your own voice.">
                <NumberInput value={draft.cooldownSeconds} min={0} onChange={(v) => setDraft((d) => d && { ...d, cooldownSeconds: Math.max(0, v) })} style={{ width: 90 }} />
                <span style={{ fontSize: 12, color: COLORS.textFaint, marginLeft: 8 }}>seconds — 0 = no cooldown</span>
              </Row>
              <PulseActionEditor actions={draft.actions} onChange={(a) => setDraft((d) => d && { ...d, actions: a })} userId={userId} />
              <div style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
                <Button variant="primary" onClick={saveDraft} disabled={saving || !draft.trigger.phrase?.trim()}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create'}</Button>
                <Button onClick={closeDraft}>Cancel</Button>
              </div>
            </Section>
          )}

          {loadError && (
            <Section style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
              <span style={{ color: '#fca5a5', fontSize: 13 }}>{loadError}</span>
            </Section>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rules.length === 0 && !draft && (
              <EmptyState title="No voice commands yet" body='Click "New Voice Command" above to bind your first spoken phrase to an action.' />
            )}
            {rules.map((rule) => (
              <div key={rule.id} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, margin: 0, fontSize: 14 }}>"{rule.trigger.phrase}"</p>
                  <p style={{ fontSize: 11, color: COLORS.textFaint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.trigger.matchMode === 'exact' ? 'exact match' : 'anywhere in sentence'} · ≥{rule.trigger.minConfidence ?? 50}% confidence
                    {rule.trigger.triggerImmediately ? ' · immediate' : ''}
                    {rule.cooldown_seconds > 0 ? ` · ${rule.cooldown_seconds}s cooldown` : ''}
                    {' '}<span style={{ color: '#c4b5fd' }}>→</span> {rule.actions.map(describeAction).join(' → ')}
                  </p>
                </div>
                <IconButton title="Edit" onClick={() => startEdit(rule)}><Pencil size={14} /></IconButton>
                <IconButton title="Delete" danger onClick={() => deleteRule(rule.id)}><Trash2 size={14} /></IconButton>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'settings' && (
        <>
          {enabled && (
            <Section title="Microphone">
              <Row label="Input device">
                <Select value={inputDeviceId ?? ''} onChange={changeDevice}
                  options={[{ value: '', label: 'System default' }, ...devices.map((d) => ({ value: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` }))]} />
              </Row>
            </Section>
          )}

          <Section title="Model" right={<span style={{ fontSize: 12, color: COLORS.textFaint }}>Small — the only size offered, since this only ever matches a short phrase list</span>}>
            <Row label="Status">
              {downloadPct != null ? (
                <span style={{ color: COLORS.textDim }}>Downloading… {downloadPct}%</span>
              ) : modelReady ? (
                <span style={{ color: COLORS.success }}>Downloaded, ready to use</span>
              ) : (
                <Button onClick={downloadModel}><Download size={14} />Download model</Button>
              )}
            </Row>
            <Row label="Vocabulary" hint="Strict = much higher accuracy on your own phrases, can't make out anything else (including live captions of arbitrary speech). Open = hears anything, slightly less accurate on your own phrases.">
              <Toggle checked={strictVocabulary} onChange={changeStrictVocabulary} label={strictVocabulary ? 'Strict phrase matching' : 'Open vocabulary'} />
            </Row>
            <Row label="Recognition words" hint="Extra names/slang/stream-specific words, one per line — improves accuracy, never trigger anything on their own unless a command is also bound to that exact phrase." align="flex-start">
              <TextInput value={recognitionWordsText} onChange={(v) => { setRecognitionWordsText(v); setWordsSaved(false); }} multiline
                placeholder={'e.g.\nherbalsalad\ngigachad\nkickpulse'} />
              <div style={{ marginTop: 6 }}>
                <Button onClick={saveRecognitionWords} disabled={wordsSaved}>{wordsSaved ? 'Saved' : 'Save words'}</Button>
              </div>
            </Row>
          </Section>

          <Section title="Live Captions" right={<span style={{ fontSize: 12, color: COLORS.textFaint }}>on-stream OBS widget</span>}>
            <Row label="Stream to widget" hint="Sends recognized text to your Live Captions OBS widget, if you've added one. Separate from Voice Commands matching itself.">
              <Toggle checked={liveCaptionsEnabled} onChange={changeLiveCaptions} />
            </Row>
            <Row label="Engine" hint="Captions run on a different, more accurate engine than Voice Commands above (whisper.cpp instead of Vosk) — Vosk's grammar is the wrong tool for hearing arbitrary speech. Captions arrive in short batches a few seconds behind, not word-by-word — a real, accepted tradeoff of this engine, not a bug.">
              <Select value={captionsModel} onChange={(v) => changeCaptionsModel(v as WhisperModelKey)}
                options={CAPTIONS_MODEL_OPTIONS.map((m) => ({ value: m.value, label: `${m.label} — ${m.hint}` }))} />
            </Row>
            <Row label="Status">
              {captionsDownloadPct != null ? (
                <span style={{ color: COLORS.textDim }}>Downloading… {captionsDownloadPct}%</span>
              ) : captionsModelReady ? (
                <span style={{ color: COLORS.success }}>Downloaded, ready to use</span>
              ) : (
                <Button onClick={downloadCaptionsModel}><Download size={14} />Download {CAPTIONS_MODEL_OPTIONS.find((m) => m.value === captionsModel)?.label} model</Button>
              )}
            </Row>
            <Row label="Live compare monitor" hint="While on, EVERYTHING you say runs through both Base and Small continuously, side by side — no button to press per sentence, just talk normally. Separate from the Engine setting above, which is what actually powers the real OBS widget.">
              <Toggle checked={compareModeEnabled} onChange={toggleCompareMode} />
            </Row>
            {compareError && (
              <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>
                {compareError}
                {compareMissing.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                    {compareMissing.includes('base') && <Button onClick={downloadMissingCompareModel('base')}><Download size={14} />Download Base</Button>}
                    {compareMissing.includes('small') && <Button onClick={downloadMissingCompareModel('small')}><Download size={14} />Download Small</Button>}
                  </div>
                )}
              </div>
            )}
            {compareModeEnabled && (
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                {(['base', 'small'] as WhisperModelKey[]).map((key) => (
                  <div key={key} style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 12px', minHeight: 180, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textFaint }}>
                      {CAPTIONS_MODEL_OPTIONS.find((m) => m.value === key)?.label}
                    </div>
                    {compareLog.length === 0 ? (
                      <span style={{ fontSize: 12, color: COLORS.textFaint, fontStyle: 'italic' }}>listening… say something</span>
                    ) : (
                      compareLog.map((entry, i) => {
                        const r = entry.results.find((x) => x.model === key);
                        return (
                          <div key={i} style={{ fontSize: 13, color: COLORS.text }}>
                            <span style={{ color: COLORS.textFaint, fontFamily: 'monospace', fontSize: 11, marginRight: 6 }}>
                              {new Date(entry.at).toLocaleTimeString()}
                            </span>
                            "{r?.text}" <span style={{ color: COLORS.textFaint, fontSize: 11 }}>({((r?.ms ?? 0) / 1000).toFixed(1)}s)</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
