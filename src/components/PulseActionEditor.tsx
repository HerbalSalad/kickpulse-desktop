// src/components/PulseActionEditor.tsx — shared THEN-action editor, native
// port of the website's own src/components/PulseActionEditor.tsx (see
// PulseTriggerEditor.tsx's own header for why this got ported natively
// rather than embedded). One list of action types, one set of target
// pickers, executed server-side by the exact same pulseRules.js
// runAction() the website's own rules run through — this app only ever
// edits the same pulse_rules row, through the same /pulse-rules API
// (electron/api.ts), never a second schema.
//
// Three picker data sources, three different mechanisms, same as the
// website's own version conceptually, adapted to what's actually available
// from an Electron renderer:
//   - Spin Wheel / Timers / Pulse Scenes / To-Do tasks / Virtual Lights —
//     real widget config tables, anon-open, read directly via Supabase
//     (src/lib/supabase.ts) exactly like the website's own version does.
//   - Counters / TTS voices — go through the website's own API with this
//     app's API-key credential (electron/api.ts, each route widened
//     2026-10-18 specifically for this).
//   - OBS scenes/sources / light devices — this app already HAS this data
//     locally and live (ObsControlPage.tsx/DevicesPage.tsx already read it
//     the same way) — no server round-trip needed at all, unlike the
//     website's own version which only ever sees whatever this app last
//     REPORTED to it.
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Select, TextInput, NumberInput, Row, Toggle, ColorInput, Dropdown, COLORS } from './ui';
import { supabase } from '../lib/supabase';
import PulseTriggerEditor, { DEFAULT_TRIGGERS, type Trigger } from './PulseTriggerEditor';

export interface PulseAction {
  type: string;
  message?: string;
  sendAsUser?: boolean;
  amount?: number;
  seconds?: number;
  variable?: string;
  configId?: string;
  timerId?: string;
  pulseSceneId?: string;
  voiceProvider?: string;
  voiceId?: string;
  voiceLabel?: string;
  voiceImage?: string;
  useViewerInput?: boolean;
  taskId?: string;
  target?: 'self' | 'input';
  durationSeconds?: number;
  sceneName?: string;
  lightReactionId?: string; // light_fire_reaction target (electron/light-reactions.ts)
  lightSceneId?: string;    // light_set_scene target (electron/light-scenes.ts)
  lightTarget?: string;
  lightOn?: boolean;
  lightBrightness?: number;
  lightColor?: string;
  obsSourceScene?: string;
  obsSourceName?: string;
  obsSourceVisible?: boolean;
  meldSceneId?: string;
  meldLayerSceneId?: string;
  meldLayerId?: string;
  meldClipDuration?: number; // meld_record_clip, seconds, 0-90, blank = max
  virtualLightConfigId?: string;
  lightMomentary?: boolean;
  lightHoldMs?: number;
  retrigger?: 'restart' | 'stack' | 'ignore';
  showTimerId?: string;
  trigger?: Trigger;
  sameViewer?: boolean;
  timeoutSeconds?: number;
  onTimeout?: 'continue' | 'stop';
  op?: 'start' | 'pause' | 'reset';
}

// No desktopOnly filtering here — unlike the website (which hides these from
// everyone but one gated tester account, see lib/desktopOnlyActions.js), this
// IS the desktop app: every one of these is exactly what it's for, and the
// server-side gate still independently enforces who's allowed to actually
// save them.
export const ACTION_DEFS: { type: string; label: string; hint: string }[] = [
  { type: 'bot_message',        label: '💬 Send Chat Message',   hint: 'Bot speaks — {username} and {amount} are substituted' },
  { type: 'award_points',       label: '🪙 Award Pulse Points',  hint: 'Granted to the viewer who triggered it' },
  { type: 'spin_wheel',         label: '🎡 Spin the Wheel',      hint: 'Spins one specific wheel, or all active wheels' },
  { type: 'trigger_scene',      label: '🎭 Trigger Scene',       hint: 'Plays one of your Scenes — text, media, lights, shapes, and sound' },
  { type: 'jumpscare',          label: '👻 Trigger Jumpscare',   hint: 'Fires the Jumpscare Meter overlay' },
  { type: 'add_subathon_time',  label: '⏱ Add/Remove Timer Time', hint: 'Adds or removes seconds from one timer, or all running subathon timers' },
  { type: 'increment_variable', label: '🔢 Bump Counter',        hint: 'Increments one of your counters (Counter Display shows it)' },
  { type: 'song_request',       label: '🎵 Queue Song Request',  hint: "Adds the viewer's typed input to the song queue — bypasses !sr role/cost gates" },
  { type: 'tts_speak',          label: '🔊 Read with TTS',       hint: "Speaks a fixed message you write, or the viewer's typed input, aloud through your System Sounds widget" },
  { type: 'timeout_user',       label: '👢 Timeout a Viewer',    hint: 'A REAL chat timeout — not a message. Times out the redeemer, or whoever they type.' },
  { type: 'ban_user',           label: '🔨 Ban a Viewer',        hint: 'A REAL permanent ban — not a message. Bans the redeemer, or whoever they type.' },
  { type: 'unban_user',         label: '🕊 Unban a Viewer',      hint: 'Lifts a ban or an active timeout from whoever they type in' },
  { type: 'todo_reveal_task',   label: '📋 Reveal To-Do Task',   hint: 'Reveals a hidden/gated To-Do List task without starting its timer' },
  { type: 'todo_start_task',    label: '📋 Start To-Do Task',    hint: 'Reveals (if needed) and starts a To-Do List task’s timer' },
  { type: 'timer_control',      label: '⏱ Control a Timer',      hint: 'Start, pause or reset one of your Stream Timers' },
  { type: 'obs_switch_scene',   label: '🎬 Switch OBS Scene',    hint: 'Switches OBS to this scene right now' },
  { type: 'obs_start_stream',   label: '🔴 Start Streaming (OBS)', hint: 'Starts streaming in OBS' },
  { type: 'obs_stop_stream',    label: '⏹ Stop Streaming (OBS)',  hint: 'Stops streaming in OBS' },
  { type: 'obs_start_record',   label: '⏺ Start Recording (OBS)', hint: 'Starts recording in OBS' },
  { type: 'obs_stop_record',    label: '⏹ Stop Recording (OBS)',  hint: 'Stops recording in OBS' },
  { type: 'obs_toggle_source',  label: '👁 Show/Hide OBS Source', hint: 'Shows/hides a specific source inside a specific scene' },
  { type: 'obs_start_replay_buffer', label: '🟢 Start Replay Buffer (OBS)', hint: 'Starts the replay buffer in OBS' },
  { type: 'obs_stop_replay_buffer',  label: '🔴 Stop Replay Buffer (OBS)',  hint: 'Stops the replay buffer in OBS' },
  { type: 'obs_save_replay_buffer',  label: '🎞 Save Clip (Replay Buffer)', hint: 'Saves the last few minutes to disk right now — e.g. bind this to a !clip chat command' },
  { type: 'meld_switch_scene',  label: '🎬 Switch Meld Scene',    hint: 'Switches Meld Studio to this scene right now' },
  { type: 'meld_start_stream',  label: '🔴 Start Streaming (Meld)', hint: 'Starts streaming in Meld Studio' },
  { type: 'meld_stop_stream',   label: '⏹ Stop Streaming (Meld)',  hint: 'Stops streaming in Meld Studio' },
  { type: 'meld_start_record',  label: '⏺ Start Recording (Meld)', hint: 'Starts recording in Meld Studio' },
  { type: 'meld_stop_record',   label: '⏹ Stop Recording (Meld)',  hint: 'Stops recording in Meld Studio' },
  { type: 'meld_toggle_layer',  label: '👁 Show/Hide Meld Layer', hint: 'Shows/hides a specific layer inside a specific scene' },
  { type: 'meld_record_clip',  label: '🎞 Save Clip (Meld)',      hint: 'Saves the last few seconds to disk right now — e.g. bind this to a !clip chat command' },
  { type: 'meld_show_replay',  label: '📺 Show Replay (Meld)',    hint: 'Plays the most recent clip back as an overlay on the current scene' },
  { type: 'meld_dismiss_replay', label: '✖ Dismiss Replay (Meld)', hint: 'Removes the replay overlay' },
  { type: 'light_set_state',    label: '💡 Set Light State',      hint: 'Changes a configured WLED/Hue/Govee light' },
  { type: 'light_fire_reaction', label: '🎨 Fire a Light Reaction', hint: 'Plays a saved timed lighting effect, then restores whichever Light Scene is active' },
  { type: 'light_set_scene',    label: '💡 Set Light Scene',       hint: 'Makes a saved Light Scene the new baseline and applies it now' },
  { type: 'virtual_light_set_state', label: '🔆 Set Virtual Light State', hint: 'Changes a Virtual Light widget on your overlay — no hardware needed' },
];

export const SEQUENCE_DEFS: { type: string; label: string; hint: string }[] = [
  { type: 'wait',     label: '⏳ Wait',         hint: 'Pause here for a set time (up to 7 days), then carry on with the steps below' },
  { type: 'wait_for', label: '👂 Wait for…',    hint: 'Pause here until another WHEN happens (e.g. a chat command), then carry on' },
];
const ALL_DEFS = [...ACTION_DEFS, ...SEQUENCE_DEFS];

// Category type-lists (2026-10-21) — same mechanism as the website's own
// version, see that file's own comment on these three consts.
export const SCENES_LIGHTS_TYPES = ['trigger_scene', 'light_set_state', 'light_set_scene', 'light_fire_reaction', 'virtual_light_set_state'];
export const SOUND_TTS_TYPES = ['tts_speak'];
export const ADVANCED_ACTION_TYPES = ACTION_DEFS.map(d => d.type).filter(t => !SCENES_LIGHTS_TYPES.includes(t) && !SOUND_TTS_TYPES.includes(t));

export function fmtDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, (sec || !(d || h || m)) && `${sec}s`].filter(Boolean).join(' ');
}

export const describeAction = (a: PulseAction) => {
  if (a.type === 'wait') return `Wait ${fmtDuration(a.seconds ?? 0)}`;
  if (a.type === 'wait_for') return `Wait for a WHEN${a.timeoutSeconds ? ` (up to ${fmtDuration(a.timeoutSeconds)})` : ''}`;
  return ALL_DEFS.find(d => d.type === a.type)?.label.replace(/^\S+\s/, '') ?? a.type;
};

interface TargetOption { id: string; name: string; mode?: string }

const UNITS = [{ label: 'seconds', mult: 1 }, { label: 'minutes', mult: 60 }, { label: 'hours', mult: 3600 }, { label: 'days', mult: 86400 }];
function DurationInput({ seconds, onChange, min = 1 }: { seconds: number; onChange: (s: number) => void; min?: number }) {
  const [mult, setMult] = useState(() => [...UNITS].reverse().find(u => seconds > 0 && seconds % u.mult === 0)?.mult ?? 60);
  const shown = seconds > 0 ? Math.round((seconds / mult) * 1000) / 1000 : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <NumberInput value={shown} min={0} onChange={(v) => onChange(Math.max(min, Math.round(v * mult)))} style={{ width: 80 }} />
      <Select value={String(mult)} onChange={(v) => { const m = Number(v); setMult(m); onChange(Math.max(min, Math.round((seconds / mult) * m))); }}
        options={UNITS.map(u => ({ value: String(u.mult), label: u.label }))} style={{ width: 100 }} />
    </span>
  );
}

export function healCookedActionIds(actions: PulseAction[], lists: {
  pulseScenes: TargetOption[]; wheels: TargetOption[];
  timers: TargetOption[]; todoTasks: TargetOption[]; virtualLights?: TargetOption[];
  lightReactions?: TargetOption[]; lightScenes?: TargetOption[];
}): PulseAction[] {
  const validScenes = new Set(lists.pulseScenes.map(s => s.id));
  const validWheels = new Set(lists.wheels.map(w => w.id));
  const validTimers = new Set(lists.timers.map(t => t.id));
  const validTasks = new Set(lists.todoTasks.map(t => t.id));
  const validLights = new Set((lists.virtualLights ?? []).map(l => l.id));
  const validReactions = new Set((lists.lightReactions ?? []).map(p => p.id));
  const validLightScenes = new Set((lists.lightScenes ?? []).map(p => p.id));
  let changed = false;
  const healed = actions.map(a => {
    if (a.type === 'trigger_scene' && a.pulseSceneId && lists.pulseScenes.length > 0 && !validScenes.has(a.pulseSceneId)) { changed = true; return { ...a, pulseSceneId: undefined }; }
    if (a.type === 'spin_wheel' && a.configId && lists.wheels.length > 0 && !validWheels.has(a.configId)) { changed = true; return { ...a, configId: undefined }; }
    if ((a.type === 'add_subathon_time' || a.type === 'timer_control') && a.timerId && lists.timers.length > 0 && !validTimers.has(a.timerId)) { changed = true; return { ...a, timerId: undefined }; }
    if (a.type === 'wait' && a.showTimerId && lists.timers.length > 0 && !validTimers.has(a.showTimerId)) { changed = true; return { ...a, showTimerId: undefined }; }
    if ((a.type === 'todo_reveal_task' || a.type === 'todo_start_task') && a.taskId && lists.todoTasks.length > 0 && !validTasks.has(a.taskId)) { changed = true; return { ...a, taskId: undefined }; }
    if (a.type === 'virtual_light_set_state' && a.virtualLightConfigId && (lists.virtualLights?.length ?? 0) > 0 && !validLights.has(a.virtualLightConfigId)) { changed = true; return { ...a, virtualLightConfigId: undefined }; }
    if (a.type === 'light_fire_reaction' && a.lightReactionId && (lists.lightReactions?.length ?? 0) > 0 && !validReactions.has(a.lightReactionId)) { changed = true; return { ...a, lightReactionId: undefined }; }
    if (a.type === 'light_set_scene' && a.lightSceneId && (lists.lightScenes?.length ?? 0) > 0 && !validLightScenes.has(a.lightSceneId)) { changed = true; return { ...a, lightSceneId: undefined }; }
    return a;
  });
  return changed ? healed : actions;
}

export default function PulseActionEditor({ actions, onChange, userId, rowLabel = 'Then', locked, filterTypes }: {
  actions: PulseAction[];
  onChange: (actions: PulseAction[]) => void;
  userId: string | null;
  rowLabel?: string;
  // filterTypes (2026-10-21) — same mechanism as the website's own version:
  // when set, this instance only shows/edits actions whose type is in this
  // list, and the type-picker/"+ Add action" button only offer these types.
  // Lets Commands/Keywords' categorized editor (Scenes & Lights / Sound &
  // TTS / Advanced) render 3 separate panels against the SAME underlying
  // `actions` array. Sequence steps (wait/wait_for) are never offered when
  // this is set. Omitted for Pulse Engine's own rule editor (unchanged).
  filterTypes?: string[];
  // Commands/Keywords (2026-10-21) — Actions are Premium-only there; a
  // downgraded account's already-saved actions show read-only (matches the
  // website's own PulseActionEditor.tsx `locked` prop).
  locked?: boolean;
}) {
  const [wheels, setWheels] = useState<TargetOption[]>([]);
  const [timers, setTimers] = useState<TargetOption[]>([]);
  const [pulseScenes, setPulseScenes] = useState<TargetOption[]>([]);
  const [counters, setCounters] = useState<string[]>([]);
  const [voices, setVoices] = useState<any[]>([]);
  const [todoTasks, setTodoTasks] = useState<TargetOption[]>([]);
  const [obsScenes, setObsScenes] = useState<TargetOption[]>([]);
  const [obsSources, setObsSources] = useState<TargetOption[]>([]);
  const [meldScenes, setMeldScenes] = useState<TargetOption[]>([]);
  const [meldLayers, setMeldLayers] = useState<TargetOption[]>([]);
  const [lightDevices, setLightDevices] = useState<TargetOption[]>([]);
  const [lightReactions, setLightReactions] = useState<TargetOption[]>([]);
  const [lightScenes, setLightScenes] = useState<TargetOption[]>([]);
  const [virtualLights, setVirtualLights] = useState<TargetOption[]>([]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('spin_wheel_configs').select('id,config').eq('user_id', userId)
      .then(({ data }) => setWheels((data ?? []).map((r: any, i: number) => ({ id: r.id, name: r.config?.configName || `Wheel ${i + 1}` }))));
    supabase.from('stream_timers').select('id,timer_name,mode').eq('user_id', userId)
      .then(({ data }) => setTimers((data ?? []).map((r: any, i: number) => ({ id: r.id, name: r.timer_name || `Timer ${i + 1}`, mode: r.mode }))));
    supabase.from('scenes_configs').select('config').eq('user_id', userId)
      .then(({ data }) => setPulseScenes((data ?? []).flatMap((r: any) => (r.config?.scenes ?? []).map((s: any) => ({ id: s.id, name: s.name || 'Unnamed scene' })))));
    supabase.from('todo_list_configs').select('config').eq('user_id', userId)
      .then(({ data }) => setTodoTasks((data ?? []).flatMap((r: any) => (r.config?.items ?? []).map((t: any) => ({ id: t.id, name: t.text || 'Untitled task' })))));
    supabase.from('virtual_light_configs').select('id,config').eq('user_id', userId)
      .then(({ data }) => setVirtualLights((data ?? []).map((r: any, i: number) => ({ id: r.id, name: r.config?.configName || `Light ${i + 1}` }))));
  }, [userId]);

  useEffect(() => {
    window.kickpulseDesktop.pulseRules.counters().then(setCounters).catch(() => {});
    window.kickpulseDesktop.pulseRules.ttsVoices().then(setVoices).catch(() => {});
  }, []);

  // OBS scenes/sources and light devices — this app already has this data
  // locally and live (same source ObsControlPage.tsx/DevicesPage.tsx read),
  // so no server round-trip at all, unlike the website's own version.
  useEffect(() => {
    window.kickpulseDesktop.obsGetStatus().then((s) => {
      setObsScenes(s.scenes.map((sc) => ({ id: sc.sceneUuid, name: sc.sceneName })));
      setObsSources(s.sources.map((src) => ({ id: `${src.sceneName}\u001f${src.sourceName}`, name: `${src.sourceName} — in ${src.sceneName}` })));
    }).catch(() => {});
    window.kickpulseDesktop.lightsListDevices().then((devices) => {
      setLightDevices(devices.map((d) => ({ id: d.id, name: d.name })));
    }).catch(() => {});
    window.kickpulseDesktop.lightsListReactions().then((reactions) => {
      setLightReactions(reactions.map((r) => ({ id: r.id, name: r.name })));
    }).catch(() => {});
    window.kickpulseDesktop.lightsListScenes().then((scenes) => {
      setLightScenes(scenes.map((s) => ({ id: s.id, name: s.name })));
    }).catch(() => {});
    // No unsubscribe here — onObsStatus (preload.ts) is a plain
    // ipcRenderer.on with no off()/cleanup, same limitation every other
    // caller of it in this app already has (e.g. App.tsx's onStatus). Not
    // fixed here; out of scope for this editor.
    window.kickpulseDesktop.onObsStatus((s) => {
      setObsScenes(s.scenes.map((sc) => ({ id: sc.sceneUuid, name: sc.sceneName })));
      setObsSources(s.sources.map((src) => ({ id: `${src.sceneName}\u001f${src.sourceName}`, name: `${src.sourceName} — in ${src.sceneName}` })));
    });
  }, []);

  // Meld Studio scenes/layers (2026-10-25) — same "already have this data
  // locally and live" reasoning as the OBS block right above.
  useEffect(() => {
    window.kickpulseDesktop.meldGetStatus().then((s) => {
      setMeldScenes(s.scenes.map((sc) => ({ id: sc.sceneId, name: sc.sceneName })));
      setMeldLayers(s.layers.map((l) => ({ id: `${l.sceneId}\u001f${l.layerId}`, name: l.layerName })));
    }).catch(() => {});
    window.kickpulseDesktop.onMeldStatus((s) => {
      setMeldScenes(s.scenes.map((sc) => ({ id: sc.sceneId, name: sc.sceneName })));
      setMeldLayers(s.layers.map((l) => ({ id: `${l.sceneId}\u001f${l.layerId}`, name: l.layerName })));
    });
  }, []);

  useEffect(() => {
    const healed = healCookedActionIds(actions, { pulseScenes, wheels, timers, todoTasks, virtualLights, lightReactions, lightScenes });
    if (healed !== actions) onChange(healed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseScenes, wheels, timers, todoTasks, virtualLights, lightReactions, lightScenes]);

  const categoryDefs = filterTypes ? ACTION_DEFS.filter(d => filterTypes.includes(d.type)) : ACTION_DEFS;
  const setAction = (idx: number, patch: Partial<PulseAction>) => onChange(actions.map((a, i) => i === idx ? { ...a, ...patch } : a));
  const removeAction = (idx: number) => onChange(actions.filter((_, i) => i !== idx));
  const addAction = () => {
    const t = filterTypes?.[0] ?? 'bot_message';
    onChange([...actions, t === 'bot_message' ? { type: t, message: '' } : { type: t }]);
  };
  const addWait = () => onChange([...actions, { type: 'wait', seconds: 3600 }]);
  const addWaitFor = () => onChange([...actions, { type: 'wait_for', trigger: { ...DEFAULT_TRIGGERS.chat_command }, sameViewer: true, onTimeout: 'continue' }]);
  const changeType = (idx: number, type: string) => {
    const fresh: PulseAction =
      type === 'wait' ? { type, seconds: 3600 }
      : type === 'wait_for' ? { type, trigger: { ...DEFAULT_TRIGGERS.chat_command }, sameViewer: true, onTimeout: 'continue' }
      : type === 'timer_control' ? { type, op: 'start' }
      : { type };
    onChange(actions.map((x, i) => (i === idx ? fresh : x)));
  };
  const countdownTimers = timers.filter(t => t.mode === 'countdown');
  const hasWait = actions.some(a => a.type === 'wait' || a.type === 'wait_for');

  if (locked) {
    const shown = filterTypes ? actions.filter(a => filterTypes.includes(a.type)) : actions;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.length === 0 && <div style={{ fontSize: 12, color: COLORS.textFaint }}>No actions saved.</div>}
        {shown.map((a, i) => (
          <div key={i} style={{
            background: 'rgba(0,0,0,0.25)', border: `1px solid ${COLORS.border}`, borderRadius: 8,
            padding: '6px 10px', fontSize: 13, color: COLORS.textDim,
          }}>
            {a.type === 'wait' || a.type === 'wait_for' ? '⏳ ' : '• '}{describeAction(a)}
          </div>
        ))}
        <div style={{ fontSize: 11, color: COLORS.accent }}>
          ⭐ Upgrade on the website to add actions like lights, OBS, TTS and more
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {actions
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) => !filterTypes || filterTypes.includes(a.type))
        .map(({ a, idx }) => {
        const isWait = a.type === 'wait', isWaitFor = a.type === 'wait_for';
        const tone = isWait ? { border: 'rgba(245,158,11,0.3)', bg: 'rgba(245,158,11,0.06)' }
          : isWaitFor ? { border: 'rgba(56,189,248,0.3)', bg: 'rgba(56,189,248,0.06)' }
          : { border: 'rgba(255,255,255,0.08)', bg: 'rgba(0,0,0,0.25)' };
        const labelColor = isWait ? '#f59e0b' : isWaitFor ? '#38bdf8' : '#a78bfa';
        return (
          <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 12, padding: '10px 14px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: labelColor, width: 60 }}>
              {isWait || isWaitFor ? 'Then pause' : (idx > 0 && actions.slice(0, idx).some(x => x.type === 'wait' || x.type === 'wait_for') ? 'After' : rowLabel)}
            </span>
            <Select value={a.type} onChange={(v) => changeType(idx, v)} title={ALL_DEFS.find(d => d.type === a.type)?.hint}
              options={filterTypes
                ? categoryDefs.map(d => ({ value: d.type, label: d.label }))
                : [
                  ...ACTION_DEFS.map(d => ({ value: d.type, label: d.label })),
                  ...SEQUENCE_DEFS.map(d => ({ value: d.type, label: d.label })),
                ]} style={{ width: 230 }} />

            {isWait && (
              <>
                <DurationInput seconds={a.seconds ?? 0} onChange={(s) => setAction(idx, { seconds: s })} />
                <Select value={a.showTimerId ?? ''} onChange={(v) => setAction(idx, { showTimerId: v || undefined })}
                  title="Starts one of your countdown timers for the same length, so the wait shows on stream"
                  options={[{ value: '', label: 'No on-screen timer' }, ...countdownTimers.map(t => ({ value: t.id, label: `Show on timer: ${t.name}` }))]} style={{ width: 200 }} />
                <Row label="if it happens again">
                  <Select value={a.retrigger ?? 'restart'} onChange={(v) => setAction(idx, { retrigger: v as PulseAction['retrigger'] })}
                    options={[{ value: 'restart', label: 'restart the wait' }, { value: 'stack', label: 'run both' }, { value: 'ignore', label: 'ignore it' }]} style={{ width: 150 }} />
                </Row>
                <span style={{ width: '100%', fontSize: 11, color: '#6b7280' }}>
                  Everything above runs now; everything below runs after the wait, even if the app restarts in between.
                  {countdownTimers.length === 0 && ' (Countdown timers show up here for the on-screen option.)'}
                </span>
              </>
            )}

            {isWaitFor && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', width: 48 }}>When</span>
                  <PulseTriggerEditor value={a.trigger ?? { ...DEFAULT_TRIGGERS.chat_command }} onChange={(nt) => setAction(idx, { trigger: nt })} userId={userId} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, fontSize: 12, color: '#9ca3af' }}>
                  <Toggle checked={!!a.sameViewer} onChange={(v) => setAction(idx, { sameViewer: v })} label="only the same viewer" />
                  <Toggle checked={!!a.timeoutSeconds} onChange={(v) => setAction(idx, { timeoutSeconds: v ? 3600 : undefined })} label="give up after" />
                  {!!a.timeoutSeconds && (
                    <>
                      <DurationInput seconds={a.timeoutSeconds} onChange={(s) => setAction(idx, { timeoutSeconds: s })} />
                      <Select value={a.onTimeout ?? 'continue'} onChange={(v) => setAction(idx, { onTimeout: v as 'continue' | 'stop' })}
                        options={[{ value: 'continue', label: 'then carry on anyway' }, { value: 'stop', label: 'then stop here' }]} style={{ width: 170 }} />
                    </>
                  )}
                  <Row label="if it happens again">
                    <Select value={a.retrigger ?? 'restart'} onChange={(v) => setAction(idx, { retrigger: v as PulseAction['retrigger'] })}
                      options={[{ value: 'restart', label: 'restart the wait' }, { value: 'stack', label: 'run both' }, { value: 'ignore', label: 'ignore it' }]} style={{ width: 150 }} />
                  </Row>
                </div>
                <span style={{ fontSize: 11, color: '#6b7280' }}>Everything above runs now. The steps below wait until one of these happens, then run — with the original viewer still in {'{username}'}.</span>
              </div>
            )}

            {a.type === 'timer_control' && (
              <>
                <Select value={a.op ?? 'start'} onChange={(v) => setAction(idx, { op: v as PulseAction['op'] })}
                  options={[{ value: 'start', label: 'Start' }, { value: 'pause', label: 'Pause' }, { value: 'reset', label: 'Reset' }]} style={{ width: 110 }} />
                <Select value={a.timerId ?? ''} onChange={(v) => setAction(idx, { timerId: v || undefined })}
                  options={[{ value: '', label: 'pick a timer…' }, ...timers.map(t => ({ value: t.id, label: t.name }))]} style={{ width: 180 }} />
                {(a.op ?? 'start') === 'start' && (
                  <>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>for</span>
                    <DurationInput seconds={a.seconds ?? 0} min={0} onChange={(s) => setAction(idx, { seconds: s || undefined })} />
                    <span style={{ fontSize: 11, color: '#6b7280' }}>(blank = the timer's own length)</span>
                  </>
                )}
              </>
            )}

            {a.type === 'bot_message' && (
              <>
                <TextInput value={a.message ?? ''} onChange={(v) => setAction(idx, { message: v })} placeholder="Message — {username}, {amount}" style={{ minWidth: 260, flex: 1 }} />
                <Toggle checked={!!a.sendAsUser} onChange={(v) => setAction(idx, { sendAsUser: v })} label="Send as you (not the bot)" />
              </>
            )}
            {a.type === 'award_points' && (
              <NumberInput value={a.amount ?? 100} min={1} onChange={(v) => setAction(idx, { amount: v })} style={{ width: 100 }} />
            )}
            {a.type === 'spin_wheel' && (
              <Select value={a.configId ?? ''} onChange={(v) => setAction(idx, { configId: v || undefined })}
                options={[{ value: '', label: 'All active wheels' }, ...wheels.map(w => ({ value: w.id, label: w.name }))]} style={{ width: 200 }} />
            )}
            {a.type === 'add_subathon_time' && (() => {
              const seconds = a.seconds ?? 60;
              const isRemove = seconds < 0;
              const magnitude = Math.abs(seconds) || 60;
              return (
                <>
                  <Select value={isRemove ? 'remove' : 'add'} onChange={(v) => setAction(idx, { seconds: v === 'remove' ? -magnitude : magnitude })}
                    options={[{ value: 'add', label: 'Add' }, { value: 'remove', label: 'Remove' }]} style={{ width: 100 }} />
                  <NumberInput value={magnitude} min={1} onChange={(v) => setAction(idx, { seconds: isRemove ? -Math.max(1, v) : Math.max(1, v) })} style={{ width: 90 }} />
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>seconds {isRemove ? 'from' : 'to'}</span>
                  <Select value={a.timerId ?? ''} onChange={(v) => setAction(idx, { timerId: v || undefined })}
                    options={[{ value: '', label: 'All running subathon timers' }, ...timers.map(t => ({ value: t.id, label: t.name }))]} style={{ width: 200 }} />
                </>
              );
            })()}
            {a.type === 'increment_variable' && (
              counters.length > 0 ? (
                <>
                  <Select value={a.variable ?? ''} onChange={(v) => setAction(idx, { variable: v })}
                    options={[{ value: '', label: 'pick a counter…' }, ...counters.map(c => ({ value: c, label: c }))]} style={{ width: 180 }} />
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>+</span>
                  <NumberInput value={a.amount ?? 1} onChange={(v) => setAction(idx, { amount: v })} style={{ width: 70 }} />
                </>
              ) : <span style={{ fontSize: 12, color: '#6b7280' }}>No counters yet — create one on the Counters page first</span>
            )}
            {a.type === 'song_request' && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>queues the viewer's input — set "Ask the viewer for input" (e.g. song name) on the reward</span>
            )}
            {a.type === 'tts_speak' && (
              voices.length === 0 ? (
                <span style={{ fontSize: 12, color: '#6b7280' }}>No voices added yet — add one on the website's Text-to-Speech page first</span>
              ) : (() => {
                const useViewerInput = a.useViewerInput !== false;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Dropdown
                        value={a.voiceProvider ? `${a.voiceProvider}:${a.voiceId}` : null}
                        options={voices.map((v: any) => ({ value: `${v.voice_provider}:${v.voice_id}`, key: `${v.voice_provider}:${v.voice_id}` }))}
                        onSelect={(key) => {
                          const v = voices.find((x: any) => `${x.voice_provider}:${x.voice_id}` === key);
                          if (v) setAction(idx, { voiceProvider: v.voice_provider, voiceId: v.voice_id, voiceLabel: v.voice_label || v.voice_id, voiceImage: v.voice_image || '' });
                        }}
                        render={(key) => {
                          const v = voices.find((x: any) => `${x.voice_provider}:${x.voice_id}` === key);
                          return v ? (v.voice_label || v.voice_id) : 'Pick a voice…';
                        }}
                        placeholder="Pick a voice…"
                      />
                      <Select value={useViewerInput ? 'viewer' : 'fixed'} onChange={(v) => setAction(idx, { useViewerInput: v === 'viewer' })}
                        options={[{ value: 'viewer', label: 'Reads what the viewer typed' }, { value: 'fixed', label: 'Reads a message you write' }]} style={{ width: 220 }} />
                    </div>
                    {!a.voiceProvider && <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ No voice selected — this won't say anything until you pick one above</span>}
                    {useViewerInput ? (
                      <span style={{ fontSize: 12, color: '#6b7280' }}>Set "Ask the viewer for input" on the reward — nothing to read without it</span>
                    ) : (
                      <>
                        <TextInput value={a.message ?? ''} onChange={(v) => setAction(idx, { message: v })} placeholder="e.g. {username} paid real money for me to say this out loud" />
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{'{username}'}/{'{amount}'} substituted — no viewer input needed</span>
                      </>
                    )}
                  </div>
                );
              })()
            )}
            {a.type === 'timeout_user' && (() => {
              const target = a.target === 'input' ? 'input' : 'self';
              const seconds = a.durationSeconds ?? 60;
              return (
                <>
                  <Select value={target} onChange={(v) => setAction(idx, { target: v as 'self' | 'input' })}
                    options={[{ value: 'self', label: 'Whoever triggered this (self)' }, { value: 'input', label: 'Whoever they type in' }]} style={{ width: 220 }} />
                  <NumberInput value={seconds} min={1} onChange={(v) => setAction(idx, { durationSeconds: Math.max(1, v) })} style={{ width: 90 }} />
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>seconds — a real chat timeout, not a message</span>
                  {target === 'input' && <span style={{ width: '100%', fontSize: 11, color: '#f59e0b' }}>Set "Ask the viewer for input" on the reward so they can type who to target</span>}
                </>
              );
            })()}
            {a.type === 'ban_user' && (() => {
              const target = a.target === 'input' ? 'input' : 'self';
              return (
                <>
                  <Select value={target} onChange={(v) => setAction(idx, { target: v as 'self' | 'input' })}
                    options={[{ value: 'self', label: 'Whoever triggered this (self)' }, { value: 'input', label: 'Whoever they type in' }]} style={{ width: 220 }} />
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>a real, permanent ban — not a message</span>
                  {target === 'input' && <span style={{ width: '100%', fontSize: 11, color: '#f59e0b' }}>Set "Ask the viewer for input" on the reward so they can type who to target</span>}
                </>
              );
            })()}
            {a.type === 'unban_user' && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>Always needs a typed username — set "Ask the viewer for input" on the reward so they can say who to unban</span>
            )}
            {a.type === 'trigger_scene' && (
              pulseScenes.length > 0 ? (
                <Select value={a.pulseSceneId ?? ''} onChange={(v) => setAction(idx, { pulseSceneId: v || undefined })}
                  options={[{ value: '', label: 'pick a scene…' }, ...pulseScenes.map(s => ({ value: s.id, label: s.name }))]} style={{ width: 200 }} />
              ) : <span style={{ fontSize: 12, color: '#6b7280' }}>No scenes yet — build one on the Scenes page first</span>
            )}
            {a.type === 'obs_switch_scene' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {obsScenes.length > 0 ? (
                    <Select value={a.sceneName ?? ''} onChange={(v) => setAction(idx, { sceneName: v || undefined })}
                      options={[{ value: '', label: 'pick a scene…' }, ...obsScenes.map(s => ({ value: s.name, label: s.name }))]} style={{ width: 220 }} />
                  ) : (
                    <TextInput value={a.sceneName ?? ''} onChange={(v) => setAction(idx, { sceneName: v })} placeholder="exact OBS scene name" style={{ width: 220 }} />
                  )}
                </div>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {obsScenes.length > 0 ? 'Live from your connected OBS — Settings → Broadcast Software' : 'Connect OBS in Settings → Broadcast Software to pick from a real scene list, or type the exact scene name now'}
                </span>
              </div>
            )}
            {a.type === 'obs_toggle_source' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {obsSources.length > 0 ? (
                    <Select
                      value={a.obsSourceScene && a.obsSourceName ? `${a.obsSourceScene}\u001f${a.obsSourceName}` : ''}
                      onChange={(v) => { const [sceneName, sourceName] = v.split('\u001f'); setAction(idx, { obsSourceScene: sceneName || undefined, obsSourceName: sourceName || undefined }); }}
                      options={[{ value: '', label: 'pick a source…' }, ...obsSources.map(s => ({ value: s.id, label: s.name }))]} style={{ width: 240 }} />
                  ) : (
                    <>
                      <TextInput value={a.obsSourceScene ?? ''} onChange={(v) => setAction(idx, { obsSourceScene: v })} placeholder="exact scene name" style={{ width: 160 }} />
                      <TextInput value={a.obsSourceName ?? ''} onChange={(v) => setAction(idx, { obsSourceName: v })} placeholder="exact source name" style={{ width: 160 }} />
                    </>
                  )}
                  <Select value={a.obsSourceVisible === undefined ? '' : String(a.obsSourceVisible)}
                    onChange={(v) => setAction(idx, { obsSourceVisible: v === '' ? undefined : v === 'true' })}
                    options={[{ value: '', label: 'Toggle (flip current state)' }, { value: 'true', label: 'Show' }, { value: 'false', label: 'Hide' }]} style={{ width: 180 }} />
                </div>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {obsSources.length > 0 ? 'Live from your connected OBS — Settings → Broadcast Software' : 'Connect OBS in Settings → Broadcast Software to pick from a real source list, or type the exact scene/source names now'}
                </span>
              </div>
            )}
            {a.type === 'meld_switch_scene' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Select value={a.meldSceneId ?? ''} onChange={(v) => setAction(idx, { meldSceneId: v || undefined })}
                  options={[{ value: '', label: 'pick a scene…' }, ...meldScenes.map(s => ({ value: s.id, label: s.name }))]} style={{ width: 220 }} />
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {meldScenes.length > 0 ? 'Live from your connected Meld Studio — Settings → Broadcast Software' : 'Connect Meld Studio (Settings → Broadcast Software) to pick a scene'}
                </span>
              </div>
            )}
            {a.type === 'meld_toggle_layer' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Select
                  value={a.meldLayerSceneId && a.meldLayerId ? `${a.meldLayerSceneId}\u001f${a.meldLayerId}` : ''}
                  onChange={(v) => { const [sceneId, layerId] = v.split('\u001f'); setAction(idx, { meldLayerSceneId: sceneId || undefined, meldLayerId: layerId || undefined }); }}
                  options={[{ value: '', label: 'pick a layer…' }, ...meldLayers.map(s => ({ value: s.id, label: s.name }))]} style={{ width: 240 }} />
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {meldLayers.length > 0 ? 'Live from your connected Meld Studio — Settings → Broadcast Software' : 'Connect Meld Studio (Settings → Broadcast Software) to pick a layer'}
                </span>
              </div>
            )}
            {a.type === 'meld_record_clip' && (
              <>
                <NumberInput value={a.meldClipDuration ?? 0} min={0} max={90}
                  onChange={(v) => setAction(idx, { meldClipDuration: Math.max(0, Math.min(90, v)) })} style={{ width: 90 }} />
                <span style={{ fontSize: 12, color: '#9ca3af' }}>seconds — 0 (or blank) saves the max available length</span>
              </>
            )}
            {a.type === 'light_set_state' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Select value={a.lightTarget ?? 'all'} onChange={(v) => setAction(idx, { lightTarget: v })}
                    options={[{ value: 'all', label: 'All Lights' }, ...lightDevices.map(d => ({ value: d.id, label: d.name }))]} style={{ width: 180 }} />
                  <Select value={a.lightOn === undefined ? '' : String(a.lightOn)} onChange={(v) => setAction(idx, { lightOn: v === '' ? undefined : v === 'true' })}
                    options={[{ value: '', label: 'Power: leave as-is' }, { value: 'true', label: 'Power: On' }, { value: 'false', label: 'Power: Off' }]} style={{ width: 170 }} />
                  <Toggle checked={a.lightBrightness !== undefined} onChange={(v) => setAction(idx, { lightBrightness: v ? 100 : undefined })} label="Brightness" />
                  {a.lightBrightness !== undefined && <NumberInput value={a.lightBrightness} min={0} max={100} onChange={(v) => setAction(idx, { lightBrightness: Math.max(0, Math.min(100, v)) })} style={{ width: 70 }} />}
                  <Toggle checked={a.lightColor !== undefined} onChange={(v) => setAction(idx, { lightColor: v ? '00ff9d' : undefined })} label="Color" />
                  {a.lightColor !== undefined && <ColorInput value={a.lightColor} bare onChange={(v) => setAction(idx, { lightColor: v })} />}
                </div>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {lightDevices.length > 0 ? 'Live from your configured devices — Settings → Devices' : 'No devices configured yet — add a WLED/Hue/Govee light on the Devices tab to pick one, or leave this on "All Lights"'}
                </span>
              </div>
            )}
            {a.type === 'light_fire_reaction' && (
              lightReactions.length > 0 ? (
                <Select value={a.lightReactionId ?? ''} onChange={(v) => setAction(idx, { lightReactionId: v || undefined })}
                  options={[{ value: '', label: 'pick a reaction…' }, ...lightReactions.map((r) => ({ value: r.id, label: r.name }))]} style={{ width: 220 }} />
              ) : (
                <span style={{ fontSize: 12, color: '#6b7280' }}>No reactions yet — create one on the Light Reactions page first</span>
              )
            )}
            {a.type === 'light_set_scene' && (
              lightScenes.length > 0 ? (
                <Select value={a.lightSceneId ?? ''} onChange={(v) => setAction(idx, { lightSceneId: v || undefined })}
                  options={[{ value: '', label: 'pick a scene…' }, ...lightScenes.map((s) => ({ value: s.id, label: s.name }))]} style={{ width: 220 }} />
              ) : (
                <span style={{ fontSize: 12, color: '#6b7280' }}>No scenes yet — create one on the Light Scenes page first</span>
              )
            )}
            {a.type === 'virtual_light_set_state' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Select value={a.virtualLightConfigId ?? ''} onChange={(v) => setAction(idx, { virtualLightConfigId: v || undefined })}
                    options={[{ value: '', label: 'All Virtual Lights' }, ...virtualLights.map(l => ({ value: l.id, label: l.name }))]} style={{ width: 200 }} />
                  <Select value={a.lightOn === undefined ? '' : String(a.lightOn)} onChange={(v) => setAction(idx, { lightOn: v === '' ? undefined : v === 'true' })}
                    options={[{ value: '', label: 'Power: leave as-is' }, { value: 'true', label: 'Power: On' }, { value: 'false', label: 'Power: Off' }]} style={{ width: 170 }} />
                  <Toggle checked={a.lightBrightness !== undefined} onChange={(v) => setAction(idx, { lightBrightness: v ? 100 : undefined })} label="Brightness" />
                  {a.lightBrightness !== undefined && <NumberInput value={a.lightBrightness} min={0} max={100} onChange={(v) => setAction(idx, { lightBrightness: Math.max(0, Math.min(100, v)) })} style={{ width: 70 }} />}
                  <Toggle checked={a.lightColor !== undefined} onChange={(v) => setAction(idx, { lightColor: v ? '7c3aed' : undefined })} label="Color" />
                  {a.lightColor !== undefined && <ColorInput value={a.lightColor} bare onChange={(v) => setAction(idx, { lightColor: v })} />}
                </div>
                <Toggle checked={!!a.lightMomentary} onChange={(v) => setAction(idx, { lightMomentary: v })} label="Flash, then revert" />
                {a.lightMomentary && (
                  <Row label="hold for">
                    <NumberInput value={a.lightHoldMs ?? 1500} min={50} onChange={(v) => setAction(idx, { lightHoldMs: Math.max(50, v) })} style={{ width: 90 }} />
                    <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>ms, back to whatever it was showing before</span>
                  </Row>
                )}
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {virtualLights.length > 0 ? 'Works for every viewer — no hardware needed' : 'No Virtual Light widgets yet — add one from the Widgets page to pick one, or leave this on "All Virtual Lights"'}
                </span>
              </div>
            )}
            {(a.type === 'todo_reveal_task' || a.type === 'todo_start_task') && (
              todoTasks.length > 0 ? (
                <Select value={a.taskId ?? ''} onChange={(v) => setAction(idx, { taskId: v || undefined })}
                  options={[{ value: '', label: 'pick a task…' }, ...todoTasks.map(t => ({ value: t.id, label: t.name }))]} style={{ width: 200 }} />
              ) : <span style={{ fontSize: 12, color: '#6b7280' }}>No tasks yet — add one on the To-Do List widget's settings page first</span>
            )}

            <button onClick={() => removeAction(idx)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 6 }}>
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
        <button onClick={addAction} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#c4b5fd', background: 'none', border: 'none', cursor: 'pointer' }}>
          <Plus size={13} /> Then (add an action)
        </button>
        {!filterTypes && (
          <>
            <button onClick={addWait} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#fcd34d', background: 'none', border: 'none', cursor: 'pointer' }}>
              <Plus size={13} /> Wait (a set time)
            </button>
            <button onClick={addWaitFor} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#7dd3fc', background: 'none', border: 'none', cursor: 'pointer' }}>
              <Plus size={13} /> Wait for a WHEN
            </button>
          </>
        )}
      </div>
      {hasWait && (
        <p style={{ fontSize: 11, color: '#6b7280', padding: '0 4px' }}>
          This is a sequence: it runs top to bottom, pausing at each wait, so you can chain as many THEN / wait / WHEN steps as you like.
        </p>
      )}
    </div>
  );
}
