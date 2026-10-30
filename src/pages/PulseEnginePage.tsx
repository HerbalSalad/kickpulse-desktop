// src/pages/PulseEnginePage.tsx — Pulse Engine, a REAL native editor (not an
// embedded <webview> — see PulseTriggerEditor.tsx's own header for why this
// one page gets a native rebuild instead of the Overlay/Alert Studio/Scenes
// embed pattern): direct feedback was that OBS/light actions need the
// desktop app's own local data (its OBS connection, its configured lights),
// which the website genuinely has no way to see — a webview of the site
// can't offer a live OBS scene picker this app doesn't have to report
// first. Every rule created/edited here IS the exact same pulse_rules row
// the website's own dispatcher reads (electron/api.ts → /pulse-rules),
// so there's no second schema to drift out of sync with — full trigger/
// action parity is kept by this page and its two editors genuinely
// mirroring the website's own PulseEngine.tsx/PulseTriggerEditor.tsx/
// PulseActionEditor.tsx, not by loading the real page.
import { useCallback, useEffect, useState } from 'react';
import {
  Zap, Plus, Trash2, ChevronDown, ChevronUp, Sparkles, Pencil,
  Hourglass, SkipForward, X, ExternalLink,
} from 'lucide-react';
import { Page, Section, Button, IconButton, EmptyState, TextInput, NumberInput, Row, COLORS } from '../components/ui';
import PulseActionEditor, { PulseAction, describeAction, fmtDuration } from '../components/PulseActionEditor';
import PulseTriggerEditor, { Trigger, describeTrigger, usePulseLookups } from '../components/PulseTriggerEditor';

const WEBSITE = 'https://www.kickpulsebot.com';

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  actions: PulseAction[];
  cooldown_seconds: number;
  user_cooldown_seconds: number;
  // 2026-10-30 — optional (not required on TEMPLATES' own Omit<Rule,'id'>
  // entries, none of which set these) rather than `| null` everywhere.
  category?: string | null;
  color?: string | null;
}

interface Draft {
  name: string; enabled: boolean; cooldown_seconds: number; user_cooldown_seconds: number;
  trigger: Trigger; actions: PulseAction[]; category: string; color: string;
}

interface RunningJob {
  id: string; kind: 'wait' | 'wait_for'; sourceName: string | null; label: string | null; viewer: string | null;
  runsInMs: number | null; waitingFor: { trigger: Trigger; sameViewer: boolean; onTimeout: string } | null;
  timerId: string | null; createdAt: number; next: { type: string; message?: string; seconds?: number }[];
}

const TEMPLATES: { name: string; rule: Omit<Rule, 'id'> }[] = [
  {
    name: '🎉 Hype big kicks drops',
    rule: {
      name: 'Big kicks hype', enabled: true, cooldown_seconds: 30, user_cooldown_seconds: 0,
      trigger: { type: 'event', event: 'kicks.gifted', minAmount: 100 },
      actions: [
        { type: 'bot_message', message: '🚨 {username} just dropped {amount} kicks!! LETSGOOO 🚨' },
        { type: 'award_points', amount: 500 },
      ],
    },
  },
  {
    name: '🎡 Gift subs spin the wheel',
    rule: {
      name: 'Gifts spin the wheel', enabled: true, cooldown_seconds: 60, user_cooldown_seconds: 0,
      trigger: { type: 'event', event: 'channel.subscription.gifts', minAmount: 5 },
      actions: [
        { type: 'bot_message', message: '{username} gifted {amount} subs — the wheel spins for it! 🎡' },
        { type: 'spin_wheel' },
      ],
    },
  },
  {
    name: '🎬 Big raid switches OBS scene',
    rule: {
      name: 'Raid switches scene', enabled: true, cooldown_seconds: 10, user_cooldown_seconds: 0,
      trigger: { type: 'event', event: 'channel.raid', minAmount: 5 },
      actions: [
        { type: 'obs_switch_scene', sceneName: '' },
        { type: 'bot_message', message: '🎉 Thanks for the raid, {username}!' },
      ],
    },
  },
  {
    name: '🏆 10k lifetime points club',
    rule: {
      name: '10k points club', enabled: true, cooldown_seconds: 0, user_cooldown_seconds: 0,
      trigger: { type: 'points_milestone', threshold: 10000 },
      actions: [{ type: 'bot_message', message: '🏆 {username} just crossed 10,000 lifetime Pulse Points — absolute legend!' }],
    },
  },
  {
    name: '🚂 Hype train level 3',
    rule: {
      name: 'Hype train lvl 3 hype', enabled: true, cooldown_seconds: 60, user_cooldown_seconds: 0,
      trigger: { type: 'hype_level', level: 3 },
      actions: [{ type: 'bot_message', message: '🚂🚂🚂 LEVEL {amount} HYPE TRAIN!! Keep it rolling!!' }],
    },
  },
  {
    name: '⏳ Temporary mod for a reward',
    rule: {
      name: 'Temporary mod', enabled: true, cooldown_seconds: 0, user_cooldown_seconds: 0,
      trigger: { type: 'event', event: 'channel.reward.redemption.updated' },
      actions: [
        { type: 'bot_message', message: '/mod {username}', sendAsUser: true },
        { type: 'wait', seconds: 4 * 3600 },
        { type: 'bot_message', message: '/unmod {username}', sendAsUser: true },
      ],
    },
  },
];

export default function PulseEnginePage() {
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lookups = usePulseLookups(userId);

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then((status) => {
      setUserId(status.me?.userId ?? null);
      setApiKeyReady(!!status.connected);
    });
  }, []);

  const loadRules = useCallback(() => {
    if (!apiKeyReady) return;
    window.kickpulseDesktop.pulseRules.list()
      .then((d) => { if (Array.isArray(d)) setRules(d); setLoadError(null); })
      .catch((err) => setLoadError(err?.message || 'Failed to load rules — Premium required'));
  }, [apiKeyReady]);

  useEffect(loadRules, [loadRules]);

  // ── Running sequences ──────────────────────────────────────────────────
  const [jobs, setJobs] = useState<{ at: number; list: RunningJob[] }>({ at: Date.now(), list: [] });
  const [nowTick, setNowTick] = useState(Date.now());
  const loadJobs = useCallback(() => {
    if (!apiKeyReady) return;
    window.kickpulseDesktop.pulseRules.listJobs().then((d) => Array.isArray(d) && setJobs({ at: Date.now(), list: d })).catch(() => {});
  }, [apiKeyReady]);
  useEffect(() => {
    loadJobs();
    const id = setInterval(loadJobs, 15000);
    return () => clearInterval(id);
  }, [loadJobs]);
  useEffect(() => {
    if (!jobs.list.length) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [jobs.list.length]);

  const skipJob = async (id: string) => { await window.kickpulseDesktop.pulseRules.skipJob(id).catch(() => {}); loadJobs(); };
  const cancelJob = async (id: string) => {
    if (!window.confirm('Cancel this? The steps after the wait will NOT run.')) return;
    await window.kickpulseDesktop.pulseRules.cancelJob(id).catch(() => {});
    loadJobs();
  };

  // ── Draft handling ──────────────────────────────────────────────────────
  const newDraft = (tpl?: Omit<Rule, 'id'>) => {
    setEditingId(null);
    setDraft(tpl
      ? { name: tpl.name, enabled: tpl.enabled, cooldown_seconds: tpl.cooldown_seconds, user_cooldown_seconds: tpl.user_cooldown_seconds, trigger: { ...tpl.trigger }, actions: tpl.actions.map(a => ({ ...a })), category: '', color: '' }
      : { name: '', enabled: true, cooldown_seconds: 0, user_cooldown_seconds: 0, trigger: { type: 'event', event: 'channel.followed' }, actions: [{ type: 'bot_message', message: '' }], category: '', color: '' });
  };

  const startEdit = (rule: Rule) => {
    setEditingId(rule.id);
    setDraft({
      name: rule.name, enabled: rule.enabled, cooldown_seconds: rule.cooldown_seconds,
      user_cooldown_seconds: rule.user_cooldown_seconds,
      trigger: { ...rule.trigger },
      actions: JSON.parse(JSON.stringify(rule.actions)),
      category: rule.category || '', color: rule.color || '',
    });
    setExpandedId(null);
  };

  const closeDraft = () => { setDraft(null); setEditingId(null); };

  const saveDraft = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setLoadError(null);
    try {
      const body = {
        name: draft.name, enabled: draft.enabled, cooldown_seconds: draft.cooldown_seconds,
        user_cooldown_seconds: draft.user_cooldown_seconds,
        trigger: draft.trigger, actions: draft.actions,
        category: draft.category.trim() || null, color: draft.color || null,
      };
      if (editingId) await window.kickpulseDesktop.pulseRules.update(editingId, body);
      else await window.kickpulseDesktop.pulseRules.create(body);
      closeDraft();
      loadRules();
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: Rule) => {
    await window.kickpulseDesktop.pulseRules.update(rule.id, { enabled: !rule.enabled }).catch(() => {});
    loadRules();
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm('Delete this rule?')) return;
    await window.kickpulseDesktop.pulseRules.remove(id).catch(() => {});
    loadRules();
  };

  if (!apiKeyReady) {
    return (
      <Page title="Pulse Engine" icon={<Zap size={22} color={COLORS.accent} />}>
        <EmptyState title="Connect your account first" body="Pulse Engine needs your KickPulse account connected (Home tab → API key)." />
      </Page>
    );
  }

  return (
    <Page
      title="Pulse Engine"
      icon={<Zap size={22} color={COLORS.accent} />}
      subtitle="WHEN this happens → THEN do this — including OBS scene/source control and smart lights, since this runs right here in the desktop app."
      actions={<Button onClick={() => window.kickpulseDesktop.openExternal(`${WEBSITE}/pulse-engine`)}><ExternalLink size={14} />Open on website</Button>}
    >
      {loadError && (
        <Section style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
          <span style={{ color: '#fca5a5', fontSize: 13 }}>{loadError}</span>
        </Section>
      )}

      {jobs.list.length > 0 && (
        <Section title="" style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#fcd34d', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Hourglass size={14} /> Running sequences ({jobs.list.length})
          </p>
          <p style={{ fontSize: 12, color: COLORS.textFaint, marginBottom: 10 }}>
            These are paused partway through. Skip runs the rest right now; Cancel means the rest never runs.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.list.map((j) => {
              const left = j.runsInMs == null ? null : Math.max(0, j.runsInMs - (nowTick - jobs.at));
              const nextMsg = j.next[0];
              return (
                <div key={j.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, margin: 0 }}>
                      {j.sourceName || 'Sequence'}{j.viewer ? <span style={{ color: COLORS.textDim, fontWeight: 400 }}> · for {j.viewer}</span> : null}
                    </p>
                    <p style={{ fontSize: 11, color: COLORS.textDim, margin: 0 }}>
                      {j.kind === 'wait'
                        ? <>⏳ resumes in <span style={{ color: '#fcd34d', fontFamily: 'monospace' }}>{fmtDuration(Math.ceil((left ?? 0) / 1000))}</span></>
                        : <>👂 waiting for {j.waitingFor ? describeTrigger(j.waitingFor.trigger, lookups) : ''}
                            {left != null && <> · gives up in <span style={{ color: '#7dd3fc', fontFamily: 'monospace' }}>{fmtDuration(Math.ceil(left / 1000))}</span></>}</>}
                      {nextMsg && <> · next: {nextMsg.message ? `"${nextMsg.message.slice(0, 40)}"` : describeAction(nextMsg as PulseAction)}</>}
                    </p>
                  </div>
                  <Button onClick={() => skipJob(j.id)} title="Run the rest now"><SkipForward size={13} />Skip now</Button>
                  <Button variant="danger" onClick={() => cancelJob(j.id)}><X size={13} />Cancel</Button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {!draft && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Button variant="primary" onClick={() => newDraft()}><Plus size={14} />New Rule</Button>
          <span style={{ fontSize: 11, color: COLORS.textFaint, display: 'flex', alignItems: 'center', gap: 4 }}><Sparkles size={12} /> or start from:</span>
          {TEMPLATES.map((t) => (
            <button key={t.name} onClick={() => newDraft(t.rule)}
              style={{ padding: '6px 10px', background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 11, fontWeight: 500, color: COLORS.textDim, cursor: 'pointer' }}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {draft && (
        <Section style={{ borderColor: 'rgba(124,58,237,0.4)' }}>
          {editingId && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#c4b5fd', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, padding: '4px 10px', marginBottom: 12 }}>
              <Pencil size={12} /> Editing an existing rule
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <TextInput value={draft.name} onChange={(v) => setDraft((d) => d && { ...d, name: v })} placeholder="Rule name" style={{ fontSize: 15, fontWeight: 600, flex: 1 }} />
            <input type="color" value={draft.color ? `#${draft.color}` : '#6d28d9'}
              onChange={(e) => setDraft((d) => d && { ...d, color: e.target.value.replace(/^#/, '') })}
              title="Rule color"
              style={{ width: 36, height: 36, borderRadius: 8, background: 'transparent', border: `1px solid ${COLORS.border}`, cursor: 'pointer', flexShrink: 0 }} />
            {draft.color && (
              <button onClick={() => setDraft((d) => d && { ...d, color: '' })}
                style={{ fontSize: 11, color: COLORS.textFaint, background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>Clear</button>
            )}
          </div>
          <TextInput value={draft.category} onChange={(v) => setDraft((d) => d && { ...d, category: v })}
            placeholder="Category (optional) — e.g. Hype, Mod Tools" style={{ marginBottom: 12 }} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 12 }}>
            <Row label="Global Cooldown" hint="shared across everyone">
              <NumberInput value={draft.cooldown_seconds} min={0} onChange={(v) => setDraft((d) => d && { ...d, cooldown_seconds: Math.max(0, v) })} style={{ width: 90 }} />
            </Row>
            <Row label="Per-Viewer Cooldown" hint="separate clock per person">
              <NumberInput value={draft.user_cooldown_seconds} min={0} onChange={(v) => setDraft((d) => d && { ...d, user_cooldown_seconds: Math.max(0, v) })} style={{ width: 90 }} />
            </Row>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.3)', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '10px 14px', marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#34d399', width: 48 }}>When</span>
            <PulseTriggerEditor value={draft.trigger} onChange={(t) => setDraft((d) => d && { ...d, trigger: t })} userId={userId} />
          </div>

          <PulseActionEditor actions={draft.actions} onChange={(a) => setDraft((d) => d && { ...d, actions: a })} userId={userId} />

          <div style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
            <Button variant="primary" onClick={saveDraft} disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Rule'}</Button>
            <Button onClick={closeDraft}>Cancel</Button>
          </div>
        </Section>
      )}

      {(() => {
        const hasAnyCategory = rules.some((r) => r.category);
        const groups: Record<string, Rule[]> = {};
        for (const rule of rules) {
          const key = hasAnyCategory ? (rule.category || 'Uncategorized') : '';
          (groups[key] ||= []).push(rule);
        }
        const groupKeys = Object.keys(groups).sort((a, b) => {
          if (a === 'Uncategorized') return 1;
          if (b === 'Uncategorized') return -1;
          return a.localeCompare(b);
        });

        const RuleCard = (rule: Rule) => (
          <div key={rule.id} style={{
            background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, opacity: rule.enabled ? 1 : 0.6,
            ...(rule.color ? { borderLeftColor: `#${rule.color}`, borderLeftWidth: 4 } : {}),
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>
              <button onClick={() => toggleRule(rule)} style={{
                position: 'relative', width: 40, height: 22, borderRadius: 999, flexShrink: 0, border: 'none', cursor: 'pointer',
                background: rule.enabled ? COLORS.accent : 'rgba(255,255,255,0.14)',
              }}>
                <span style={{ position: 'absolute', top: 2, left: rule.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, margin: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.name}</p>
                <p style={{ fontSize: 11, color: COLORS.textFaint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#6ee7b7' }}>WHEN</span> {describeTrigger(rule.trigger, lookups)}{' '}
                  <span style={{ color: '#c4b5fd' }}>THEN</span> {rule.actions.map(describeAction).join(' → ')}
                </p>
              </div>
              <IconButton title="Edit rule" onClick={() => startEdit(rule)}><Pencil size={14} /></IconButton>
              <IconButton title="Details" onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}>
                {expandedId === rule.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </IconButton>
              <IconButton title="Delete rule" danger onClick={() => deleteRule(rule.id)}><Trash2 size={14} /></IconButton>
            </div>
            {expandedId === rule.id && (
              <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rule.actions.map((a, i) => (
                  <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', borderRadius: 8, padding: '6px 10px', color: COLORS.textDim, background: 'rgba(0,0,0,0.3)' }}>
                    {a.type === 'wait_for' ? `${describeAction(a)}: ${a.trigger ? describeTrigger(a.trigger, lookups) : ''}` : describeAction(a)}
                    {a.message && ` — "${a.message}"`}
                    {a.amount != null && a.type === 'award_points' && ` — ${a.amount} pts`}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {rules.length === 0 && !draft && (
              <p style={{ color: COLORS.textFaint, fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
                No rules yet. Try a template above — the "big kicks" one takes 10 seconds to set up.
              </p>
            )}
            {groupKeys.map((key) => (
              <div key={key || 'all'} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {hasAnyCategory && (
                  <h3 style={{ fontSize: 11, fontWeight: 700, color: COLORS.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0 2px' }}>{key}</h3>
                )}
                {groups[key].map(RuleCard)}
              </div>
            ))}
          </div>
        );
      })()}
    </Page>
  );
}
