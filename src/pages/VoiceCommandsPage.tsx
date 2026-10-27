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
// partial results).
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

// Medium's hint flags its real tradeoff (2026-10-27, direct report: "any of
// them besides small gives me massive lag... even on the medium"): it's a
// "-lgraph" model — a smaller download because its recognition graph is
// expanded lazily DURING listening instead of once up front, which is a
// real, Vosk-documented reason it can run slower WHILE recognizing than
// Large despite its much smaller file size — not a bug, just a genuinely
// different size-vs-speed tradeoff than the file size alone suggests.
const MODEL_OPTIONS: { value: VoiceModelSize; label: string; hint: string }[] = [
  { value: 'small', label: 'Small', hint: '~40MB — fastest, least accurate' },
  { value: 'medium', label: 'Medium', hint: '~130MB — a smaller download, but can run slower WHILE listening than Large (its graph is built on the fly) — try Large if this feels sluggish' },
  { value: 'large', label: 'Large', hint: '~1.8GB — most common accurate English model, often snappier live than Medium despite the bigger download' },
  { value: 'xlarge', label: 'Extra Large', hint: '~2.3GB — most accurate, slowest' },
];

export default function VoiceCommandsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [apiKeyReady, setApiKeyReady] = useState(false);

  // ── Global settings ──────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [inputDeviceId, setInputDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [modelSize, setModelSize] = useState<VoiceModelSize>('small');
  const [strictVocabulary, setStrictVocabulary] = useState(false);
  const [recognitionWordsText, setRecognitionWordsText] = useState('');
  const [liveCaptionsEnabled, setLiveCaptionsEnabled] = useState(false);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
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
      setModelSize(s.modelSize);
      setStrictVocabulary(s.strictVocabulary);
      setRecognitionWordsText(s.recognitionWords.join('\n'));
      setLiveCaptionsEnabled(s.liveCaptionsEnabled);
      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    window.kickpulseDesktop.voice.isModelReady(modelSize).then(setModelReady);
  }, [settingsLoaded, modelSize]);

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
      alert(`Download the ${MODEL_OPTIONS.find(m => m.value === modelSize)?.label} model first — use the Download button below.`);
      return;
    }
    setEnabled(next);
  };

  const changeDevice = async (deviceId: string) => {
    const next = deviceId || null;
    setInputDeviceId(next);
    await window.kickpulseDesktop.voice.setInputDevice(next);
  };

  const changeModelSize = async (size: VoiceModelSize) => {
    setModelSize(size);
    await window.kickpulseDesktop.voice.setModelSize(size);
  };

  const downloadModel = async () => {
    setDownloadPct(0);
    window.kickpulseDesktop.voice.onDownloadProgress(setDownloadPct);
    const result = await window.kickpulseDesktop.voice.downloadModel(modelSize);
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

          <Section title="Model" right={<span style={{ fontSize: 12, color: COLORS.textFaint }}>bigger = more accurate, slower, more RAM</span>}>
            <Row label="Size">
              <Select value={modelSize} onChange={(v) => changeModelSize(v as VoiceModelSize)}
                options={MODEL_OPTIONS.map((m) => ({ value: m.value, label: `${m.label} — ${m.hint}` }))} />
            </Row>
            <Row label="Status">
              {downloadPct != null ? (
                <span style={{ color: COLORS.textDim }}>Downloading… {downloadPct}%</span>
              ) : modelReady ? (
                <span style={{ color: COLORS.success }}>Downloaded, ready to use</span>
              ) : (
                <Button onClick={downloadModel}><Download size={14} />Download {MODEL_OPTIONS.find((m) => m.value === modelSize)?.label} model</Button>
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
          </Section>
        </>
      )}
    </Page>
  );
}
