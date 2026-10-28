// src/components/PulseTriggerEditor.tsx — one WHEN (trigger) editor, native
// port of the website's own src/components/PulseTriggerEditor.tsx (2026-10-18
// — Pulse Engine rebuilt as a real native editor here instead of an embedded
// <webview>, per direct feedback: OBS/light actions genuinely need desktop-
// local data the website has no way to see, so this is the one Studio-style
// page where a native editor is the RIGHT call, not drift risk). Mirrors the
// trigger shapes in routes/pulseRules.js exactly — keep this in sync with
// the website's own copy if that file's trigger shapes ever change.
import { useEffect, useState, type ReactNode } from 'react';
import { Select, TextInput, NumberInput, Row, Toggle } from './ui';
import { supabase } from '../lib/supabase';

export interface Trigger {
  type: 'event' | 'chat_command' | 'points_milestone' | 'points_reward_redeemed' | 'goal_completed' | 'goal_milestone' | 'hype_level' | 'wanted_level' | 'first_chat_session' | 'todo_task_completed' | 'jumpscare_maxed' | 'moon_darkened' | 'credits_finished' | 'voice_command';
  event?: string;
  minAmount?: number;
  rewardId?: string;
  command?: string;
  permission?: 'everyone' | 'vip' | 'moderator' | 'broadcaster';
  threshold?: number;
  level?: number;
  username?: string;
  taskId?: string;
  // voice_command (2026-10-23) — matched against this app's own local Vosk
  // speech recognition (electron/voiceCommands.ts). Authored here directly
  // via the generic type picker, OR on the dedicated Voice Commands page
  // (a simplified phrase+action form over the SAME pulse_rules row — see
  // that page's own header for why both exist without being redundant).
  phrase?: string;
  // matchMode: 'contains' (default) matches the phrase appearing anywhere
  // in what was recognized; 'exact' requires the whole recognized sentence
  // to equal the phrase.
  matchMode?: 'contains' | 'exact';
  // minConfidence (0-100): only fires if Vosk's own per-word confidence for
  // the match meets this. Only enforced on FINAL results — partial/
  // streaming results (used by triggerImmediately below) carry no
  // confidence data at all, so this is skipped for those.
  minConfidence?: number;
  // triggerImmediately: match against live partial results as they stream
  // in rather than waiting for a finished utterance — lower latency, more
  // false-positive risk (no confidence filtering applies to a partial).
  triggerImmediately?: boolean;
}

export const TRIGGER_EVENTS = [
  { value: 'channel.followed',                   label: 'New Follower (Kick)' },
  { value: 'channel.subscription.new',           label: 'New Subscriber (Kick)' },
  { value: 'channel.subscription.renewal',       label: 'Sub Renewal (Kick)' },
  { value: 'channel.subscription.gifts',         label: 'Gifted Subs (Kick)' },
  { value: 'kicks.gifted',                       label: 'Kicks Gifted (Kick)' },
  { value: 'channel.reward.redemption.updated',  label: 'Kick Reward Redeemed' },
  { value: 'channel.follow',                     label: 'New Follower (Twitch)' },
  { value: 'channel.subscribe',                  label: 'New Subscriber (Twitch)' },
  { value: 'channel.subscription.gift',          label: 'Gifted Subs (Twitch)' },
  { value: 'channel.cheer',                      label: 'Bits Cheered (Twitch)' },
  { value: 'channel.raid',                       label: 'Raid Received (Twitch)' },
  { value: 'channel.channel_points_custom_reward_redemption.add', label: 'Twitch Reward Redeemed' },
  { value: 'stream.live',                        label: 'Stream Goes Live (Kick or Twitch)' },
  { value: 'stream.offline',                     label: 'Stream Goes Offline (Kick or Twitch)' },
];

export const TRIGGER_TYPES: { value: Trigger['type']; label: string }[] = [
  { value: 'event',              label: 'Platform Event' },
  { value: 'chat_command',       label: 'Chat Command' },
  { value: 'points_milestone',   label: 'Points Milestone' },
  { value: 'points_reward_redeemed', label: 'Pulse Points Reward Redeemed' },
  { value: 'goal_completed',     label: 'Goal Bar Completed' },
  { value: 'goal_milestone',     label: 'Goal Bar Milestone Crossed' },
  { value: 'hype_level',         label: 'Hype Train Level' },
  { value: 'wanted_level',       label: 'Wanted Level' },
  { value: 'first_chat_session', label: 'Viewer Walk-on (First Chat)' },
  { value: 'todo_task_completed', label: 'To-Do List Task Completed' },
  { value: 'jumpscare_maxed',    label: 'Jumpscare Meter Maxed Out' },
  { value: 'moon_darkened',      label: 'Moon Phase Goes Dark' },
  // credits_finished (2026-10-27, website-ported — "roll credits, THEN
  // wait for credits to finish, THEN actually end stream").
  { value: 'credits_finished',   label: 'Credits Roll Finished' },
  { value: 'voice_command',      label: '🎙️ Voice Command' },
];

export const DEFAULT_TRIGGERS: Record<Trigger['type'], Trigger> = {
  event:              { type: 'event', event: 'channel.followed' },
  chat_command:       { type: 'chat_command', command: '!' },
  points_milestone:   { type: 'points_milestone', threshold: 10000 },
  points_reward_redeemed: { type: 'points_reward_redeemed' },
  goal_completed:     { type: 'goal_completed' },
  goal_milestone:     { type: 'goal_milestone' },
  hype_level:         { type: 'hype_level', level: 3 },
  wanted_level:       { type: 'wanted_level', level: 3 },
  first_chat_session: { type: 'first_chat_session' },
  todo_task_completed: { type: 'todo_task_completed' },
  jumpscare_maxed:    { type: 'jumpscare_maxed' },
  moon_darkened:      { type: 'moon_darkened' },
  credits_finished:   { type: 'credits_finished' },
  voice_command:      { type: 'voice_command', phrase: '', matchMode: 'contains', minConfidence: 50, triggerImmediately: false },
};

const AMOUNT_EVENTS = new Set([
  'kicks.gifted', 'channel.subscription.gifts',
  'channel.subscription.gift', 'channel.cheer', 'channel.raid',
]);

interface Reward { id: string; title: string; cost: number }
interface Task { id: string; name: string }

// Same per-session cache shape as the website's own version (module scope,
// not keyed by anything other than "have we fetched this at all yet" — this
// app only ever has ONE account connected per process lifetime, unlike a
// browser tab that can switch accounts, so there's no token-staleness case
// to guard against here).
const cache: {
  kick?: { data?: Reward[]; error?: string };
  twitch?: { data?: Reward[]; error?: string };
  points?: { data?: Reward[]; error?: string };
  kickP?: Promise<void>; twitchP?: Promise<void>; pointsP?: Promise<void>;
} = {};

export function usePulseLookups(userId: string | null) {
  const [, bump] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('todo_list_configs').select('config').eq('user_id', userId)
      .then(({ data }) => setTasks((data ?? []).flatMap((r: any) =>
        (r.config?.items ?? []).map((t: any) => ({ id: t.id, name: t.text || 'Untitled task' })))));
  }, [userId]);

  const ensureKick = () => {
    if (!cache.kick && !cache.kickP) {
      cache.kickP = window.kickpulseDesktop.pulseRules.kickRewards()
        .then((r) => { cache.kick = r; })
        .catch(() => { cache.kick = { error: 'failed' }; })
        .finally(() => { cache.kickP = undefined; bump((n) => n + 1); });
    }
  };
  const ensureTwitch = () => {
    if (!cache.twitch && !cache.twitchP) {
      cache.twitchP = window.kickpulseDesktop.pulseRules.twitchRewards()
        .then((r) => { cache.twitch = r; })
        .catch(() => { cache.twitch = { error: 'failed' }; })
        .finally(() => { cache.twitchP = undefined; bump((n) => n + 1); });
    }
  };
  const ensurePoints = () => {
    if (!cache.points && !cache.pointsP) {
      cache.pointsP = window.kickpulseDesktop.pulseRules.pointsRewards()
        .then((r) => { cache.points = r; })
        .catch(() => { cache.points = { error: 'failed' }; })
        .finally(() => { cache.pointsP = undefined; bump((n) => n + 1); });
    }
  };

  return {
    tasks,
    kickRewards: cache.kick?.data ?? null, kickError: cache.kick?.error ?? null, kickLoading: !!cache.kickP,
    twitchRewards: cache.twitch?.data ?? null, twitchError: cache.twitch?.error ?? null, twitchLoading: !!cache.twitchP,
    pointRewards: cache.points?.data ?? null, pointsError: cache.points?.error ?? null, pointsLoading: !!cache.pointsP,
    ensureKick, ensureTwitch, ensurePoints,
  };
}

export type PulseLookups = ReturnType<typeof usePulseLookups>;

export function describeTrigger(t: Trigger, lk?: Pick<PulseLookups, 'tasks' | 'kickRewards' | 'twitchRewards' | 'pointRewards'>): string {
  if (t.type === 'chat_command') return `${t.command}${t.permission && t.permission !== 'everyone' ? ` (${t.permission}+)` : ''}`;
  if (t.type === 'points_milestone') return `viewer reaches ${t.threshold?.toLocaleString() ?? '?'} lifetime points`;
  if (t.type === 'points_reward_redeemed') {
    const reward = t.rewardId ? lk?.pointRewards?.find(r => r.id === t.rewardId) : null;
    return reward ? `Pulse Reward "${reward.title}" is redeemed` : 'any Pulse Points reward is redeemed';
  }
  if (t.type === 'goal_completed') return 'a Goal Bar completes';
  if (t.type === 'goal_milestone') return 'any Goal Bar milestone is crossed';
  if (t.type === 'hype_level') return t.level === 1 ? 'hype train starts' : `hype train hits level ${t.level ?? '?'}`;
  if (t.type === 'wanted_level') return `wanted level hits ${t.level ?? '?'} star${t.level === 1 ? '' : 's'}`;
  if (t.type === 'jumpscare_maxed') return 'the Jumpscare Meter maxes out';
  if (t.type === 'moon_darkened') return 'a Moon Phase widget goes fully dark';
  if (t.type === 'credits_finished') return 'the Credits Roll overlay finishes scrolling';
  if (t.type === 'first_chat_session') return t.username ? `${t.username} first chats this stream` : "any viewer's first chat this stream";
  if (t.type === 'todo_task_completed') {
    const task = lk?.tasks.find(x => x.id === t.taskId);
    return task ? `To-Do task "${task.name}" is completed` : 'any To-Do List task is completed';
  }
  if (t.type === 'voice_command') {
    const bits = [t.matchMode === 'exact' ? 'exact match' : null, t.triggerImmediately ? 'immediate' : null].filter(Boolean);
    return t.phrase ? `you say "${t.phrase}"${bits.length ? ` (${bits.join(', ')})` : ''}` : 'you say a phrase';
  }
  const label = TRIGGER_EVENTS.find(e => e.value === t.event)?.label ?? t.event ?? 'an event';
  if (t.event === 'channel.reward.redemption.updated' && t.rewardId) {
    const reward = lk?.kickRewards?.find(r => r.id === t.rewardId);
    return reward ? `Kick Reward Redeemed: "${reward.title}"` : label;
  }
  if (t.event === 'channel.channel_points_custom_reward_redemption.add' && t.rewardId) {
    const reward = lk?.twitchRewards?.find(r => r.id === t.rewardId);
    return reward ? `Twitch Reward Redeemed: "${reward.title}"` : label;
  }
  return t.minAmount ? `${label} ≥ ${t.minAmount}` : label;
}

// The WHEN's own controls (type picker + that type's fields), laid out
// inline so the parent decides the surrounding row.
export default function PulseTriggerEditor({ value, onChange, userId, hideTypePicker }: {
  value: Trigger; onChange: (t: Trigger) => void; userId: string | null;
  // hideTypePicker (2026-10-23) — the dedicated Voice Commands page embeds
  // just this component's own voice_command fields, with `value.type`
  // hardcoded there and never changed — same "specialized page reuses the
  // shared field block, minus the generic picker" shape as
  // PulseActionEditor.tsx's own hideTtsViewerInput prop.
  hideTypePicker?: boolean;
}) {
  const lk = usePulseLookups(userId);
  const set = (patch: Partial<Trigger>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (value.type === 'event' && value.event === 'channel.reward.redemption.updated') lk.ensureKick();
    if (value.type === 'event' && value.event === 'channel.channel_points_custom_reward_redemption.add') lk.ensureTwitch();
    if (value.type === 'points_reward_redeemed') lk.ensurePoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.type, value.event]);

  return (
    <>
      {!hideTypePicker && (
        <Select value={value.type} onChange={(v) => onChange({ ...DEFAULT_TRIGGERS[v as Trigger['type']] })}
          options={TRIGGER_TYPES} style={{ width: 230 }} />
      )}

      {value.type === 'event' && (
        <>
          <Select value={value.event ?? ''} onChange={(v) => set({ event: v, minAmount: undefined, rewardId: undefined })}
            options={TRIGGER_EVENTS} style={{ width: 230 }} />
          {AMOUNT_EVENTS.has(value.event ?? '') && (
            <Row label="minimum">
              <NumberInput value={value.minAmount ?? 0} min={0} onChange={(v) => set({ minAmount: v || undefined })} style={{ width: 90 }} />
            </Row>
          )}
          {value.event === 'channel.reward.redemption.updated' && (
            lk.kickError === 'reconnect' ? (
              <Warn>Reconnect Kick under Settings to pick a specific reward — this will fire for any reward until then.</Warn>
            ) : lk.kickError === 'failed' ? (
              <Faint>Couldn't load your Kick rewards — this will fire for any reward.</Faint>
            ) : (
              <Select value={value.rewardId ?? ''} onChange={(v) => set({ rewardId: v || undefined })}
                options={[{ value: '', label: 'Any reward' }, ...(lk.kickRewards ?? []).map(r => ({ value: r.id, label: `${r.title} (${r.cost})` }))]}
                style={{ width: 220 }} />
            )
          )}
          {value.event === 'channel.channel_points_custom_reward_redemption.add' && (
            lk.twitchError === 'no_account' ? (
              <Faint>Connect Twitch under Settings to pick a specific reward.</Faint>
            ) : lk.twitchError === 'reconnect' ? (
              <Warn>Reconnect Twitch under Settings to pick a specific reward — this will fire for any reward until then.</Warn>
            ) : lk.twitchError === 'failed' ? (
              <Faint>Couldn't load your Twitch rewards — this will fire for any reward.</Faint>
            ) : (
              <Select value={value.rewardId ?? ''} onChange={(v) => set({ rewardId: v || undefined })}
                options={[{ value: '', label: 'Any reward' }, ...(lk.twitchRewards ?? []).map(r => ({ value: r.id, label: `${r.title} (${r.cost})` }))]}
                style={{ width: 220 }} />
            )
          )}
        </>
      )}

      {value.type === 'chat_command' && (
        <>
          <TextInput value={value.command ?? ''} onChange={(v) => set({ command: v })} placeholder="!command" style={{ width: 140 }} />
          <Select value={value.permission ?? 'everyone'} onChange={(v) => set({ permission: v as Trigger['permission'] })}
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'vip', label: 'VIPs+' },
              { value: 'moderator', label: 'Mods+' },
              { value: 'broadcaster', label: 'Broadcaster' },
            ]} style={{ width: 140 }} />
        </>
      )}

      {value.type === 'points_milestone' && (
        <Row label="a viewer's lifetime earned reaches">
          <NumberInput value={value.threshold ?? 10000} min={1} onChange={(v) => set({ threshold: v })} style={{ width: 110 }} />
        </Row>
      )}

      {value.type === 'points_reward_redeemed' && (
        lk.pointsError === 'failed' ? (
          <Faint>Couldn't load your rewards — this will fire for any reward.</Faint>
        ) : (lk.pointRewards ?? []).length === 0 && !lk.pointsLoading ? (
          <Faint>No Pulse Points rewards yet — add one on the Points page, or leave this as "any reward".</Faint>
        ) : (
          <Select value={value.rewardId ?? ''} onChange={(v) => set({ rewardId: v || undefined })}
            options={[{ value: '', label: 'Any reward' }, ...(lk.pointRewards ?? []).map(r => ({ value: r.id, label: `${r.title} (${r.cost})` }))]}
            style={{ width: 220 }} />
        )
      )}

      {value.type === 'goal_completed' && <Faint>any Goal Bar reaches its goal</Faint>}

      {value.type === 'goal_milestone' && (
        <Faint>any milestone on any of your Goal Bars is crossed. For a reaction tied to ONE specific milestone, set that milestone's own "Actions" on the Goal Bar settings page's Milestones tab instead.</Faint>
      )}

      {value.type === 'hype_level' && (
        <Row label="the hype train reaches level">
          <Select value={String(value.level ?? 3)} onChange={(v) => set({ level: parseInt(v) || 1 })}
            options={[1, 2, 3, 4, 5].map(l => ({ value: String(l), label: `${l}${l === 1 ? ' (train starts)' : ''}` }))} style={{ width: 160 }} />
        </Row>
      )}

      {value.type === 'wanted_level' && (
        <Row label="the wanted level hits">
          <Select value={String(value.level ?? 3)} onChange={(v) => set({ level: parseInt(v) || 1 })}
            options={[1, 2, 3, 4, 5].map(l => ({ value: String(l), label: `${l} star${l === 1 ? '' : 's'}` }))} style={{ width: 160 }} />
        </Row>
      )}

      {value.type === 'todo_task_completed' && (
        lk.tasks.length > 0 ? (
          <Row label="task">
            <Select value={value.taskId ?? ''} onChange={(v) => set({ taskId: v || undefined })}
              options={[{ value: '', label: 'any task' }, ...lk.tasks.map(t => ({ value: t.id, label: t.name }))]} style={{ width: 200 }} />
          </Row>
        ) : (
          <Faint>No To-Do List tasks yet — add one on that widget's settings page, or leave this as "any task"</Faint>
        )
      )}

      {value.type === 'first_chat_session' && (
        <Row label="fires the first time">
          <TextInput value={value.username ?? ''} onChange={(v) => set({ username: v })} placeholder="any viewer" style={{ width: 160 }} />
        </Row>
      )}

      {value.type === 'voice_command' && (
        <>
          <Row label="you say">
            <TextInput value={value.phrase ?? ''} onChange={(v) => set({ phrase: v })} placeholder="e.g. party time" style={{ width: 200 }} />
          </Row>
          <Select value={value.matchMode ?? 'contains'} onChange={(v) => set({ matchMode: v as Trigger['matchMode'] })}
            options={[
              { value: 'contains', label: 'Anywhere in the sentence' },
              { value: 'exact', label: 'Exact match only' },
            ]} style={{ width: 200 }} />
          <Row label="min. confidence">
            <NumberInput value={value.minConfidence ?? 50} min={0} max={100} onChange={(v) => set({ minConfidence: Math.max(0, Math.min(100, v)) })} style={{ width: 70 }} />
          </Row>
          <Toggle checked={!!value.triggerImmediately} onChange={(v) => set({ triggerImmediately: v })} label="Trigger immediately" />
          <Faint>
            {value.triggerImmediately
              ? 'Fires the instant it hears a match, even mid-sentence — lower latency, no confidence filtering applies.'
              : 'Waits for you to finish speaking before checking for a match.'}
            {' '}Requires the KickPulse Desktop app with Voice Commands turned on.
          </Faint>
        </>
      )}
    </>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '6px 10px' }}>{children}</span>;
}
function Faint({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, color: '#6b7280' }}>{children}</span>;
}
