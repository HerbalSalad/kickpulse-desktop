// electron/api.ts — thin client for KickPulse's backend. Same shape as the
// Stream Deck plugin's own src/lib/api.ts: auth is a KickPulse-issued API
// key (Dashboard → Settings → API Keys), never a raw Kick/Twitch OAuth
// token — the server already keeps that refreshed on its own side; this
// app just needs one stable, revocable credential. Node's built-in `fetch`
// (Electron's bundled Node has it) is used directly, same as the plugin.

const BASE_URL = process.env.KICKPULSE_API_BASE || 'https://www.kickpulsebot.com';

import type { MeResponse, JumpscareConfigResponse, ScenesConfigResponse, ViewerInfo } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  // A 204 (deletePulseRule's own real response shape) has no body at all —
  // res.json() would throw a SyntaxError trying to parse an empty string.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getMe(apiKey: string): Promise<MeResponse> {
  return request<MeResponse>('/desktop/me', apiKey);
}

// getKickSubscriberBadges — public, no auth (same endpoint Chat Overlay/
// Scrolling Chat/PulseWatch use on the website) — the Dashboard's Live Chat
// needs real subscriber-badge tier images for the connected streamer's own
// channel, same as those widgets do for whichever channel they're showing.
export function getKickSubscriberBadges(slug: string): Promise<{ badges: { months: number; badge_image?: { src?: string } }[] }> {
  return fetch(`${BASE_URL}/kick-subscriber-badges?slug=${encodeURIComponent(slug)}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ badges: { months: number; badge_image?: { src?: string } }[] }>) : { badges: [] }))
    .catch(() => ({ badges: [] }));
}

export function getJumpscareConfig(apiKey: string): Promise<JumpscareConfigResponse | null> {
  return request<JumpscareConfigResponse | null>('/desktop/jumpscare-config', apiKey);
}

// reportObsState — tells the website what OBS scenes exist right now, so
// Pulse Engine's own rule editor (the website's src/components/
// PulseActionEditor.tsx, "Switch OBS Scene" action) can offer a real
// dropdown instead of asking someone to type an exact scene name blind.
// Fire-and-forget by every real caller — a failed report (offline, no
// account connected yet) just means the website's picker stays empty/stale
// a bit longer, never something worth surfacing as an app-level error.
export function reportObsState(apiKey: string, scenes: { sceneName: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/obs-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ scenes }),
  });
}

export function getScenesConfig(apiKey: string): Promise<ScenesConfigResponse | null> {
  return request<ScenesConfigResponse | null>('/desktop/scenes-config', apiKey);
}

// getViewerInfo — batched threat-level + flags lookup for the Live Chat
// feed's warning badge (electron/chat-feed.ts). Called once per batch of
// currently-visible chatters, never per-message.
export function getViewerInfo(apiKey: string, usernames: string[], platform: 'kick' | 'twitch'): Promise<Record<string, ViewerInfo>> {
  const qs = `usernames=${encodeURIComponent(usernames.join(','))}&platform=${platform}`;
  return request<Record<string, ViewerInfo>>(`/desktop/viewer-info?${qs}`, apiKey);
}

// getCommunityBanSettings — the streamer's own "how sensitive should threat
// warnings be" choice (set on the website's /community-bans page). Hits the
// same /community-bans/settings route the website's own page uses —
// authenticateKickOrApiKey already accepts this app's API key there, same
// as every other route this app calls.
export function getCommunityBanSettings(apiKey: string): Promise<{ minThreatLevelToWarn: number }> {
  return request<{ minThreatLevelToWarn: number }>('/community-bans/settings', apiKey);
}
export function setCommunityBanSettings(apiKey: string, minThreatLevelToWarn: number): Promise<{ ok: boolean; minThreatLevelToWarn: number }> {
  return request('/community-bans/settings', apiKey, { method: 'POST', body: JSON.stringify({ minThreatLevelToWarn }) });
}

// Community Bans (2026-10-20, native desktop page — direct request: "we
// should have access to the community bans in the desktop app as well").
// Same routes/communityBans.js endpoints the website's own
// src/pages/CommunityBans.tsx already uses.
export interface CommunityBanEntry { id: string; username: string; reason: string; source: string | null; created_at: string; appliedStatus: 'banned' | 'not_found' | 'error' | 'unbanned' | null; }
export interface ApplyResult { total: number; banned: number; notFound: number; errors: number; skipped: number; }
export interface Squad { id: string; name: string; invite_code: string; created_by: string; memberCount: number; members: string[]; }
export interface ViewerFlag { id: string; username: string; platform: string; category: string; reason: string | null; flagged_by: string | null; created_at: string; }

export function getCommunityBanList(apiKey: string): Promise<{ entries: CommunityBanEntry[]; total: number }> {
  return request('/community-bans/list', apiKey);
}
export function applyCommunityBans(apiKey: string, opts: { entryIds?: string[] } = {}): Promise<ApplyResult> {
  return request('/community-bans/apply', apiKey, { method: 'POST', body: JSON.stringify(opts) });
}
export function unbanCommunityBanEntry(apiKey: string, entryId: string): Promise<{ ok: boolean; username: string }> {
  return request('/community-bans/unban', apiKey, { method: 'POST', body: JSON.stringify({ entryId }) });
}
export function unbanAllCommunityBans(apiKey: string): Promise<{ total: number; unbanned: number; errors: number }> {
  return request('/community-bans/unban-all', apiKey, { method: 'POST' });
}
export function getViewerFlags(apiKey: string): Promise<{ flags: ViewerFlag[] }> {
  return request('/community-bans/flags', apiKey);
}
export function addViewerFlag(apiKey: string, body: { username: string; category: string; reason?: string }): Promise<{ ok: boolean; flag: ViewerFlag }> {
  return request('/community-bans/flags', apiKey, { method: 'POST', body: JSON.stringify(body) });
}
export function removeViewerFlag(apiKey: string, id: string): Promise<{ ok: boolean }> {
  return request(`/community-bans/flags/${id}`, apiKey, { method: 'DELETE' });
}
export function getBanSquads(apiKey: string): Promise<{ squads: Squad[] }> {
  return request('/community-bans/squads', apiKey);
}
export function createBanSquad(apiKey: string, name: string): Promise<{ ok: boolean; squad: Squad }> {
  return request('/community-bans/squads', apiKey, { method: 'POST', body: JSON.stringify({ name }) });
}
export function joinBanSquad(apiKey: string, inviteCode: string): Promise<{ ok: boolean; squad: Squad }> {
  return request('/community-bans/squads/join', apiKey, { method: 'POST', body: JSON.stringify({ inviteCode }) });
}
export function leaveBanSquad(apiKey: string, squadId: string): Promise<{ ok: boolean }> {
  return request(`/community-bans/squads/${squadId}/leave`, apiKey, { method: 'POST' });
}

// reportObsSources — same shape/reasoning as reportObsState right above,
// for Pulse Engine's "Show/Hide OBS Source" action's own (scene, source)
// picker (2026-10-16).
export function reportObsSources(apiKey: string, sources: { sceneName: string; sourceName: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/obs-sources-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ sources }),
  });
}

// reportMeldState/reportMeldLayers — same shape/reasoning as
// reportObsState/reportObsSources above, for streamers using Meld Studio
// instead of OBS (2026-10-25).
export function reportMeldState(apiKey: string, scenes: { sceneId: string; sceneName: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/meld-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ scenes }),
  });
}

export function reportMeldLayers(apiKey: string, layers: { sceneId: string; layerId: string; layerName: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/meld-layers-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ layers }),
  });
}

// reportLightDevices — same shape/reasoning as reportObsState right above,
// for Pulse Engine's "Set Light State" action's own device picker. Reported
// on startup and after every add/remove/rename (see main.ts's own call
// sites) — there's no live "device list changed" event the way OBS's own
// SceneListChanged is (these are just locally-stored configs), so each
// mutating IPC handler reports fresh afterward instead.
export function reportLightDevices(apiKey: string, devices: { id: string; name: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/light-devices-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ devices }),
  });
}

// reportLightScenes/reportLightReactions (2026-10-21) — same shape/reasoning
// as reportLightDevices right above, so the website's own PulseActionEditor.tsx
// can offer real "pick a scene"/"pick a reaction" dropdowns for the
// `light_set_scene`/`light_fire_reaction` actions instead of having no picker
// at all (the website has no local IPC access to this app's own saved
// scenes/reactions the way this app's own PulseActionEditor.tsx does).
// Reported on startup and after every save/delete/activate — see main.ts's
// own call sites.
export function reportLightScenes(apiKey: string, scenes: { id: string; name: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/light-scenes-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ scenes }),
  });
}
export function reportLightReactions(apiKey: string, reactions: { id: string; name: string }[]): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/desktop/light-reactions-state', apiKey, {
    method: 'POST',
    body: JSON.stringify({ reactions }),
  });
}

// Voice Commands (2026-10-23) — the website's /pulse-rules/targets/
// voice-phrases, /pulse-rules/voice-trigger, and /pulse-rules/voice-caption
// (routes/pulseRules.js), Premium-gated (same gate as Pulse Engine itself —
// see lib/desktopOnlyActions.js on the website). fetchVoicePhrases is polled
// periodically by electron/voiceCommands.ts so this app knows what to
// listen for (now the full per-rule shape — matchMode/minConfidence/
// triggerImmediately, authored from either the dedicated Voice Commands
// page or the generic Pulse Engine trigger editor); reportVoiceTrigger is
// called the moment local recognition matches one of them — never raw
// audio or a full transcript, only the specific phrase that matched.
// reportVoiceCaption streams recognized text for the Live Captions OBS
// widget, only ever called while that's explicitly turned on.
export interface VoicePhraseDTO {
  id: string;
  phrase: string;
  matchMode: 'contains' | 'exact';
  minConfidence: number;
  triggerImmediately: boolean;
}
export function fetchVoicePhrases(apiKey: string): Promise<VoicePhraseDTO[]> {
  return request<VoicePhraseDTO[]>('/pulse-rules/targets/voice-phrases', apiKey);
}
export function reportVoiceTrigger(apiKey: string, phrase: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/pulse-rules/voice-trigger', apiKey, {
    method: 'POST',
    body: JSON.stringify({ phrase }),
  });
}
export function reportVoiceCaption(apiKey: string, text: string, isFinal: boolean): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/pulse-rules/voice-caption', apiKey, {
    method: 'POST',
    body: JSON.stringify({ text, isFinal }),
  });
}

// ── Pulse Engine (2026-10-15) ───────────────────────────────────────────────
// Unlike everything above (and unlike every widget config, which this app
// reads/writes straight from Supabase — see src/lib/supabase.ts's own file
// header), pulse_rules genuinely has no anon Supabase access at all: it's a
// real, server-processed, Premium-gated table (cooldowns, a dispatcher,
// sequence state) with zero RLS policies for anon, confirmed directly
// against the live schema before building this. So rule CRUD has to go
// through the website's own /pulse-rules API, same as /desktop/me and the
// jumpscare/scenes config above — this isn't a new pattern, it's the SAME
// one those already use, just for a feature that needs real server logic
// rather than being a plain config row.
// `routes/pulseRules.js`'s CRUD routes were widened (2026-10-15) from
// authenticateKick to authenticateKickOrApiKey specifically so this app's
// own api_keys-table credential works here — see that file's own comment
// on the change for why it's safe.
export interface PulseRuleDTO {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Record<string, any>;
  actions: Record<string, any>[];
  cooldown_seconds: number;
  user_cooldown_seconds: number;
}

export function listPulseRules(apiKey: string): Promise<PulseRuleDTO[]> {
  return request<PulseRuleDTO[]>('/pulse-rules', apiKey);
}

export function createPulseRule(apiKey: string, body: Partial<PulseRuleDTO>): Promise<PulseRuleDTO> {
  return request<PulseRuleDTO>('/pulse-rules', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

export function updatePulseRule(apiKey: string, id: string, body: Partial<PulseRuleDTO>): Promise<PulseRuleDTO> {
  return request<PulseRuleDTO>(`/pulse-rules/${id}`, apiKey, { method: 'PUT', body: JSON.stringify(body) });
}

export function deletePulseRule(apiKey: string, id: string): Promise<void> {
  return request<void>(`/pulse-rules/${id}`, apiKey, { method: 'DELETE' });
}

// ── Running sequences (2026-10-18) ──────────────────────────────────────────
export interface PulseJobDTO {
  id: string; kind: 'wait' | 'wait_for'; sourceName: string | null; label: string | null; viewer: string | null;
  runsInMs: number | null; waitingFor: { trigger: Record<string, any>; sameViewer: boolean; onTimeout: string } | null;
  timerId: string | null; createdAt: number; next: { type: string; message?: string; seconds?: number }[];
}
export function listPulseJobs(apiKey: string): Promise<PulseJobDTO[]> {
  return request<PulseJobDTO[]>('/pulse-rules/jobs', apiKey);
}
export function skipPulseJob(apiKey: string, id: string): Promise<void> {
  return request<void>(`/pulse-rules/jobs/${id}/skip`, apiKey, { method: 'POST' });
}
export function cancelPulseJob(apiKey: string, id: string): Promise<void> {
  return request<void>(`/pulse-rules/jobs/${id}`, apiKey, { method: 'DELETE' });
}

// ── Trigger/action picker lookups (2026-10-18) ──────────────────────────────
// These mirror the website's own PulseTriggerEditor.tsx/PulseActionEditor.tsx
// lookups exactly — see the native rendering in
// src/components/PulseTriggerEditor.tsx/PulseActionEditor.tsx in THIS repo.
// Each read-only GET route was widened from plain authenticateKick to
// authenticateKickOrApiKey on the website side specifically for this
// (2026-10-18) — see each route's own comment in routes/pulseRules.js,
// routes/points.js, routes/tts.js.
export interface RewardOption { id: string; title: string; cost: number }

async function fetchRewardList(path: string, apiKey: string): Promise<{ data?: RewardOption[]; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 403) return { error: 'reconnect' };
    if (res.status === 400) return { error: 'no_account' };
    if (!res.ok) return { error: 'failed' };
    const body: any = await res.json();
    return { data: Array.isArray(body) ? body : (body?.data ?? []) };
  } catch {
    return { error: 'failed' };
  }
}
export function getKickRewards(apiKey: string) { return fetchRewardList('/pulse-rules/kick-rewards', apiKey); }
export function getTwitchRewards(apiKey: string) { return fetchRewardList('/pulse-rules/twitch-rewards', apiKey); }
export function getPointsRewards(apiKey: string) { return fetchRewardList('/points/rewards', apiKey); }

export function getCounters(apiKey: string): Promise<string[]> {
  return request<any[]>('/counters', apiKey).then((d) => (Array.isArray(d) ? d.map((c) => c.name).filter(Boolean) : []));
}

export interface TtsVoiceOption { voice_provider: string; voice_id: string; voice_label?: string; voice_image?: string }
export function getTtsVoices(apiKey: string): Promise<TtsVoiceOption[]> {
  return request<TtsVoiceOption[]>('/tts/commands', apiKey).catch(() => []);
}

// Set Stream Title/Set Kick Category/Set Twitch Category actions' own
// category search (2026-10-27) — see the website's routes/streamInfo.js/
// lib/streamInfo.js for the real Kick/Twitch API calls this proxies to.
export interface CategoryOption { id: string | number; name: string }
export function searchStreamCategories(apiKey: string, platform: 'kick' | 'twitch', query: string): Promise<CategoryOption[]> {
  return request<CategoryOption[]>(`/stream-info/categories?platform=${platform}&q=${encodeURIComponent(query)}`, apiKey).catch(() => []);
}

// runPulseAction (2026-10-27) — fires any Pulse Engine action type
// directly, right now, with no saved rule needed — the exact same
// POST /pulse-rules/run-action the Stream Deck plugin's own Pulse Action
// button already calls. Used by SongRequestsPage's Skip/Pause/Resume/
// Previous buttons (music_skip/music_pause/music_resume/music_previous)
// so a streamer can control Song Requests from this app without having to
// build a whole Pulse Engine rule just to press a button once.
export function runPulseAction(apiKey: string, action: Record<string, unknown>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/pulse-rules/run-action', apiKey, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

// ── Chat Bot (2026-10-18) — native rebuild, replacing the embedded website
// view. Every route here was widened to authenticateKickOrApiKey the same
// day specifically for this (see routes/commands.js, routes/counters.js,
// server.js's own comments on each route) — real server-side validation/
// limits/cooldowns run exactly the same way as the website's own page,
// since this calls the SAME endpoints, not a second reimplementation.
export interface CommandRow {
  id: string; name: string; message: string; type: 'variable' | 'timed' | 'walkon' | 'keyword';
  platform: 'all' | 'kick' | 'twitch'; permission?: string; enabled: boolean;
  cooldown_seconds?: number; user_cooldown_seconds?: number;
  aliases?: string[]; keyword_phrases?: string[]; hidden_from_public?: boolean;
  condition_title?: string | null; condition_game?: string | null;
  rotation_messages?: any; rotation_mode?: 'sequential' | 'random';
  target_username?: string | null; send_as_user?: boolean;
  action?: string; action_target?: string | null; action_value?: string | null;
  sound_url?: string | null; sound_volume?: number;
  tts_enabled?: boolean; tts_voice_provider?: string; tts_voice_id?: string; tts_voice_label?: string; tts_voice_image?: string;
  tts_read_name?: boolean;
  trigger_type?: 'interval' | 'stream_start' | 'stream_end';
  timer_minutes?: number | null; offline_interval_minutes?: number | null; min_chat_activity?: number | null;
  walkon_username?: string | null; walkon_skip_if_personal?: boolean;
  module_id?: string | null;
}
export function listCommands(apiKey: string): Promise<CommandRow[]> {
  return request<CommandRow[]>('/commands', apiKey);
}
export function createCommand(apiKey: string, body: Partial<CommandRow>): Promise<CommandRow> {
  return request<CommandRow>('/commands', apiKey, { method: 'POST', body: JSON.stringify(body) });
}
export function updateCommand(apiKey: string, id: string, body: Partial<CommandRow>): Promise<CommandRow> {
  return request<CommandRow>(`/commands/${id}`, apiKey, { method: 'PUT', body: JSON.stringify(body) });
}
export function deleteCommand(apiKey: string, id: string): Promise<void> {
  return request<void>(`/commands/${id}`, apiKey, { method: 'DELETE' });
}
export function testSendCommand(apiKey: string, body: { message: string; platform?: string; sendAsUser?: boolean; targetUsername?: string | null }): Promise<{ ok: boolean; partialFailure?: string[] }> {
  return request(`/commands/test-send`, apiKey, { method: 'POST', body: JSON.stringify(body) });
}

export interface CounterRow { id: string; name: string; value: number }
export function listCountersFull(apiKey: string): Promise<CounterRow[]> {
  return request<CounterRow[]>('/counters', apiKey);
}
export function createCounter(apiKey: string, name: string, value = 0): Promise<CounterRow> {
  return request<CounterRow>('/counters', apiKey, { method: 'POST', body: JSON.stringify({ name, value }) });
}
export function adjustCounter(apiKey: string, name: string, patch: { value?: number; delta?: number }): Promise<CounterRow> {
  return request<CounterRow>(`/counters/${encodeURIComponent(name)}`, apiKey, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function deleteCounter(apiKey: string, name: string): Promise<void> {
  return request<void>(`/counters/${encodeURIComponent(name)}`, apiKey, { method: 'DELETE' });
}

export interface SpamConfig {
  bannedWords: { word: string; action: 'delete' | 'timeout' | 'ban'; timeoutDuration: number }[];
  bannedUsernames: { word: string; action: 'delete' | 'timeout' | 'ban'; timeoutDuration: number }[];
  blockLinks: boolean; linkWhitelist: string[];
  blockAllCaps: boolean; capsPercent: number; capsMinLength: number;
  maxRepeatedChars: number; maxMessageLength: number;
  blockEmoteSpam: boolean; maxEmotesPerMessage: number;
  blockUserRepetition: boolean; userRepetitionCount: number; userRepetitionWindowSeconds: number;
  blockGroupRepetition: boolean; groupRepetitionCount: number; groupRepetitionWindowSeconds: number;
  blockBotPromo: boolean; botPromoPhrases: string[];
  exemptRoles: ('moderator' | 'vip' | 'subscriber')[];
}
export function getSpamFilter(apiKey: string): Promise<{ enabled: boolean; config: Partial<SpamConfig> }> {
  return request('/spam-filter', apiKey);
}
export function saveSpamFilter(apiKey: string, enabled: boolean, config: SpamConfig): Promise<any> {
  return request('/spam-filter', apiKey, { method: 'PUT', body: JSON.stringify({ enabled, config }) });
}

export function getChatbotSettings(apiKey: string): Promise<{ ignore_bots: boolean; bot_usernames: string }> {
  return request('/chatbot-settings', apiKey);
}
export function saveChatbotSettings(apiKey: string, body: { ignore_bots: boolean; bot_usernames: string }): Promise<any> {
  return request('/chatbot-settings', apiKey, { method: 'PUT', body: JSON.stringify(body) });
}

// ── Chat Alerts (2026-10-18) — the config itself (chat_alert_configs) is a
// direct anon-open Supabase table, read/written straight from the renderer
// (src/lib/supabase.ts) exactly like Scenes/Alert Studio already do — only
// the two "Send Test" buttons are real server routes.
export function testSendChatAlert(apiKey: string, body: { eventType: string; platform: 'kick' | 'twitch'; isResub?: boolean; payload?: any }): Promise<{ ok: boolean; sent: string }> {
  return request('/alert-chat-test-send', apiKey, { method: 'POST', body: JSON.stringify(body) });
}
export function testSendLevelUp(apiKey: string): Promise<{ ok: boolean; sent: string }> {
  return request('/points/level-up-test-send', apiKey, { method: 'POST' });
}

// ── Moderation (2026-10-18) ──────────────────────────────────────────────
export function getModerationPending(apiKey: string): Promise<{ songRequests: any[]; redemptions: any[]; donations: any[]; total: number }> {
  return request('/moderation/pending', apiKey);
}
export function resolveSongRequest(apiKey: string, id: string, status: 'approved' | 'denied' | 'played'): Promise<any> {
  return request(`/song-requests/queue/${id}/resolve`, apiKey, { method: 'POST', body: JSON.stringify({ status }) });
}
export function resolveRedemption(apiKey: string, id: string, status: 'fulfilled' | 'rejected'): Promise<any> {
  return request(`/points/redemptions/${id}/resolve`, apiKey, { method: 'POST', body: JSON.stringify({ status }) });
}
export function approveDonation(apiKey: string, id: string): Promise<any> {
  return request(`/donations/${id}/approve`, apiKey, { method: 'POST' });
}
export function dismissDonation(apiKey: string, id: string): Promise<any> {
  return request(`/donations/${id}/dismiss`, apiKey, { method: 'POST' });
}
export function moderationAction(apiKey: string, kind: 'timeout' | 'ban' | 'unban', body: { platform: 'kick' | 'twitch'; targetUsername: string; durationSeconds?: number; reason?: string }): Promise<any> {
  return request(`/moderation/${kind}`, apiKey, { method: 'POST', body: JSON.stringify(body) });
}

// Twitch-only (Kick has no chat-mode API at all, confirmed against Kick's
// own public API docs — see routes/moderation.js's own header on the
// server). These two just forward to the server's already-built
// /moderation/chat-settings + /moderation/chat-mode routes (built 2026-10-16
// for the website's own Moderation Dashboard, never ported to this app's
// native rebuild until now).
export function getChatSettings(apiKey: string): Promise<any> {
  return request('/moderation/chat-settings', apiKey);
}
export function setChatMode(apiKey: string, body: Record<string, any>): Promise<any> {
  return request('/moderation/chat-mode', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

// ── Connections (2026-10-22, native rebuild — direct feedback: "I want the
// settings and connections page on the desktop app to be actually on the
// app. Not loading the site.") — same routes/youtube.js, routes/tiktok.js,
// server.js (/platform-accounts/disconnect, /bot-identity/*,
// /subscribe-events, /subscription-status) endpoints the website's own
// src/pages/Connections.tsx already uses. Each of those server routes was
// widened from authenticateKick/authenticateAny to accept this app's own
// API-key credential too (see each route's own comment on the server) —
// no new server functionality, just a second, equally-valid way in.
export interface YoutubeStatus {
  connected: boolean;
  channelTitle?: string;
  avatar?: string | null;
  secondary?: { channelTitle: string; avatar: string | null } | null;
}
export function getYoutubeStatus(apiKey: string): Promise<YoutubeStatus> {
  return request('/youtube/status', apiKey);
}
export function connectYoutube(apiKey: string, handle: string): Promise<{ ok: boolean; channelTitle: string; avatar: string | null }> {
  return request('/youtube/connect', apiKey, { method: 'POST', body: JSON.stringify({ handle }) });
}
export function connectYoutubeSecondary(apiKey: string, handle: string): Promise<{ ok: boolean; channelTitle: string; avatar: string | null }> {
  return request('/youtube/connect-secondary', apiKey, { method: 'POST', body: JSON.stringify({ handle }) });
}
export function disconnectYoutube(apiKey: string): Promise<{ ok: boolean }> {
  return request('/youtube/disconnect', apiKey, { method: 'POST' });
}
export function disconnectYoutubeSecondary(apiKey: string): Promise<{ ok: boolean }> {
  return request('/youtube/disconnect-secondary', apiKey, { method: 'POST' });
}

export interface TiktokStatus { connected: boolean; username?: string | null }
export function getTiktokStatus(apiKey: string): Promise<TiktokStatus> {
  return request('/tiktok/status', apiKey);
}
export function connectTiktok(apiKey: string, username: string): Promise<{ ok: boolean; username: string }> {
  return request('/tiktok/connect', apiKey, { method: 'POST', body: JSON.stringify({ username }) });
}
export function disconnectTiktok(apiKey: string): Promise<{ ok: boolean }> {
  return request('/tiktok/disconnect', apiKey, { method: 'POST' });
}

export function disconnectTwitchPlatform(apiKey: string): Promise<{ ok: boolean }> {
  return request('/platform-accounts/disconnect', apiKey, { method: 'POST', body: JSON.stringify({ platform: 'twitch' }) });
}

export interface BotStatus {
  isUltimate: boolean;
  custom: { platform: string; username: string; display_name: string; needs_reauth: boolean }[];
  official: { platform: string; username: string; display_name: string; needs_reauth: boolean }[];
  preferences: { kick: boolean; twitch: boolean };
}
export function getBotIdentityStatus(apiKey: string): Promise<BotStatus> {
  return request('/bot-identity/status', apiKey);
}
export function disconnectBotIdentity(apiKey: string, platform: 'kick' | 'twitch'): Promise<{ ok: boolean }> {
  return request('/bot-identity/disconnect', apiKey, { method: 'POST', body: JSON.stringify({ platform }) });
}
export function setBotIdentityPreference(apiKey: string, platform: 'kick' | 'twitch', useOfficialBot: boolean): Promise<{ ok: boolean }> {
  return request('/bot-identity/preference', apiKey, { method: 'PUT', body: JSON.stringify({ platform, useOfficialBot }) });
}

export function getSubscriptionStatus(userId: string): Promise<{ kick: boolean; twitch: boolean }> {
  return fetch(`${BASE_URL}/subscription-status?userId=${encodeURIComponent(userId)}`)
    .then(r => r.ok ? r.json() as Promise<{ kick: boolean; twitch: boolean }> : { kick: false, twitch: false })
    .catch(() => ({ kick: false, twitch: false }));
}
export function subscribeEvents(userId: string, platform: 'kick' | 'twitch'): Promise<{ success: boolean }> {
  return fetch(`${BASE_URL}/subscribe-events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, userId }),
  }).then(async r => {
    if (!r.ok) throw new ApiError((await r.text().catch(() => '')) || 'Subscribe failed', r.status);
    return { success: true };
  });
}

// ── Settings (2026-10-22, native rebuild) — Discord live notification and
// account deletion, same routes/discord.js + server.js (/account/delete)
// endpoints the website's own Settings.tsx already uses. API key
// management is deliberately NOT rebuilt here — routes/apiKeys.js stays
// dashboard-only (authenticateKick, no API-key fallback) on purpose, since
// letting an API-key-authenticated session mint/revoke API keys through
// itself would be a real privilege-persistence risk (a leaked key could
// keep minting replacements even after the original is revoked) — see that
// file's own header comment. SettingsPage.tsx instead links out to the
// website for that one specific action.
export interface DiscordSettings { webhookUrl: string; enabled: boolean }
export function getDiscordSettings(apiKey: string): Promise<DiscordSettings> {
  return request('/discord/settings', apiKey);
}
export function saveDiscordSettings(apiKey: string, body: DiscordSettings): Promise<any> {
  return request('/discord/settings', apiKey, { method: 'PUT', body: JSON.stringify(body) });
}
export function testDiscordWebhook(apiKey: string, webhookUrl: string): Promise<{ ok: boolean }> {
  return request('/discord/test', apiKey, { method: 'POST', body: JSON.stringify({ webhookUrl }) });
}

export function deleteAccount(apiKey: string): Promise<{ ok: boolean }> {
  return request('/account/delete', apiKey, { method: 'POST' });
}
