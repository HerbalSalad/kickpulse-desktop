// src/components/CommandModal.tsx — the shared Command/Timer/Walk-on/Keyword
// editor for the desktop app's native Chat Bot page (src/pages/ChatBotPage.tsx),
// ported from the website's own ChatBot.tsx CommandModal (one modal, a type
// dropdown at the top swaps which fields show — see that research for the
// exact field-per-type matrix this mirrors).
//
// Known, disclosed scope cuts from the website version (not silently
// dropped — flagged here so a future pass knows exactly what's thinner):
//   - The message field is a plain multi-line text box with a row of
//     click-to-insert {token} chips, not the website's rich contentEditable
//     editor with an inline Kick/Twitch emote picker and live emote images.
//     Typing [emote:id:name] by hand still works (the server resolves it
//     exactly the same way), there's just no visual picker for it here yet.
//   - Response Variants use a plain All/Kick/Twitch platform tag per row,
//     same data shape as the website (`{text, platform}`), just a simpler
//     row UI than VariantMessageList's own inline emote editor.
//   - Module packs are not ported at all yet (a real fast-follow, not core
//     to "create/edit/delete a command" — see the research this was built
//     from for why that's a thin, mostly-mechanical wrapper over this same
//     modal once it's worth doing).
//
// Rich Actions + Keyword "match every message" (2026-10-21) — added in
// lockstep with the website's own ChatBot.tsx, not left to drift. Reuses
// this app's own native PulseActionEditor.tsx (already proven in
// PulseEnginePage.tsx), Premium-gated via its `locked` prop.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Section, Row, TextInput, NumberInput, Select, Toggle, Button, COLORS } from './ui';
import { VARIABLE_GROUPS } from '../lib/chatBotVariables';
import PulseActionEditor, { type PulseAction, SCENES_LIGHTS_TYPES, SOUND_TTS_TYPES, ADVANCED_ACTION_TYPES } from './PulseActionEditor';

export type CommandType = 'variable' | 'timed' | 'walkon' | 'keyword';
export type Permission = 'everyone' | 'subscriber' | 'vip' | 'moderator' | 'broadcaster';

export const PERM_CONFIG: Record<Permission, { label: string; color: string }> = {
  everyone:    { label: '👥 Everyone', color: '#059669' },
  subscriber:  { label: '⭐ Subs+',    color: '#9333ea' },
  vip:         { label: '💎 VIPs+',    color: '#db2777' },
  moderator:   { label: '🛡️ Mods+',   color: '#2563eb' },
  broadcaster: { label: '👑 Me Only',  color: '#ca8a04' },
};
export const PERM_ORDER = Object.keys(PERM_CONFIG) as Permission[];

export interface VariantRow { text: string; platform?: 'kick' | 'twitch' }

export interface CommandDraft {
  id?: string;
  name: string;
  message: string;
  type: CommandType;
  platform: 'all' | 'kick' | 'twitch';
  permission: Permission;
  cooldown_seconds: number;
  user_cooldown_seconds: number;
  aliases: string[];
  keyword_phrases: string[];
  hidden_from_public: boolean;
  condition_title: string;
  condition_game: string;
  rotation_messages: VariantRow[];
  rotation_mode: 'sequential' | 'random';
  target_username: string;
  send_as_user: boolean;
  action: 'none' | 'increment' | 'decrement' | 'set' | 'reset';
  action_target: string;
  action_value: string;
  sound_url: string;
  sound_volume: number;
  tts_enabled: boolean;
  tts_voice_provider: string;
  tts_voice_id: string;
  tts_voice_label: string;
  tts_voice_image: string;
  tts_read_name: boolean;
  trigger_type: 'interval' | 'stream_start' | 'stream_end';
  timer_minutes: string;
  offline_interval_minutes: string;
  min_chat_activity: string;
  walkon_username: string;
  walkon_skip_if_personal: boolean;
  enabled: boolean;
  actions: PulseAction[];
  keyword_match_all: boolean;
}

export function newCommandDraft(type: CommandType): CommandDraft {
  return {
    name: '', message: '', type, platform: 'all', permission: 'everyone',
    cooldown_seconds: 0, user_cooldown_seconds: 0,
    aliases: [], keyword_phrases: [], hidden_from_public: false,
    condition_title: '', condition_game: '',
    rotation_messages: [], rotation_mode: 'sequential',
    target_username: '', send_as_user: false,
    action: 'none', action_target: '', action_value: '1',
    sound_url: '', sound_volume: 80,
    tts_enabled: false, tts_voice_provider: '', tts_voice_id: '', tts_voice_label: '', tts_voice_image: '',
    tts_read_name: false,
    trigger_type: 'interval', timer_minutes: '', offline_interval_minutes: '', min_chat_activity: '',
    walkon_username: '', walkon_skip_if_personal: false,
    enabled: true,
    actions: [], keyword_match_all: false,
  };
}

export function draftFromRow(row: any): CommandDraft {
  const base = newCommandDraft(row.type || 'variable');
  const rotation = Array.isArray(row.rotation_messages)
    ? row.rotation_messages.map((m: any) => (typeof m === 'string' ? { text: m } : { text: m.text, platform: m.platform }))
    : [];
  return {
    ...base, ...row,
    aliases: row.aliases ?? [], keyword_phrases: row.keyword_phrases ?? [],
    rotation_messages: rotation,
    timer_minutes: row.timer_minutes != null ? String(row.timer_minutes) : '',
    offline_interval_minutes: row.offline_interval_minutes != null ? String(row.offline_interval_minutes) : '',
    min_chat_activity: row.min_chat_activity != null ? String(row.min_chat_activity) : '',
    condition_title: row.condition_title ?? '', condition_game: row.condition_game ?? '',
    target_username: row.target_username ?? '', walkon_username: row.walkon_username ?? '',
    sound_url: row.sound_url ?? '', action_target: row.action_target ?? '', action_value: row.action_value ?? '1',
    actions: Array.isArray(row.actions) ? row.actions : [],
    keyword_match_all: !!row.keyword_match_all,
  };
}

/** Converts a draft back into the exact payload shape the server expects —
 *  per-type, so a Timer never sends permission/cooldowns etc. */
export function draftToPayload(d: CommandDraft): Record<string, any> {
  const common = { name: d.name.trim(), message: d.message, type: d.type, platform: d.platform };
  const rotationForSave = d.type === 'timed'
    ? d.rotation_messages.map((r) => r.text)
    : d.rotation_messages;
  if (d.type === 'timed') {
    return {
      ...common, trigger_type: d.trigger_type,
      timer_minutes: d.timer_minutes ? Number(d.timer_minutes) : null,
      offline_interval_minutes: d.offline_interval_minutes ? Number(d.offline_interval_minutes) : null,
      min_chat_activity: d.min_chat_activity ? Number(d.min_chat_activity) : null,
      aliases: d.aliases, condition_title: d.condition_title || null, condition_game: d.condition_game || null,
      rotation_messages: rotationForSave.length ? rotationForSave : null, rotation_mode: d.rotation_mode,
      cooldown_seconds: 0, user_cooldown_seconds: 0, enabled: d.enabled,
    };
  }
  if (d.type === 'walkon') {
    return {
      ...common, walkon_username: d.walkon_username || null, walkon_skip_if_personal: d.walkon_skip_if_personal,
      sound_url: d.sound_url || null, sound_volume: d.sound_volume,
      tts_enabled: d.tts_enabled, tts_voice_provider: d.tts_voice_provider, tts_voice_id: d.tts_voice_id,
      tts_voice_label: d.tts_voice_label, tts_voice_image: d.tts_voice_image, tts_read_name: d.tts_read_name,
      action: d.action, action_target: d.action_target || null, action_value: d.action_value,
      enabled: d.enabled,
    };
  }
  // variable + keyword share almost everything
  return {
    ...common, permission: d.permission,
    cooldown_seconds: d.cooldown_seconds, user_cooldown_seconds: d.user_cooldown_seconds,
    aliases: d.type === 'variable' ? d.aliases : [],
    keyword_phrases: d.keyword_phrases,
    hidden_from_public: d.type === 'variable' ? d.hidden_from_public : false,
    condition_title: d.condition_title || null, condition_game: d.condition_game || null,
    rotation_messages: rotationForSave.length ? rotationForSave : null, rotation_mode: d.rotation_mode,
    target_username: d.target_username || null, send_as_user: d.send_as_user,
    action: d.action, action_target: d.action_target || null, action_value: d.action_value,
    sound_url: d.sound_url || null, sound_volume: d.sound_volume,
    tts_enabled: d.tts_enabled, tts_voice_provider: d.tts_voice_provider, tts_voice_id: d.tts_voice_id,
    tts_voice_label: d.tts_voice_label, tts_voice_image: d.tts_voice_image, tts_read_name: d.tts_read_name,
    enabled: d.enabled,
    actions: d.actions ?? [],
    keyword_match_all: d.type === 'keyword' ? d.keyword_match_all : false,
  };
}

function VariableChips({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: COLORS.accent, fontSize: 11, cursor: 'pointer', padding: 0 }}>
        {open ? 'Hide variables' : 'Insert a variable…'}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 10 }}>
          {VARIABLE_GROUPS.map((g) => (
            <div key={g.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.textFaint, textTransform: 'uppercase', marginBottom: 4 }}>{g.label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {g.tokens.map((t) => (
                  <button key={t} onClick={() => onInsert(t)} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, color: COLORS.textDim, cursor: 'pointer', fontFamily: 'monospace' }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommandModal({ draft, onChange, onSave, onCancel, saving, counters, isPremium, userId }: {
  draft: CommandDraft;
  onChange: (d: CommandDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  counters: string[];
  isPremium: boolean;
  userId: string | null;
}) {
  const set = (patch: Partial<CommandDraft>) => onChange({ ...draft, ...patch });
  const t = draft.type;
  const isVar = t === 'variable', isTimed = t === 'timed', isWalkon = t === 'walkon', isKeyword = t === 'keyword';
  const hasPermission = isVar || isKeyword;
  const hasCooldowns = isVar || isKeyword;
  const hasSoundTts = isVar || isWalkon || isKeyword;
  const hasCounterAction = isVar || isWalkon || isKeyword;
  const hasCondition = isVar || isTimed || isKeyword;
  const hasAliases = isVar || isTimed;
  const hasKeywordPhrases = isVar || isKeyword;
  const hasActions = isVar || isKeyword;

  // Tile rail + detail pane (2026-10-21 redesign, matching the website's own
  // CommandModal — direct feedback: aliases/keywords appeared before the
  // message, variables were always expanded, and the modal was forced too
  // narrow, forcing a long undifferentiated scroll). Checkbox-gating for the
  // optional "extra trigger" fields defaults to already-checked when editing
  // a row that already has data there — CommandModal is only ever mounted
  // while its own modal is open, so these lazy initializers re-evaluate
  // fresh every time it opens.
  const [showAliases, setShowAliases] = useState(() => draft.aliases.length > 0);
  const [showKeywordPhrases, setShowKeywordPhrases] = useState(() => draft.keyword_phrases.length > 0);
  const tiles = [
    { key: 'lights', label: 'Scenes & Lights', icon: '🎭', visible: hasActions,
      configured: draft.actions.some((a) => SCENES_LIGHTS_TYPES.includes(a.type)) },
    { key: 'sound', label: 'Sound & TTS', icon: '🔊', visible: hasSoundTts,
      configured: !!draft.sound_url || draft.tts_enabled || draft.actions.some((a) => SOUND_TTS_TYPES.includes(a.type)) },
    { key: 'counter', label: 'Counter', icon: '🔢', visible: hasCounterAction, configured: draft.action !== 'none' },
    { key: 'conditions', label: 'Conditions', icon: '🎯', visible: hasPermission || hasCondition,
      configured: (hasPermission && draft.permission !== 'everyone') || draft.cooldown_seconds > 0 || draft.user_cooldown_seconds > 0 || !!draft.condition_title || !!draft.condition_game },
    { key: 'aliases', label: 'Aliases & Keywords', icon: '🏷️', visible: hasAliases || hasKeywordPhrases,
      configured: draft.aliases.length > 0 || draft.keyword_phrases.length > 0 || draft.keyword_match_all },
    { key: 'advanced', label: 'Advanced', icon: '⚙️', visible: true,
      configured: draft.rotation_messages.length > 0 || draft.send_as_user || draft.actions.some((a) => ADVANCED_ACTION_TYPES.includes(a.type)) },
  ];
  const visibleTiles = tiles.filter((tl) => tl.visible);
  const [activeTile, setActiveTile] = useState<string>(() =>
    (visibleTiles.find((tl) => tl.configured) ?? visibleTiles[0])?.key ?? 'advanced');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)' }} onClick={onCancel} />
      <div style={{ position: 'relative', zIndex: 1, background: COLORS.panel, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 16, width: '100%', maxWidth: 920, maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px', flexShrink: 0 }}>{draft.id ? 'Edit' : 'Add'} {t === 'variable' ? 'Command' : t === 'timed' ? 'Timer' : t === 'walkon' ? 'Walk-on' : 'Keyword'}</h2>

        {/* Always-visible core fields — the 2-3 things everyone sets, never
            tucked behind a tile click. */}
        <div style={{ flexShrink: 0 }}>
          <Row label="Type">
            <Select value={t} onChange={(v) => onChange(newCommandDraft(v as CommandType))}
              options={[{ value: 'variable', label: 'Command' }, { value: 'timed', label: 'Timer' }, { value: 'walkon', label: 'Walk-on' }, { value: 'keyword', label: 'Keyword' }]} />
          </Row>

          <Row label={isWalkon ? 'Walk-on label' : isKeyword ? 'Label' : 'Name'}>
            <TextInput value={draft.name} onChange={(v) => set({ name: v })} placeholder={isVar || isTimed ? '!mycommand' : 'My label'} />
          </Row>

          {isWalkon && (
            <>
              <Row label="Specific viewer" hint="Blank = fires for any viewer's first chat this stream">
                <TextInput value={draft.walkon_username} onChange={(v) => set({ walkon_username: v })} placeholder="username (optional)" />
              </Row>
              {!draft.walkon_username && (
                <Row label="Skip if personal">
                  <Toggle checked={draft.walkon_skip_if_personal} onChange={(v) => set({ walkon_skip_if_personal: v })} label="Skip this generic walk-on if the chatter has their own" />
                </Row>
              )}
            </>
          )}

          {isTimed && (
            <>
              <Row label="Trigger">
                <Select value={draft.trigger_type} onChange={(v) => set({ trigger_type: v as CommandDraft['trigger_type'] })}
                  options={[{ value: 'interval', label: 'Repeats on an interval' }, { value: 'stream_start', label: 'When stream starts' }, { value: 'stream_end', label: 'When stream ends' }]} />
              </Row>
              {draft.trigger_type === 'interval' && (
                <>
                  <Row label="Online interval (min)" hint="Blank = don't fire while live on this basis">
                    <TextInput value={draft.timer_minutes} onChange={(v) => set({ timer_minutes: v.replace(/[^0-9]/g, '') })} style={{ width: 90 }} />
                  </Row>
                  <Row label="Offline interval (min)" hint="Fires while offline, independent of the online interval">
                    <TextInput value={draft.offline_interval_minutes} onChange={(v) => set({ offline_interval_minutes: v.replace(/[^0-9]/g, '') })} style={{ width: 90 }} />
                  </Row>
                  <Row label="Min chat messages" hint="Also wait for N real chat messages since the last send">
                    <TextInput value={draft.min_chat_activity} onChange={(v) => set({ min_chat_activity: v.replace(/[^0-9]/g, '') })} style={{ width: 90 }} />
                  </Row>
                </>
              )}
            </>
          )}

          <Row label="Message" align="flex-start">
            <div>
              <TextInput value={draft.message} onChange={(v) => set({ message: v })} multiline placeholder="What should it say? {sender} and other variables work here." />
              <VariableChips onInsert={(token) => set({ message: `${draft.message}${draft.message ? ' ' : ''}${token}` })} />
            </div>
          </Row>

          {isTimed && (
            <Row label="Response variants" align="flex-start" hint="Random/sequential alternatives — picked instead of the main message">
              <div style={{ width: '100%' }}>
                {draft.rotation_messages.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <TextInput value={r.text} onChange={(v) => set({ rotation_messages: draft.rotation_messages.map((x, xi) => xi === i ? { ...x, text: v } : x) })} style={{ flex: 1 }} />
                    <button onClick={() => set({ rotation_messages: draft.rotation_messages.filter((_, xi) => xi !== i) })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}><X size={14} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Button onClick={() => set({ rotation_messages: [...draft.rotation_messages, { text: '' }] })}><Plus size={12} />Add variant</Button>
                  {draft.rotation_messages.length > 1 && (
                    <Select value={draft.rotation_mode} onChange={(v) => set({ rotation_mode: v as CommandDraft['rotation_mode'] })}
                      options={[{ value: 'sequential', label: 'In order' }, { value: 'random', label: 'Random' }]} style={{ width: 120 }} />
                  )}
                </div>
              </div>
            </Row>
          )}
        </div>

        {/* Tile rail + detail pane (2026-10-21 redesign, matching the
            website's own CommandModal — direct feedback: aliases/keywords
            appeared before the message, variables were always expanded, and
            the modal was forced too narrow, forcing a long undifferentiated
            scroll). */}
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, marginTop: 8 }}>
          <div style={{ width: 170, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
            {visibleTiles.map((tl) => (
              <button key={tl.key} type="button" onClick={() => setActiveTile(tl.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  textAlign: 'left', cursor: 'pointer',
                  background: activeTile === tl.key ? 'rgba(124,58,237,0.16)' : 'transparent',
                  color: activeTile === tl.key ? '#fff' : COLORS.textDim,
                  border: `1px solid ${activeTile === tl.key ? 'rgba(124,58,237,0.4)' : 'transparent'}`,
                }}>
                <span>{tl.icon}</span>
                <span style={{ flex: 1 }}>{tl.label}</span>
                {tl.configured && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', flexShrink: 0 }} />}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>
            {activeTile === 'lights' && hasActions && (
              <Row label="Scenes & Lights" align="flex-start" hint="Optional — runs alongside the reply above">
                <PulseActionEditor actions={draft.actions} onChange={(a) => set({ actions: a })} userId={userId} rowLabel="Also run" locked={!isPremium} filterTypes={SCENES_LIGHTS_TYPES} />
              </Row>
            )}

            {activeTile === 'sound' && hasSoundTts && (
              <>
                <Row label="Sound effect">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <TextInput value={draft.sound_url} onChange={(v) => set({ sound_url: v })} placeholder="https://…/sound.mp3" style={{ flex: 1 }} />
                    {draft.sound_url && <NumberInput value={draft.sound_volume} min={0} max={100} onChange={(v) => set({ sound_volume: v })} style={{ width: 70 }} />}
                  </div>
                </Row>
                <Row label="Read with TTS">
                  <Toggle checked={draft.tts_enabled} onChange={(v) => set({ tts_enabled: v })} />
                </Row>
                {hasActions && (
                  <Row label="More powerful TTS" align="flex-start" hint="Optional — reads a fixed message or the viewer's own input through a specific saved voice">
                    <PulseActionEditor actions={draft.actions} onChange={(a) => set({ actions: a })} userId={userId} rowLabel="Also run" locked={!isPremium} filterTypes={SOUND_TTS_TYPES} />
                  </Row>
                )}
              </>
            )}

            {activeTile === 'counter' && hasCounterAction && (
              <Row label="Counter action">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Select value={draft.action} onChange={(v) => set({ action: v as CommandDraft['action'] })}
                    options={[{ value: 'none', label: 'None' }, { value: 'increment', label: 'Increment' }, { value: 'decrement', label: 'Decrement' }, { value: 'set', label: 'Set' }, { value: 'reset', label: 'Reset' }]} style={{ width: 130 }} />
                  {draft.action !== 'none' && (
                    <Select value={draft.action_target} onChange={(v) => set({ action_target: v })}
                      options={[{ value: '', label: 'pick a counter…' }, ...counters.map((c) => ({ value: c, label: c }))]} style={{ width: 160 }} />
                  )}
                </div>
              </Row>
            )}

            {activeTile === 'conditions' && (
              <>
                {hasPermission && (
                  <Row label="Who can trigger this">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {PERM_ORDER.map((p) => (
                        <button key={p} onClick={() => set({ permission: p })}
                          style={{
                            padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: draft.permission === p ? PERM_CONFIG[p].color : 'rgba(255,255,255,0.06)',
                            color: draft.permission === p ? '#fff' : COLORS.textDim,
                          }}>
                          {PERM_CONFIG[p].label}
                        </button>
                      ))}
                    </div>
                  </Row>
                )}
                {hasCooldowns && (
                  <Row label="Cooldowns">
                    <div style={{ display: 'flex', gap: 14 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.textDim }}>
                        Global <NumberInput value={draft.cooldown_seconds} min={0} onChange={(v) => set({ cooldown_seconds: v })} style={{ width: 70 }} /> s
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.textDim }}>
                        Per-viewer <NumberInput value={draft.user_cooldown_seconds} min={0} onChange={(v) => set({ user_cooldown_seconds: v })} style={{ width: 70 }} /> s
                      </span>
                    </div>
                  </Row>
                )}
                {hasCondition && (
                  <>
                    <Row label="Only if title has">
                      <TextInput value={draft.condition_title} onChange={(v) => set({ condition_title: v })} placeholder="optional" />
                    </Row>
                    <Row label="Only if game has">
                      <TextInput value={draft.condition_game} onChange={(v) => set({ condition_game: v })} placeholder="optional" />
                    </Row>
                  </>
                )}
              </>
            )}

            {activeTile === 'aliases' && (
              <>
                {hasAliases && (
                  <Row label="Aliases" hint="One per line, e.g. !hi" align="flex-start">
                    <div style={{ width: '100%' }}>
                      <Toggle checked={showAliases} onChange={setShowAliases} label="Add alternate trigger words" />
                      {showAliases && (
                        <div style={{ marginTop: 8 }}>
                          <TextInput multiline value={draft.aliases.join('\n')} onChange={(v) => set({ aliases: v.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                        </div>
                      )}
                    </div>
                  </Row>
                )}
                {isKeyword && (
                  <>
                    <Row label="Match every message" hint="Instead of specific phrases — set a cooldown in Conditions if you use this">
                      <Toggle checked={draft.keyword_match_all} onChange={(v) => set({ keyword_match_all: v })} />
                    </Row>
                    <Row label="Keyword phrases"
                      hint={draft.keyword_match_all ? 'Optional — ignored while "match every message" is on' : 'Required — the actual trigger, one per line'}
                      align="flex-start">
                      <TextInput multiline value={draft.keyword_phrases.join('\n')} onChange={(v) => set({ keyword_phrases: v.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                    </Row>
                  </>
                )}
                {isVar && (
                  <Row label="Keyword phrase" hint="Optional extra trigger alongside the ! command" align="flex-start">
                    <div style={{ width: '100%' }}>
                      <Toggle checked={showKeywordPhrases} onChange={setShowKeywordPhrases} label="Also fire on a keyword phrase" />
                      {showKeywordPhrases && (
                        <div style={{ marginTop: 8 }}>
                          <TextInput multiline value={draft.keyword_phrases.join('\n')} onChange={(v) => set({ keyword_phrases: v.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                        </div>
                      )}
                    </div>
                  </Row>
                )}
              </>
            )}

            {activeTile === 'advanced' && (
              <>
                {(isVar || isKeyword) && (
                  <Row label="Response variants" align="flex-start" hint="Random/sequential alternatives — picked instead of the main message">
                    <div style={{ width: '100%' }}>
                      {draft.rotation_messages.map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <TextInput value={r.text} onChange={(v) => set({ rotation_messages: draft.rotation_messages.map((x, xi) => xi === i ? { ...x, text: v } : x) })} style={{ flex: 1 }} />
                          <Select value={r.platform ?? 'all'} onChange={(v) => set({ rotation_messages: draft.rotation_messages.map((x, xi) => xi === i ? { ...x, platform: v === 'all' ? undefined : v as 'kick' | 'twitch' } : x) })}
                            options={[{ value: 'all', label: 'All' }, { value: 'kick', label: 'Kick' }, { value: 'twitch', label: 'Twitch' }]} style={{ width: 90 }} />
                          <button onClick={() => set({ rotation_messages: draft.rotation_messages.filter((_, xi) => xi !== i) })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}><X size={14} /></button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <Button onClick={() => set({ rotation_messages: [...draft.rotation_messages, { text: '' }] })}><Plus size={12} />Add variant</Button>
                        {draft.rotation_messages.length > 1 && (
                          <Select value={draft.rotation_mode} onChange={(v) => set({ rotation_mode: v as CommandDraft['rotation_mode'] })}
                            options={[{ value: 'sequential', label: 'In order' }, { value: 'random', label: 'Random' }]} style={{ width: 120 }} />
                        )}
                      </div>
                    </div>
                  </Row>
                )}

                <Row label={isWalkon ? 'Fires on' : 'Send to platform'}>
                  <Select value={draft.platform} onChange={(v) => set({ platform: v as CommandDraft['platform'] })}
                    options={[{ value: 'all', label: 'Kick + Twitch' }, { value: 'kick', label: 'Kick only' }, { value: 'twitch', label: 'Twitch only' }]} />
                </Row>

                {isVar && (
                  <Row label="Hide from public page">
                    <Toggle checked={draft.hidden_from_public} onChange={(v) => set({ hidden_from_public: v })} />
                  </Row>
                )}

                {hasActions && (
                  <Row label="More Actions" align="flex-start" hint="Optional — OBS, points, timers, moderation and more">
                    <PulseActionEditor actions={draft.actions} onChange={(a) => set({ actions: a })} userId={userId} rowLabel="Also run" locked={!isPremium} filterTypes={ADVANCED_ACTION_TYPES} />
                  </Row>
                )}

                {(isVar || isKeyword) && (
                  <Row label="Send as you" hint="Kick only — posts as the broadcaster instead of the bot">
                    <Toggle checked={draft.send_as_user} onChange={(v) => set({ send_as_user: v })} />
                  </Row>
                )}

                <Row label="Enabled">
                  <Toggle checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
                </Row>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexShrink: 0 }}>
          <Button variant="primary" onClick={onSave} disabled={saving || !draft.name.trim() || (!draft.message.trim() && draft.actions.length === 0)}>{saving ? 'Saving…' : draft.id ? 'Save' : 'Add'}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
