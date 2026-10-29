// electron/main.ts — app entry point. Creates the always-on overlay window
// (the actual "scares you over your game" mechanism) and the main app
// shell window, starts the local media server, wires up OBS control, and —
// once an API key is saved — connects to KickPulse's WS hub so a real
// jumpscare trigger (chat command, Pulse Engine action, or the meter
// maxing out) plays locally over whatever's on screen.

import { app, BrowserWindow, globalShortcut, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import {
  createOverlayWindow, playJumpscare, playScene,
  listDisplays, getCurrentDisplay, moveOverlayToDisplay, flashHighlight, watchDisplayChanges,
} from './overlay-window';
import { loadConfig, saveConfig, addLocalMediaItem, removeLocalMediaItem } from './store';
import { connectToKickPulse } from './ws-client';
import type { WsClientHandle } from './ws-client';
import { connectTwitchIrc } from './twitch-irc';
import {
  loginWithKick, loginWithTwitch, linkKick, linkTwitch, connectCustomBotKick, connectCustomBotTwitch,
} from './oauth-login';
import type { TwitchIrcHandle } from './twitch-irc';
import {
  pushChatMessage, pushEvent, getRecentChat, getRecentEvents, clearAll as clearChatFeed,
  summarizeKickEvent, summarizeTwitchEvent, KNOWN_KICK_EVENT_TYPES, KNOWN_TWITCH_EVENT_TYPES,
} from './chat-feed';
import {
  getMe, getJumpscareConfig, getScenesConfig, reportObsState, reportObsSources, reportMeldState, reportMeldLayers, reportLightDevices,
  reportLightScenes, reportLightReactions, reportVoiceEnabled,
  listStreamInfoPresets, createStreamInfoPreset, deleteStreamInfoPreset, applyStreamInfoPreset,
  listPulseRules, createPulseRule, updatePulseRule, deletePulseRule,
  listPulseJobs, skipPulseJob, cancelPulseJob,
  getKickRewards, getTwitchRewards, getPointsRewards, getCounters, getTtsVoices, searchStreamCategories, runPulseAction,
  listCommands, createCommand, updateCommand, deleteCommand, testSendCommand,
  listCountersFull, createCounter, adjustCounter, deleteCounter,
  getSpamFilter, saveSpamFilter, getChatbotSettings, saveChatbotSettings,
  testSendChatAlert, testSendLevelUp,
  getModerationPending, resolveSongRequest, resolveRedemption, approveDonation, dismissDonation, moderationAction,
  getChatSettings, setChatMode, getViewerInfo, getCommunityBanSettings, setCommunityBanSettings, getKickSubscriberBadges,
  getCommunityBanList, applyCommunityBans, unbanCommunityBanEntry, unbanAllCommunityBans,
  getViewerFlags, addViewerFlag, removeViewerFlag, getBanSquads, createBanSquad, joinBanSquad, leaveBanSquad,
  getYoutubeStatus, connectYoutube, connectYoutubeSecondary, disconnectYoutube, disconnectYoutubeSecondary,
  getTiktokStatus, connectTiktok, disconnectTiktok, disconnectTwitchPlatform,
  getBotIdentityStatus, disconnectBotIdentity,
  getSubscriptionStatus, subscribeEvents,
  getDiscordSettings, saveDiscordSettings, testDiscordWebhook, deleteAccount,
} from './api';
import { startMediaServer } from './media-server';
import * as obsClient from './obs-client';
import * as meldClient from './meld-client';
import * as lights from './lights-manager';
import * as lightScenes from './light-scenes';
import * as lightReactions from './light-reactions';
import { createKickClip } from './kick-clip';
import { postClipResult } from './clip-result-report';
import {
  startVoiceListening, stopVoiceListening, setVoiceInputDevice, isVoiceListening, registerVoiceIpc,
} from './voice-window';
import {
  getHeardLog, getCachedPhrases, getLivePartialText, invalidateRecognizer, ensureModelDownloaded,
  isModelReady, type VoiceModelSize,
} from './voiceCommands';
import type {
  JumpscarePayload, DesktopStatus, JumpscareConfigResponse, MediaServerInfo,
  ScenesConfigResponse,
} from './types';
import { initUpdater, getUpdaterStatus, checkForUpdates, installUpdate } from './updater';

// Single-instance lock (2026-10-27) — found via a real incident, not
// theorized: a voice-triggered "Start Streaming (OBS)" fired THREE nearly
// simultaneous RTMP connect attempts on the same output (confirmed from the
// user's own OBS log — "Cannot apply a new video_t object after the encoder
// has been initialized", repeated 3x within ~470ms), and crashed OBS once.
// This app had no single-instance guard at all — if a second copy is ever
// running (a fresh install launched without quitting the old one first,
// which happened repeatedly this session while testing v0.2.1/0.2.2/0.2.3),
// EACH copy independently connects to both the server's WS hub and the
// SAME local OBS/Meld, so one trigger fires once per running copy, all at
// once. Harmless for an idempotent action (switching to the same scene
// twice is a no-op); genuinely harmful for StartStream specifically, since
// OBS's own stream encoder isn't reentrant — two near-simultaneous start
// calls race directly into the error above. `process.exit(0)` (not just
// `app.quit()`) is deliberate: `app.quit()` only requests a quit, it
// doesn't halt further synchronous module execution, so without the exit
// call this losing instance would still run every side-effecting line below
// (media server, OBS/Meld connections, WS subscribe) before the quit
// actually took effect.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  createMainWindow();
});

const isDev = !!process.env.VITE_DEV_SERVER_URL;

const TEST_HOTKEY = 'CommandOrControl+Alt+J';

// A bundled, no-network-dependency demo scene — same "the test button always
// does SOMETHING, even before any real config exists" reasoning
// resolvePayload() already applies to jumpscares. Lets someone try the
// Scenes feature on first run, before ever building a real one on the
// website, and doubles as this app's own end-to-end smoke test for the
// scene renderer itself.
const SAMPLE_SCENE = {
  id: '__sample__', name: 'Sample Scene',
  duration: 5, soundUrl: '', soundVolume: 80,
  sceneEnter: 'zoom', sceneExit: 'fade', sceneEnterSec: 0.5, sceneExitSec: 0.45,
  background: {
    type: 'gradient', color: '0a0a12',
    gradientColors: ['1a0b2e', '0a0a12'], gradientType: 'linear', gradientAngle: 135,
    gradientAnimated: true, gradientSpeed: 10,
    mediaUrl: '', mediaFit: 'cover', accentColor: '00ff9d', dim: 0,
  },
  elements: [
    {
      id: 'e1', type: 'light', x: 30, y: 30, w: 40, h: 40, opacity: 70, visible: true, delay: 0,
      color: '00ff9d', intensity: 80, anim: 'pulse', speed: 2.5, feather: 72,
    },
    {
      id: 'e2', type: 'container', x: 15, y: 55, w: 70, h: 28, opacity: 100, visible: true, delay: 0,
      bgColor: '000000', bgOpacity: 0.55, borderColor: '00ff9d', borderWidth: 2, borderRadius: 16,
      glow: true, glowColor: '00ff9d', glowAmount: 18,
      ambientAnim: 'shine', ambientColor: '00ff9d', ambientSpeed: 2.5,
    },
    {
      id: 'e3', type: 'text', x: 15, y: 58, w: 70, h: 20, opacity: 100, visible: true, delay: 0.1,
      template: '{username} is testing the KickPulse Desktop app!',
      fontFamily: 'Arial', fontSize: 38, color: 'ffffff', variableColor: '00ff9d',
      bgEnabled: false, bgColor: '000000', bgOpacity: 0.55,
      bold: true, italic: false, letterSpacing: 0, textAlign: 'center', padding: 12, borderRadius: 12,
      glowColor: '000000', glowAmount: 10, reveal: 'fade', revealCharsPerSec: 28, cursor: false,
      accents: [{ id: 'a1', type: 'pulse', speed: 2 }],
      variableCase: 'none', variableColorMode: 'solid', variableRainbowSpeed: 2.5,
    },
  ],
};

let mainWindow: BrowserWindow | null = null;
let wsHandle: WsClientHandle | null = null;
let twitchIrcHandle: TwitchIrcHandle | null = null;
let remoteConfig: JumpscareConfigResponse | null = null;
let scenesConfig: ScenesConfigResponse | null = null;
let currentStatus: DesktopStatus = { connected: false, me: null };
let mediaServerInfo: MediaServerInfo | null = null;

function createMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: 'KickPulse Desktop',
    icon: path.join(__dirname, '../assets/icon.png'),
    // Frameless (2026-10-20, direct feedback: "that logo on the top bar of
    // the app is far too small to even be seen. lets just center the name
    // kickpulse on that bar") — a native OS title bar can't center its text
    // or show the icon any bigger than the OS's own fixed small size, so
    // there's no frame-only fix for either complaint. The app now draws its
    // own title bar (components/TitleBar.tsx) with the name centered and
    // its own min/max/close buttons; the real logo moved to the sidebar
    // instead (see Sidebar.tsx), where it can actually be seen.
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Alert Studio / Overlay Studio (2026-10-16) — both editor pages now
      // embed the real website's own editor in a <webview>, rather than a
      // second, independently-drifting native re-implementation (see
      // OverlayStudioPage.tsx/AlertStudioPage.tsx's own headers). Needs the
      // tag explicitly enabled; contextIsolation/nodeIntegration above are
      // unaffected — a <webview>'s guest page gets its own separate process
      // and web-standard sandboxing regardless of this flag.
      webviewTag: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log('[app console]', message);
  });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false));
}

function setStatus(next: DesktopStatus): void {
  currentStatus = next;
  mainWindow?.webContents.send('status-update', currentStatus);
}

// setVoiceEnabled — extracted from the 'voice:set-enabled' IPC handler
// (2026-10-27) so the new voice.setEnabled WS case (the Stream Deck plugin's
// own "Toggle Voice Commands" button, routed through the same WS hub every
// other remote-control action already uses) can share the exact same
// enable/disable logic, including the "model not downloaded yet" guard,
// instead of a second, drifting copy of it.
function setVoiceEnabled(enabled: boolean): { ok: boolean; needsModelDownload?: boolean } {
  if (enabled && !isModelReady(loadConfig().voiceModelSize)) {
    return { ok: false, needsModelDownload: true };
  }
  saveConfig({ voiceEnabled: enabled });
  if (enabled) startVoiceListening(loadConfig().voiceInputDeviceId);
  else stopVoiceListening();
  reportVoiceEnabledNow();
  return { ok: true };
}

// reportVoiceEnabledNow — tells the website whether Voice Commands is
// actually on right now, so the Stream Deck plugin's own Voice Commands
// button can show a real green/red fill instead of guessing. Called right
// here (covers both the IPC handler and the voice.setEnabled WS case, since
// both already funnel through setVoiceEnabled above), plus once at startup
// and on the same periodic interval the light/OBS/Meld state reports
// already use, same reasoning as those: an open-but-idle app shouldn't look
// stale to the website just because nothing happened to toggle in a while.
function reportVoiceEnabledNow(): void {
  const apiKey = loadConfig().apiKey;
  if (!apiKey) return;
  reportVoiceEnabled(apiKey, loadConfig().voiceEnabled).catch(() => {});
}

async function connectAccount(apiKey: string): Promise<void> {
  wsHandle?.close();
  wsHandle = null;
  twitchIrcHandle?.close();
  twitchIrcHandle = null;
  clearChatFeed(); // a new/different account's chat history has no business lingering
  try {
    const me = await getMe(apiKey);
    setStatus({ connected: true, me });
    remoteConfig = await getJumpscareConfig(apiKey).catch(() => null);
    scenesConfig = await getScenesConfig(apiKey).catch(() => null);
    if (me.kickBroadcasterId) {
      wsHandle = connectToKickPulse(me.kickBroadcasterId, handleWsMessage);
    } else {
      console.warn('[desktop] no Kick account linked — live events cannot reach this app yet');
    }
    // Live Chat feed's Twitch half (2026-10-19) — Kick chat already arrives
    // over wsHandle above (server.js forwards chat.message.sent to every
    // subscribed WS client); Twitch chat never does (see twitch-irc.ts's
    // own header), so this app needs its own direct connection, same as
    // the website's own chat widgets.
    if (me.twitchConnected && me.twitchUsername) {
      twitchIrcHandle = connectTwitchIrc(me.twitchUsername, (msg) => {
        const chatMsg = {
          id: msg.id, platform: 'twitch' as const, username: msg.username, content: msg.content,
          color: msg.color, badges: msg.badges, createdAt: msg.createdAt, emotesTag: msg.emotesTag,
        };
        pushChatMessage(chatMsg);
        mainWindow?.webContents.send('chat-feed:message', chatMsg);
      });
    }
  } catch (err: any) {
    setStatus({ connected: false, me: null, error: err?.message || 'Failed to connect' });
  }
}

/** Every real-time message this app reacts to, regardless of which Pulse
 *  Engine action (or other trigger) produced it. See ws-client.ts's own
 *  header for why the dispatch logic lives here, not there. */
function handleWsMessage(msg: any): void {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'jumpscare_trigger') {
    fireJumpscare().catch((err) => console.error('[jumpscare] fire failed', err));
    return;
  }

  if (msg.type === 'kickEvent') {
    // chat.message.sent (2026-10-19) — the Live Chat feed's Kick half.
    // Twitch chat never reaches this WS connection at all (see
    // connectAccount's own comment on why it needs its own IRC
    // connection) — Kick's own chat.message.sent event, by contrast, is
    // already forwarded to every subscribed WS client by server.js, so
    // this app just needed to start actually DOING something with it.
    if (msg.event === 'chat.message.sent' && msg.payload) {
      const sender = msg.payload.sender || {};
      const chatMsg = {
        id: String(msg.payload.message_id || `kick-${Date.now()}-${Math.random()}`),
        platform: 'kick' as const,
        username: sender.username || 'Unknown',
        content: msg.payload.content || '',
        color: sender.identity?.username_color || null,
        badges: sender.identity?.badges || [],
        createdAt: msg.payload.created_at || new Date().toISOString(),
      };
      pushChatMessage(chatMsg);
      mainWindow?.webContents.send('chat-feed:message', chatMsg);
      return;
    }
    // youtube.chatMessage / tiktok.chatMessage (2026-10-20, direct request:
    // "add tiktok and youtube chat and events (whatever we are actually
    // able to track as it hasnt been tested much)") — both arrive over
    // this exact same WS connection, same generic envelope Kick's own
    // events use (lib/youtubeLive.js's broadcastYoutubeAlert/
    // lib/tiktokLive.js's broadcastTiktokChat aren't Kick-specific, just
    // this app's one shared relay). Both are genuinely gated server-side on
    // a real OBS Chat Overlay/Scrolling Chat widget having YouTube/TikTok
    // chat configured AND actively connected somewhere — this app doesn't
    // trigger that capture on its own, it only ever receives these if
    // something else already has it running. Untested against real
    // traffic as of this writing (no confirmed-live YouTube/TikTok account
    // to verify against) — payload shapes are taken directly from those
    // two lib files' own broadcast call sites, not guessed.
    if (msg.event === 'youtube.chatMessage' && msg.payload) {
      const chatMsg = {
        id: `yt-${Date.now()}-${Math.random()}`,
        platform: 'youtube' as const,
        username: msg.payload.username || 'Unknown',
        content: msg.payload.content || '',
        color: null,
        badges: msg.payload.badges || [],
        createdAt: new Date().toISOString(),
      };
      pushChatMessage(chatMsg);
      mainWindow?.webContents.send('chat-feed:message', chatMsg);
      return;
    }
    if (msg.event === 'tiktok.chatMessage' && msg.payload) {
      const chatMsg = {
        id: `tt-${Date.now()}-${Math.random()}`,
        platform: 'tiktok' as const,
        username: msg.payload.username || 'Unknown',
        content: msg.payload.content || '',
        color: null,
        badges: msg.payload.badges || [],
        createdAt: new Date().toISOString(),
      };
      pushChatMessage(chatMsg);
      mainWindow?.webContents.send('chat-feed:message', chatMsg);
      return;
    }
    if (msg.event === 'obs.switchScene' && msg.payload?.sceneName) {
      obsClient
        .switchScene(msg.payload.sceneName)
        .catch((err) => console.error('[obs] Pulse Engine scene switch failed', err?.message || err));
      return;
    }
    // obs.startStream/stopStream/startRecord/stopRecord (2026-10-15) — same
    // fire-and-forget shape as obs.switchScene right above: if the desktop
    // app isn't running or isn't connected to OBS, nothing happens, with no
    // error surfaced back to the rule (there's nowhere for one to go).
    if (msg.event === 'obs.startStream') { obsClient.startStream().catch((err) => console.error('[obs] start stream failed', err?.message || err)); return; }
    if (msg.event === 'obs.stopStream')  { obsClient.stopStream().catch((err) => console.error('[obs] stop stream failed', err?.message || err)); return; }
    if (msg.event === 'obs.startRecord') { obsClient.startRecord().catch((err) => console.error('[obs] start record failed', err?.message || err)); return; }
    if (msg.event === 'obs.stopRecord')  { obsClient.stopRecord().catch((err) => console.error('[obs] stop record failed', err?.message || err)); return; }
    // obs.toggleSource (2026-10-16) — the obs_toggle_source Pulse Engine
    // action's own broadcast. visible is explicit true/false, or
    // undefined/absent to mean "toggle" — see obs-client.ts's
    // toggleSourceVisible for how the real numeric sceneItemId gets
    // resolved from the (sceneName, sourceName) pair at fire time.
    if (msg.event === 'obs.toggleSource' && msg.payload?.sceneName && msg.payload?.sourceName) {
      obsClient
        .toggleSourceVisible(msg.payload.sceneName, msg.payload.sourceName, msg.payload.visible)
        .catch((err) => console.error('[obs] Pulse Engine source toggle failed', err?.message || err));
      return;
    }
    // obs.startReplayBuffer/stopReplayBuffer/saveReplayBuffer (2026-10-18) —
    // the obs_start_replay_buffer/obs_stop_replay_buffer/obs_save_replay_buffer
    // Pulse Engine actions' own broadcast — same fire-and-forget shape as
    // obs.startStream/stopStream above. saveReplayBuffer is the real !clip
    // command target.
    if (msg.event === 'obs.startReplayBuffer') { obsClient.startReplayBuffer().catch((err) => console.error('[obs] start replay buffer failed', err?.message || err)); return; }
    if (msg.event === 'obs.stopReplayBuffer')  { obsClient.stopReplayBuffer().catch((err) => console.error('[obs] stop replay buffer failed', err?.message || err)); return; }
    if (msg.event === 'obs.saveReplayBuffer')  { obsClient.saveReplayBuffer().catch((err) => console.error('[obs] save replay buffer failed', err?.message || err)); return; }
    // obs.startAitumBacktrack/stopAitumBacktrack/saveAitumBacktrack
    // (2026-10-27) — Aitum Vertical's own separate replay buffer, reached
    // through the SAME OBS websocket connection (it's a plugin, not a
    // separate app) via CallVendorRequest. See obs-client.ts's header for
    // how this was confirmed.
    if (msg.event === 'obs.startAitumBacktrack') { obsClient.startAitumBacktrack().catch((err) => console.error('[obs] start Aitum backtrack failed', err?.message || err)); return; }
    if (msg.event === 'obs.stopAitumBacktrack')  { obsClient.stopAitumBacktrack().catch((err) => console.error('[obs] stop Aitum backtrack failed', err?.message || err)); return; }
    if (msg.event === 'obs.saveAitumBacktrack')  { obsClient.saveAitumBacktrack().catch((err) => console.error('[obs] save Aitum backtrack failed', err?.message || err)); return; }
    // meld.* (2026-10-25) — same fire-and-forget, desktop-app-only shape as
    // the obs.* events above, for streamers using Meld Studio instead of OBS.
    if (msg.event === 'meld.switchScene' && msg.payload?.sceneId) {
      meldClient.switchScene(msg.payload.sceneId).catch((err) => console.error('[meld] Pulse Engine scene switch failed', err?.message || err));
      return;
    }
    if (msg.event === 'meld.toggleLayer' && msg.payload?.sceneId && msg.payload?.layerId) {
      meldClient.toggleLayer(msg.payload.sceneId, msg.payload.layerId).catch((err) => console.error('[meld] Pulse Engine layer toggle failed', err?.message || err));
      return;
    }
    if (msg.event === 'meld.startStream') { meldClient.startStream().catch((err) => console.error('[meld] start stream failed', err?.message || err)); return; }
    if (msg.event === 'meld.stopStream')  { meldClient.stopStream().catch((err) => console.error('[meld] stop stream failed', err?.message || err)); return; }
    if (msg.event === 'meld.startRecord') { meldClient.startRecord().catch((err) => console.error('[meld] start record failed', err?.message || err)); return; }
    if (msg.event === 'meld.stopRecord')  { meldClient.stopRecord().catch((err) => console.error('[meld] stop record failed', err?.message || err)); return; }
    // meld.recordClip/replayShow/replayDismiss (2026-10-26) — the
    // meld_record_clip/meld_show_replay/meld_dismiss_replay Pulse Engine
    // actions' own broadcast, Meld's real equivalent of OBS's replay buffer
    // save (see meld-client.ts's header for how this was confirmed to
    // exist at all). Same fire-and-forget shape as every other meld.*/obs.*
    // event above.
    if (msg.event === 'meld.recordClip') { meldClient.recordClip(msg.payload?.duration).catch((err) => console.error('[meld] record clip failed', err?.message || err)); return; }
    if (msg.event === 'meld.replayShow') { meldClient.showReplay().catch((err) => console.error('[meld] show replay failed', err?.message || err)); return; }
    if (msg.event === 'meld.replayDismiss') { meldClient.dismissReplay().catch((err) => console.error('[meld] dismiss replay failed', err?.message || err)); return; }
    // light.setState (2026-10-15) — the light_set_state Pulse Engine action's
    // own broadcast: payload.target is a specific configured light's id, or
    // 'all'; payload.on/brightness/color are each optional (only the fields
    // a rule actually set get applied — see lights-manager.ts's setDeviceState).
    // Same fire-and-forget, no-devices-configured-is-a-silent-no-op shape as
    // every other desktop-app-only action.
    if (msg.event === 'light.setState' && msg.payload) {
      const { target, on, brightness, color, momentary, holdMs, holdId } = msg.payload;
      if (momentary) {
        lights
          .setDeviceStateMomentary(target || 'all', { on, brightness, color }, { holdMs: Math.max(50, Number(holdMs) || 1500), holdId })
          .catch((err) => console.error('[lights] Pulse Engine momentary light update failed', err?.message || err));
      } else {
        lights
          .setDeviceState(target || 'all', { on, brightness, color })
          .catch((err) => console.error('[lights] Pulse Engine light update failed', err?.message || err));
      }
      return;
    }
    // light.revertHold (2026-10-22) — the server's authoritative "it's safe
    // to revert now" signal for a momentary hold that's waiting on a paired
    // TTS/sound effect to actually finish (Chat Bot Commands' "Duration"
    // field) rather than a fixed local timer alone. See lights-manager.ts's
    // setDeviceStateMomentary for the full reasoning.
    if (msg.event === 'light.revertHold' && msg.payload?.holdId) {
      lights.revertHold(msg.payload.holdId);
      return;
    }
    // light.fireReaction (2026-10-18) — the light_fire_reaction Pulse Engine
    // action's own broadcast: fires one of this app's own saved Light
    // Reactions (electron/light-reactions.ts) by id — plays through its
    // steps, then automatically restores whichever Light Scene is active.
    // Entirely local — the server has no idea what's actually inside a
    // reaction, it only ever relays "fire reaction X."
    if (msg.event === 'light.fireReaction' && msg.payload?.reactionId) {
      lightReactions.fireReaction(msg.payload.reactionId);
      return;
    }
    // light.setScene (2026-10-18) — the light_set_scene Pulse Engine action's
    // own broadcast: makes one of this app's own saved Light Scenes the new
    // baseline and applies it immediately (e.g. "when stream starts, switch
    // to the Cozy scene"). setAsDefault (2026-10-27, direct request — the
    // Stream Deck plugin's own new "Set Light Scene" button wanted a way to
    // apply a scene WITHOUT making it the new baseline, e.g. a quick one-off
    // look that should still revert to the real default afterward) defaults
    // to true so every rule saved before this field existed keeps its
    // original, only-ever-had-one-behavior — applyScene (no payload, see
    // electron/light-scenes.ts) is the new temporary-only path.
    if (msg.event === 'light.setScene' && msg.payload?.sceneId) {
      if (msg.payload.setAsDefault === false) lightScenes.applyScene(msg.payload.sceneId).catch(() => {});
      else lightScenes.setActiveScene(msg.payload.sceneId).catch(() => {});
      return;
    }
    // voice.setEnabled (2026-10-27) — the Stream Deck plugin's own new
    // "Toggle Voice Commands" button, routed through the same WS hub as
    // every other remote-control action. mode 'toggle' flips whatever
    // Voice Commands is currently set to; 'on'/'off' set it directly.
    if (msg.event === 'voice.setEnabled' && msg.payload?.mode) {
      const mode = msg.payload.mode;
      const next = mode === 'toggle' ? !isVoiceListening() : mode === 'on';
      setVoiceEnabled(next);
      return;
    }
    // scenes.play — Pulse Scenes (the text/media/light/shape/fill/counter/
    // container composer), fired by a Pulse Engine trigger_scene action
    // (among other real triggers — see ScenesWidget.tsx on the website,
    // this mirrors its own handleWsEvent exactly: no kind-matching, every
    // fire already names its exact target scene by id). The website's own
    // widget does this same lookup against its own freshly-fetched config;
    // this app does it against the ONE scenesConfig snapshot fetched at
    // connect time, which is a real, accepted limitation (same shape as
    // remoteConfig for jumpscares) — a scene edited on the website mid-
    // stream won't be picked up here until the next reconnect.
    if (msg.event === 'scenes.play' && msg.payload?.sceneId) {
      const scene = scenesConfig?.scenes.find((s) => s.id === msg.payload.sceneId);
      if (!scene) {
        console.warn('[scenes] scenes.play fired for an id this app has no config for', msg.payload.sceneId);
        return;
      }
      playScene({
        scene,
        tokens: {
          username: msg.payload.username,
          amount: msg.payload.amount,
          message: msg.payload.message,
          viewers: msg.payload.viewers,
          reward: msg.payload.reward,
        },
      });
      return;
    }

    // clip.create — a !clip chat command (server.js, Kick-only, desktop-only
    // gated) asking this app to actually create a real Kick clip. See
    // kick-clip.ts's own header for the full mechanism — trim_start is now
    // measured live from Kick's own preview playlist in there, not sent by
    // the server at all. Fire-and-forget from this handler's own
    // perspective — createKickClip() does the real work async and
    // postClipResult() reports back whenever it resolves, however long
    // that takes.
    if (msg.event === 'clip.create' && msg.payload?.requestId) {
      const { requestId, kickSlug, videoId, duration, title, debug } = msg.payload;
      const apiKey = loadConfig().apiKey;
      createKickClip({ kickSlug, videoId, duration: Number(duration) || 30, title: title || 'Clip', debug: !!debug })
        .then((result) => { if (apiKey) return postClipResult(apiKey, requestId, result); })
        .catch((e) => {
          console.error('[clip] createKickClip threw', e);
          if (apiKey) postClipResult(apiKey, requestId, { ok: false, error: e?.message || String(e) });
        });
      return;
    }

    // A REAL Kick webhook event (follow/sub/gift/kicks/reward/ban/live-
    // status) — explicit allowlist, not "anything we didn't already handle
    // above" (see chat-feed.ts's own comment on KNOWN_KICK_EVENT_TYPES for
    // the 2026-10-19 nowPlaying.update spam this fixes: the server
    // broadcasts a lot of other per-widget control signals the exact same
    // way, e.g. spinWheel.*/nameRoller.*/timer.*/credits.roll/nowPlaying.*,
    // none of which are "events" worth showing here).
    if (msg.event && msg.payload && KNOWN_KICK_EVENT_TYPES.has(msg.event)) {
      // youtube.* events share this same envelope (see the chatMessage
      // branches above) but aren't Kick — tag them correctly rather than
      // defaulting every event here to 'kick'.
      const evtPlatform: 'youtube' | 'kick' = msg.event.startsWith('youtube.') ? 'youtube' : 'kick';
      const evt = {
        id: `kick-${msg.event}-${Date.now()}-${Math.random()}`,
        platform: evtPlatform,
        eventType: msg.event,
        summary: summarizeKickEvent(msg.event, msg.payload),
        createdAt: new Date().toISOString(),
      };
      pushEvent(evt);
      mainWindow?.webContents.send('chat-feed:event', evt);
    }
    return;
  }

  // twitchEvent (2026-10-19) — every NON-chat Twitch event (chat is its own
  // IRC connection, see connectAccount) server.js already fans out over
  // this same WS connection but this app never did anything with before.
  // Same explicit allowlist as the Kick side above.
  if (msg.type === 'twitchEvent' && msg.event && msg.payload && KNOWN_TWITCH_EVENT_TYPES.has(msg.event)) {
    const evt = {
      id: `twitch-${msg.event}-${Date.now()}-${Math.random()}`,
      platform: 'twitch' as const,
      eventType: msg.event,
      summary: summarizeTwitchEvent(msg.event, msg.payload),
      createdAt: new Date().toISOString(),
    };
    pushEvent(evt);
    mainWindow?.webContents.send('chat-feed:event', evt);
  }
}

/** Builds the jumpscare payload to actually play: whatever the website has
 *  configured on the Jumpscare Meter widget's 'overlay' mode, else a plain
 *  on-brand placeholder (so the test hotkey/button always does SOMETHING
 *  even before anyone's configured a real one) — never a bundled "sample"
 *  media file. There used to be one (assets/sample-jumpscare.mp4, deleted
 *  2026-10-19): it was, in fact, a recorded Alert Studio Gift-alert test
 *  fire (spinning sacred-geometry background, "BigGifter GIFTED 100" text,
 *  a checkerboard transparency artifact baked right into the pixels from
 *  however it got exported) — completely unrelated to jumpscares, and
 *  completely unrelated to whatever's actually in anyone's account. It only
 *  ever played because this function fell back to it whenever
 *  remoteConfig.mediaUrl was empty, which is EXACTLY what a real account
 *  configured for 'scenes' mode (targetSceneId instead of uploaded media)
 *  looks like — see fireJumpscare()'s own scenes-mode branch below, which is
 *  the actual fix: a 'scenes'-mode account now gets its real configured
 *  Scene, never falls into this function at all. */
async function resolvePayload(): Promise<JumpscarePayload> {
  if (remoteConfig?.mediaUrl) {
    return {
      mediaUrl: remoteConfig.mediaUrl,
      audioUrl: remoteConfig.audioUrl || undefined,
      duration: remoteConfig.duration,
      volume: remoteConfig.volume,
    };
  }

  return { mediaUrl: '', duration: 3, volume: 0, placeholder: true };
}

function toFileUrl(p: string): string {
  // Windows paths need their backslashes flipped for a valid file:// URL.
  const normalized = p.replace(/\\/g, '/');
  return `file:///${normalized}`;
}

async function fireJumpscare(): Promise<void> {
  // 'scenes' mode (2026-10-19 fix — see resolvePayload()'s own comment) —
  // the real configured reaction is a Pulse Scene, not jumpscare media at
  // all. Play the REAL targeted scene the exact same way a live
  // `scenes.play` WS event does, instead of ever falling through to a media
  // player with nothing real to show. A missing/deleted target scene falls
  // through to the placeholder below rather than silently doing nothing.
  if (remoteConfig?.mode === 'scenes' && remoteConfig.targetSceneId) {
    const scene = scenesConfig?.scenes.find((s) => s.id === remoteConfig!.targetSceneId);
    if (scene) {
      playScene({
        scene,
        tokens: { username: 'TestUser', amount: 25, message: 'Test Jumpscare', viewers: 42, reward: 'Test Reward' },
      });
      return;
    }
  }
  playJumpscare(await resolvePayload());
}

/** Shared by the "Test a Scene Now" button and the test hotkey below — see
 *  the `scenes:test` IPC handler for why this falls back to SAMPLE_SCENE. */
function testSceneNow(): void {
  const scene = scenesConfig?.scenes?.[0] ?? SAMPLE_SCENE;
  playScene({
    scene: scene as any,
    tokens: { username: 'TestUser', amount: 25, message: 'Hello from the desktop app!', viewers: 42, reward: 'Test Reward' },
  });
}

app.whenReady().then(async () => {
  createOverlayWindow(loadConfig().overlayDisplayId);
  createMainWindow();

  // Self-heal if the CONFIGURED display gets unplugged mid-session — see
  // watchDisplayChanges's own comment. No need to notify the renderer here;
  // the Overlay settings page re-fetches current status itself whenever
  // it's open (same "don't bother pushing a live update for a rare edge
  // case" tradeoff this app already makes elsewhere, e.g. light devices).
  watchDisplayChanges(() => loadConfig().overlayDisplayId, () => {});

  globalShortcut.register(TEST_HOTKEY, () => {
    fireJumpscare().catch((err) => console.error('[jumpscare] test hotkey failed', err));
  });
  globalShortcut.register('CommandOrControl+Alt+S', testSceneNow);

  try {
    mediaServerInfo = await startMediaServer(() => loadConfig().localMediaLibrary);
    console.log('[media server] listening at', mediaServerInfo.baseUrl);
  } catch (err: any) {
    console.error('[media server] failed to start', err?.message || err);
  }

  obsClient.onObsStatusChange((status) => {
    mainWindow?.webContents.send('obs-status-update', status);
    // Report the live scene list up so Pulse Engine's own rule editor
    // (PulseActionEditor.tsx's "Switch OBS Scene" action) can offer a real
    // picker instead of a blind free-text field. An empty list is sent on
    // disconnect too, deliberately — a stale scene list is worse than none.
    const apiKey = loadConfig().apiKey;
    if (apiKey) {
      reportObsState(apiKey, status.scenes.map((s) => ({ sceneName: s.sceneName }))).catch(() => {
        // Non-fatal — the website's picker just stays empty/stale a bit
        // longer; nothing here is worth surfacing to the user.
      });
      reportObsSources(apiKey, status.sources).catch(() => {});
    }
  });

  // Meld Studio (2026-10-25) — same reporting shape as the OBS hook right
  // above, so Pulse Engine's own rule editor can offer real scene/layer
  // pickers for Meld too.
  meldClient.onMeldStatusChange((status) => {
    mainWindow?.webContents.send('meld-status-update', status);
    const apiKey = loadConfig().apiKey;
    if (apiKey) {
      reportMeldState(apiKey, status.scenes).catch(() => {});
      reportMeldLayers(apiKey, status.layers).catch(() => {});
    }
  });

  // Auto-update (2026-10-26) — see electron/updater.ts for the full
  // reasoning. Started here (not earlier in whenReady) so it fires after
  // mainWindow exists, since status pushes need somewhere to send to.
  initUpdater(() => mainWindow);
  ipcMain.handle('updater:get-status', () => getUpdaterStatus());
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:install', () => installUpdate());

  // ----- Account / config -----
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('status:get', () => currentStatus);

  // Shared by config:save-api-key AND the two OAuth login handlers below —
  // a real session_token from logging in goes through the IDENTICAL
  // connect path a pasted API key does (same Bearer slot server-side, see
  // oauth-login.ts's own header), so there's no reason for a second copy
  // of this logic.
  async function saveApiKeyAndConnect(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const me = await getMe(apiKey);
      saveConfig({ apiKey });
      remoteConfig = await getJumpscareConfig(apiKey).catch(() => null);
      scenesConfig = await getScenesConfig(apiKey).catch(() => null);
      setStatus({ connected: true, me });
      wsHandle?.close();
      wsHandle = me.kickBroadcasterId ? connectToKickPulse(me.kickBroadcasterId, handleWsMessage) : null;
      twitchIrcHandle?.close();
      twitchIrcHandle = null;
      clearChatFeed();
      if (me.twitchConnected && me.twitchUsername) {
        twitchIrcHandle = connectTwitchIrc(me.twitchUsername, (msg) => {
          const chatMsg = {
            id: msg.id, platform: 'twitch' as const, username: msg.username, content: msg.content,
            color: msg.color, badges: msg.badges, createdAt: msg.createdAt, emotesTag: msg.emotesTag,
          };
          pushChatMessage(chatMsg);
          mainWindow?.webContents.send('chat-feed:message', chatMsg);
        });
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Invalid API key' };
    }
  }

  ipcMain.handle('config:save-api-key', (_e, apiKey: string) => saveApiKeyAndConnect(apiKey));

  // "Login with Kick/Twitch" (2026-10-20) — see electron/oauth-login.ts's
  // own header for the full flow. Each one opens a real login window,
  // and on success hands the resulting session_token to the exact same
  // connect path an API key already uses.
  ipcMain.handle('auth:login-kick', async () => {
    try {
      const sessionToken = await loginWithKick();
      return await saveApiKeyAndConnect(sessionToken);
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Kick login failed' };
    }
  });
  ipcMain.handle('auth:login-twitch', async () => {
    try {
      const sessionToken = await loginWithTwitch();
      return await saveApiKeyAndConnect(sessionToken);
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Twitch login failed' };
    }
  });

  // Custom title bar window controls (2026-10-20) — the main window is now
  // frame: false, so minimize/maximize/close no longer exist natively;
  // TitleBar.tsx's buttons call these over IPC instead.
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => !!mainWindow?.isMaximized());

  // Lets the UI show which build is actually installed (2026-10-27, direct
  // request after a release-pipeline bug briefly left auto-update unable to
  // tell two versions apart) — reads package.json's version via Electron's
  // own app.getVersion(), the same value electron-builder stamps into the
  // installer, so this can never drift from what was actually shipped.
  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('config:disconnect', () => {
    wsHandle?.close();
    wsHandle = null;
    twitchIrcHandle?.close();
    twitchIrcHandle = null;
    clearChatFeed();
    remoteConfig = null;
    scenesConfig = null;
    saveConfig({ apiKey: null });
    setStatus({ connected: false, me: null });
  });

  ipcMain.handle('test-jumpscare', () => fireJumpscare());

  // Plays the first configured Pulse Scene with placeholder tokens — the
  // Scenes equivalent of the jumpscare test hotkey, so a streamer can see
  // what a scene actually looks like on the real overlay without needing a
  // live Pulse Engine trigger to fire one for real. Falls back to the
  // bundled SAMPLE_SCENE (no account/config needed at all) — the button
  // always does SOMETHING.
  ipcMain.handle('scenes:test', () => {
    testSceneNow();
    return { ok: true };
  });

  // ----- Overlay display (2026-10-18) -----
  ipcMain.handle('overlay:list-displays', () => listDisplays());
  ipcMain.handle('overlay:get-current', () => ({
    configuredId: loadConfig().overlayDisplayId,
    current: getCurrentDisplay(),
  }));
  ipcMain.handle('overlay:set-display', (_e, id: number | null) => {
    saveConfig({ overlayDisplayId: id });
    return moveOverlayToDisplay(id);
  });
  ipcMain.handle('overlay:test-highlight', () => {
    flashHighlight();
    return { ok: true };
  });

  // ----- General-purpose local media library -----
  ipcMain.handle('media:add', async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? (undefined as any), {
      properties: ['openFile'],
      filters: [
        { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return addLocalMediaItem(res.filePaths[0]);
  });

  ipcMain.handle('media:list', () => loadConfig().localMediaLibrary);
  ipcMain.handle('media:remove', (_e, id: string) => removeLocalMediaItem(id));
  ipcMain.handle('media:get-server-info', () => mediaServerInfo ?? { port: 0, baseUrl: '' });

  // ----- OBS control -----
  ipcMain.handle('obs:get-status', () => obsClient.getObsStatus());

  ipcMain.handle('obs:connect', async (_e, url: string, password: string) => {
    saveConfig({ obsUrl: url, obsPassword: password });
    try {
      await obsClient.connectObs(url, password);
      return { ok: true };
    } catch (err: any) {
      // code (2026-10-16) — obs-websocket-js throws OBSWebSocketError with a
      // real numeric `code`, straight from the WebSocket close event (or -1
      // for "never got that far" cases like a bad subprotocol). 4009 is
      // obs-websocket's own documented AuthenticationFailed close code — the
      // one error worth telling apart from a generic "couldn't connect" so
      // the renderer can point someone straight at the password field
      // instead of a vague failure. See ObsControlPage.tsx's friendlyObsError.
      return { ok: false, error: err?.message || 'Failed to connect to OBS', code: typeof err?.code === 'number' ? err.code : undefined };
    }
  });

  ipcMain.handle('obs:disconnect', () => obsClient.disconnectObs());

  ipcMain.handle('obs:switch-scene', async (_e, sceneName: string) => {
    try {
      await obsClient.switchScene(sceneName);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to switch scene' };
    }
  });

  ipcMain.handle('obs:get-scene-items', (_e, sceneName: string) => obsClient.getSceneItems(sceneName));

  ipcMain.handle('obs:toggle-source', async (_e, sceneName: string, sceneItemId: number, enabled: boolean) => {
    try {
      await obsClient.setSceneItemEnabled(sceneName, sceneItemId, enabled);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to toggle source' };
    }
  });

  // Stream/record controls (2026-10-15) — each just fires the OBS request;
  // the real resulting streaming/recording state comes back through the
  // normal obs-status-update push (StreamStateChanged/RecordStateChanged),
  // same as every other OBS state change already does.
  ipcMain.handle('obs:start-stream', async () => {
    try { await obsClient.startStream(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to start streaming' }; }
  });
  ipcMain.handle('obs:stop-stream', async () => {
    try { await obsClient.stopStream(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to stop streaming' }; }
  });
  ipcMain.handle('obs:start-record', async () => {
    try { await obsClient.startRecord(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to start recording' }; }
  });
  ipcMain.handle('obs:stop-record', async () => {
    try { await obsClient.stopRecord(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to stop recording' }; }
  });

  // ----- Meld Studio control (2026-10-25) -----
  ipcMain.handle('meld:get-status', () => meldClient.getMeldStatus());

  ipcMain.handle('meld:connect', async (_e, url: string) => {
    saveConfig({ meldUrl: url });
    try {
      await meldClient.connectMeld(url);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || "Couldn't reach Meld Studio" };
    }
  });

  ipcMain.handle('meld:disconnect', () => meldClient.disconnectMeld());

  ipcMain.handle('meld:switch-scene', async (_e, sceneId: string) => {
    try { await meldClient.switchScene(sceneId); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to switch scene' }; }
  });

  ipcMain.handle('meld:toggle-layer', async (_e, sceneId: string, layerId: string) => {
    try { await meldClient.toggleLayer(sceneId, layerId); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to toggle layer' }; }
  });

  ipcMain.handle('meld:set-layer-visible', async (_e, layerId: string, visible: boolean) => {
    try { await meldClient.setLayerVisible(layerId, visible); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to set layer visibility' }; }
  });

  ipcMain.handle('meld:start-stream', async () => {
    try { await meldClient.startStream(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to start streaming' }; }
  });
  ipcMain.handle('meld:stop-stream', async () => {
    try { await meldClient.stopStream(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to stop streaming' }; }
  });
  ipcMain.handle('meld:start-record', async () => {
    try { await meldClient.startRecord(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to start recording' }; }
  });
  ipcMain.handle('meld:stop-record', async () => {
    try { await meldClient.stopRecord(); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to stop recording' }; }
  });

  // ----- Lights -----
  // reportLightDevicesNow — tells the website what lights exist right now,
  // so Pulse Engine's own "Set Light State" action can offer a real device
  // picker (same reasoning/shape as the OBS scene report above). Called
  // after every add/remove/rename, and once at startup below — best-effort,
  // a failure here just means the website's picker stays stale a bit
  // longer, never worth surfacing to the user.
  function reportLightDevicesNow(): void {
    const apiKey = loadConfig().apiKey;
    if (!apiKey) return;
    reportLightDevices(apiKey, lights.listDeviceConfigs().map((d) => ({ id: d.id, name: d.name }))).catch(() => {});
  }

  // reportLightScenesNow/reportLightReactionsNow (2026-10-21) — same
  // reasoning as reportLightDevicesNow right above, for the website's own
  // "Set Light Scene"/"Fire a Light Reaction" action pickers.
  function reportLightScenesNow(): void {
    const apiKey = loadConfig().apiKey;
    if (!apiKey) return;
    reportLightScenes(apiKey, lightScenes.listScenes().map((s) => ({ id: s.id, name: s.name }))).catch(() => {});
  }
  function reportLightReactionsNow(): void {
    const apiKey = loadConfig().apiKey;
    if (!apiKey) return;
    reportLightReactions(apiKey, lightReactions.listReactions().map((r) => ({ id: r.id, name: r.name }))).catch(() => {});
  }

  ipcMain.handle('lights:list-devices', () => lights.listDeviceConfigs());
  ipcMain.handle('lights:list-live-states', () => lights.listLiveStates());
  ipcMain.handle('lights:add-wled', async (_e, ip: string, name?: string) => {
    const res = await lights.addWledDevice(ip, name);
    if (res.ok) reportLightDevicesNow();
    return res;
  });
  // 2026-10-16 — "a nice interface and way to actually search for devices
  // connected to the network." progressEvent lets the renderer show a real
  // "scanned 120/254…" readout instead of a blind spinner for the duration
  // of a sweep (webContents.send, not the handler's own return value, since
  // the scan is one long-running call with incremental progress).
  ipcMain.handle('lights:discover-wled', (e) =>
    lights.discoverWledOnNetwork((scanned, total) => e.sender.send('lights:discover-wled-progress', { scanned, total }))
  );
  ipcMain.handle('lights:discover-govee', () => lights.discoverGoveeOnNetwork());
  ipcMain.handle('lights:add-govee', (_e, ip: string, name: string | undefined, sku: string | undefined) => {
    const res = lights.addGoveeDevice(ip, name, sku);
    if (res.ok) reportLightDevicesNow();
    return res;
  });
  ipcMain.handle('lights:discover-hue-bridges', () => lights.discoverHueBridges());
  ipcMain.handle('lights:pair-hue-bridge', (_e, ip: string) => lights.pairHueBridge(ip));
  ipcMain.handle('lights:list-paired-hue-bridges', () => lights.listPairedHueBridges());
  ipcMain.handle('lights:list-hue-bridge-lights', async (_e, bridgeIp: string) => {
    try { return { ok: true, lights: await lights.listHueBridgeLights(bridgeIp) }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to load lights from that bridge', lights: [] }; }
  });
  ipcMain.handle('lights:add-hue-light', (_e, bridgeIp: string, hueLightId: string, name: string) => {
    try {
      const device = lights.addHueLightDevice(bridgeIp, hueLightId, name);
      reportLightDevicesNow();
      return { ok: true, device };
    } catch (err: any) { return { ok: false, error: err?.message || 'Failed to add that light' }; }
  });
  ipcMain.handle('lights:remove-device', (_e, id: string) => { lights.removeDevice(id); reportLightDevicesNow(); });
  ipcMain.handle('lights:rename-device', (_e, id: string, name: string) => { lights.renameDevice(id, name); reportLightDevicesNow(); });
  ipcMain.handle('lights:set-state', async (_e, target: string, patch: { on?: boolean; brightness?: number; color?: string }) => {
    try { await lights.setDeviceState(target, patch); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Failed to update light' }; }
  });

  // ----- Light Scenes (2026-10-18) — see electron/light-scenes.ts -----
  ipcMain.handle('lights:list-scenes', () => lightScenes.listScenes());
  ipcMain.handle('lights:get-active-scene-id', () => lightScenes.getActiveSceneId());
  ipcMain.handle('lights:save-scene', (_e, scene) => { const s = lightScenes.saveScene(scene); reportLightScenesNow(); return s; });
  ipcMain.handle('lights:delete-scene', (_e, id: string) => { lightScenes.deleteScene(id); reportLightScenesNow(); });
  ipcMain.handle('lights:set-active-scene', (_e, id: string) => lightScenes.setActiveScene(id));

  // ----- Light Reactions (2026-10-18) — see electron/light-reactions.ts -----
  ipcMain.handle('lights:list-reactions', () => lightReactions.listReactions());
  ipcMain.handle('lights:save-reaction', (_e, reaction) => { const r = lightReactions.saveReaction(reaction); reportLightReactionsNow(); return r; });
  ipcMain.handle('lights:delete-reaction', (_e, id: string) => { lightReactions.deleteReaction(id); reportLightReactionsNow(); });
  ipcMain.handle('lights:fire-reaction', (_e, id: string) => lightReactions.fireReaction(id));
  ipcMain.handle('lights:stop-reaction', (_e, id: string) => lightReactions.stopReaction(id));
  ipcMain.handle('lights:list-running-reactions', () => lightReactions.listRunningReactionIds());

  // ----- Voice Commands -----
  // See electron/voice-window.ts (the hidden listener window lifecycle,
  // mic capture only) and electron/voiceCommands.ts (the real Vosk
  // recognition engine, which runs in THIS process). The window is only
  // ever created while enabled=true — turning this off fully tears it down,
  // not just pausing it.
  registerVoiceIpc();
  ipcMain.handle('voice:get-settings', () => {
    const cfg = loadConfig();
    return {
      enabled: cfg.voiceEnabled, inputDeviceId: cfg.voiceInputDeviceId,
      modelSize: cfg.voiceModelSize, strictVocabulary: cfg.voiceStrictVocabulary,
      recognitionWords: cfg.voiceRecognitionWords, liveCaptionsEnabled: cfg.voiceLiveCaptionsEnabled,
    };
  });
  ipcMain.handle('voice:set-enabled', (_e, enabled: boolean) => setVoiceEnabled(enabled));
  ipcMain.handle('voice:set-input-device', (_e, deviceId: string | null) => {
    saveConfig({ voiceInputDeviceId: deviceId });
    if (isVoiceListening()) setVoiceInputDevice(deviceId);
    return { ok: true };
  });
  ipcMain.handle('voice:set-model-size', (_e, size: VoiceModelSize) => {
    saveConfig({ voiceModelSize: size });
    invalidateRecognizer();
    return { ok: true };
  });
  ipcMain.handle('voice:set-strict-vocabulary', (_e, strict: boolean) => {
    saveConfig({ voiceStrictVocabulary: strict });
    invalidateRecognizer();
    return { ok: true };
  });
  ipcMain.handle('voice:set-recognition-words', (_e, words: string[]) => {
    saveConfig({ voiceRecognitionWords: words });
    invalidateRecognizer();
    return { ok: true };
  });
  ipcMain.handle('voice:set-live-captions-enabled', (_e, enabled: boolean) => {
    saveConfig({ voiceLiveCaptionsEnabled: enabled });
    return { ok: true };
  });
  ipcMain.handle('voice:is-model-ready', (_e, size: VoiceModelSize) => isModelReady(size));
  ipcMain.handle('voice:download-model', async (e, size: VoiceModelSize) => {
    try {
      await ensureModelDownloaded(size, (pct) => e.sender.send('voice:download-progress', pct));
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle('voice:get-heard-log', () => getHeardLog());
  ipcMain.handle('voice:get-live-partial', () => getLivePartialText());
  ipcMain.handle('voice:get-phrases', () => getCachedPhrases());

  // ----- Pulse Engine -----
  // Thin passthroughs to electron/api.ts — see that file's own comment on
  // why rule CRUD (unlike every widget config) has to go through the
  // website's API rather than straight to Supabase. Each handler resolves
  // the current apiKey itself (not captured once at startup) so this still
  // works correctly if someone reconnects with a different account without
  // restarting the app.
  function requireApiKey(): string {
    const key = loadConfig().apiKey;
    if (!key) throw new Error('Not connected — add your API key on the Home tab first');
    return key;
  }
  ipcMain.handle('pulse:list', () => listPulseRules(requireApiKey()));
  ipcMain.handle('pulse:create', (_e, body) => createPulseRule(requireApiKey(), body));
  ipcMain.handle('pulse:update', (_e, id: string, body) => updatePulseRule(requireApiKey(), id, body));
  ipcMain.handle('pulse:delete', (_e, id: string) => deletePulseRule(requireApiKey(), id));

  ipcMain.handle('pulse:jobs-list', () => listPulseJobs(requireApiKey()));
  ipcMain.handle('pulse:jobs-skip', (_e, id: string) => skipPulseJob(requireApiKey(), id));
  ipcMain.handle('pulse:jobs-cancel', (_e, id: string) => cancelPulseJob(requireApiKey(), id));

  // Trigger/action picker lookups — see electron/api.ts's own comment.
  ipcMain.handle('pulse:kick-rewards', () => getKickRewards(requireApiKey()));
  ipcMain.handle('pulse:twitch-rewards', () => getTwitchRewards(requireApiKey()));
  ipcMain.handle('pulse:points-rewards', () => getPointsRewards(requireApiKey()));
  ipcMain.handle('pulse:counters', () => getCounters(requireApiKey()));
  ipcMain.handle('pulse:tts-voices', () => getTtsVoices(requireApiKey()));
  ipcMain.handle('pulse:search-categories', (_e, platform: 'kick' | 'twitch', query: string) => searchStreamCategories(requireApiKey(), platform, query));
  ipcMain.handle('pulse:run-action', (_e, action: Record<string, unknown>) => runPulseAction(requireApiKey(), action));

  // Stream Info Presets (2026-10-28) — real server-backed presets, see
  // electron/api.ts's own header for why this replaced the old
  // localStorage-only, one-platform-per-preset version.
  ipcMain.handle('stream-info:list-presets', () => listStreamInfoPresets(requireApiKey()));
  ipcMain.handle('stream-info:create-preset', (_e, body) => createStreamInfoPreset(requireApiKey(), body));
  ipcMain.handle('stream-info:delete-preset', (_e, id: string) => deleteStreamInfoPreset(requireApiKey(), id));
  ipcMain.handle('stream-info:apply-preset', (_e, id: string) => applyStreamInfoPreset(requireApiKey(), id));

  // ----- Chat Bot (2026-10-18, native rebuild) -----
  ipcMain.handle('chatbot:commands-list', () => listCommands(requireApiKey()));
  ipcMain.handle('chatbot:commands-create', (_e, body) => createCommand(requireApiKey(), body));
  ipcMain.handle('chatbot:commands-update', (_e, id: string, body) => updateCommand(requireApiKey(), id, body));
  ipcMain.handle('chatbot:commands-delete', (_e, id: string) => deleteCommand(requireApiKey(), id));
  ipcMain.handle('chatbot:commands-test-send', (_e, body) => testSendCommand(requireApiKey(), body));

  ipcMain.handle('chatbot:counters-list', () => listCountersFull(requireApiKey()));
  ipcMain.handle('chatbot:counters-create', (_e, name: string, value?: number) => createCounter(requireApiKey(), name, value));
  ipcMain.handle('chatbot:counters-adjust', (_e, name: string, patch) => adjustCounter(requireApiKey(), name, patch));
  ipcMain.handle('chatbot:counters-delete', (_e, name: string) => deleteCounter(requireApiKey(), name));

  ipcMain.handle('chatbot:spam-filter-get', () => getSpamFilter(requireApiKey()));
  ipcMain.handle('chatbot:spam-filter-save', (_e, enabled: boolean, config) => saveSpamFilter(requireApiKey(), enabled, config));
  ipcMain.handle('chatbot:settings-get', () => getChatbotSettings(requireApiKey()));
  ipcMain.handle('chatbot:settings-save', (_e, body) => saveChatbotSettings(requireApiKey(), body));

  // ----- Chat Alerts (2026-10-18, native rebuild) -----
  ipcMain.handle('chat-alerts:test-send', (_e, body) => testSendChatAlert(requireApiKey(), body));
  ipcMain.handle('chat-alerts:test-send-level-up', () => testSendLevelUp(requireApiKey()));

  // ----- Moderation (2026-10-18, native rebuild) -----
  ipcMain.handle('moderation:pending', () => getModerationPending(requireApiKey()));
  ipcMain.handle('moderation:resolve-song-request', (_e, id: string, status) => resolveSongRequest(requireApiKey(), id, status));
  ipcMain.handle('moderation:resolve-redemption', (_e, id: string, status) => resolveRedemption(requireApiKey(), id, status));
  ipcMain.handle('moderation:approve-donation', (_e, id: string) => approveDonation(requireApiKey(), id));
  ipcMain.handle('moderation:dismiss-donation', (_e, id: string) => dismissDonation(requireApiKey(), id));
  ipcMain.handle('moderation:action', (_e, kind, body) => moderationAction(requireApiKey(), kind, body));
  ipcMain.handle('moderation:get-chat-settings', () => getChatSettings(requireApiKey()));
  ipcMain.handle('moderation:set-chat-mode', (_e, body) => setChatMode(requireApiKey(), body));

  // Live Chat & Event Feed (2026-10-19) — get-recent answers the page's own
  // mount-time fetch (so opening the page late still shows recent history,
  // not just whatever arrives from that point on); live updates arrive via
  // the 'chat-feed:message'/'chat-feed:event' events pushed from
  // handleWsMessage/connectAccount above. get-viewer-info is the Community
  // Bans threat-level + Viewer Flags lookup, batched per currently-visible
  // chatter (see kickpulse-new's routes/desktop.js's own /viewer-info).
  ipcMain.handle('chat-feed:get-recent', () => ({ chat: getRecentChat(), events: getRecentEvents() }));
  ipcMain.handle('chat-feed:get-viewer-info', (_e, usernames: string[], platform: 'kick' | 'twitch') =>
    getViewerInfo(requireApiKey(), usernames, platform));
  ipcMain.handle('chat-feed:get-threat-settings', () => getCommunityBanSettings(requireApiKey()));

  // Community Bans (2026-10-20, native desktop page).
  ipcMain.handle('community-bans:list', () => getCommunityBanList(requireApiKey()));
  ipcMain.handle('community-bans:apply', (_e, opts) => applyCommunityBans(requireApiKey(), opts));
  ipcMain.handle('community-bans:unban', (_e, entryId: string) => unbanCommunityBanEntry(requireApiKey(), entryId));
  ipcMain.handle('community-bans:unban-all', () => unbanAllCommunityBans(requireApiKey()));
  ipcMain.handle('community-bans:get-settings', () => getCommunityBanSettings(requireApiKey()));
  ipcMain.handle('community-bans:set-settings', (_e, patch: { minThreatLevelToWarn?: number; applyMinDistinctBans?: number }) => setCommunityBanSettings(requireApiKey(), patch));
  ipcMain.handle('community-bans:get-flags', () => getViewerFlags(requireApiKey()));
  ipcMain.handle('community-bans:add-flag', (_e, body) => addViewerFlag(requireApiKey(), body));
  ipcMain.handle('community-bans:remove-flag', (_e, id: string) => removeViewerFlag(requireApiKey(), id));
  ipcMain.handle('community-bans:get-squads', () => getBanSquads(requireApiKey()));
  ipcMain.handle('community-bans:create-squad', (_e, name: string) => createBanSquad(requireApiKey(), name));
  ipcMain.handle('community-bans:join-squad', (_e, code: string) => joinBanSquad(requireApiKey(), code));
  ipcMain.handle('community-bans:leave-squad', (_e, squadId: string) => leaveBanSquad(requireApiKey(), squadId));

  // ----- Connections (2026-10-22, native rebuild — direct feedback: "I want
  // the settings and connections page on the desktop app to be actually on
  // the app. Not loading the site.") -----
  // Linking a platform/connecting a custom bot changes what getMe() returns
  // (kickConnected/twitchConnected, Kick WS hookup, Twitch IRC join) — reuse
  // saveApiKeyAndConnect's own refresh/reconnect logic afterward rather than
  // just patching currentStatus by hand, so a first-time Kick link (e.g. a
  // Twitch-only connection adding Kick) actually starts that connection
  // immediately instead of needing an app restart.
  ipcMain.handle('connections:link-kick', async () => {
    try {
      const me = currentStatus.me;
      if (!me) throw new Error('Not connected yet');
      await linkKick(me.userId);
      await saveApiKeyAndConnect(requireApiKey());
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to connect Kick' };
    }
  });
  ipcMain.handle('connections:link-twitch', async () => {
    try {
      const me = currentStatus.me;
      if (!me) throw new Error('Not connected yet');
      await linkTwitch(me.userId);
      await saveApiKeyAndConnect(requireApiKey());
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to connect Twitch' };
    }
  });
  ipcMain.handle('connections:disconnect-twitch', async () => {
    await disconnectTwitchPlatform(requireApiKey());
    await saveApiKeyAndConnect(requireApiKey());
    return { ok: true };
  });

  ipcMain.handle('connections:youtube-status', () => getYoutubeStatus(requireApiKey()));
  ipcMain.handle('connections:youtube-connect', (_e, handle: string) => connectYoutube(requireApiKey(), handle));
  ipcMain.handle('connections:youtube-connect-secondary', (_e, handle: string) => connectYoutubeSecondary(requireApiKey(), handle));
  ipcMain.handle('connections:youtube-disconnect', () => disconnectYoutube(requireApiKey()));
  ipcMain.handle('connections:youtube-disconnect-secondary', () => disconnectYoutubeSecondary(requireApiKey()));

  ipcMain.handle('connections:tiktok-status', () => getTiktokStatus(requireApiKey()));
  ipcMain.handle('connections:tiktok-connect', (_e, username: string) => connectTiktok(requireApiKey(), username));
  ipcMain.handle('connections:tiktok-disconnect', () => disconnectTiktok(requireApiKey()));

  ipcMain.handle('connections:bot-status', () => getBotIdentityStatus(requireApiKey()));
  ipcMain.handle('connections:bot-connect', async (_e, platform: 'kick' | 'twitch') => {
    try {
      const apiKey = requireApiKey();
      if (platform === 'kick') await connectCustomBotKick(apiKey);
      else await connectCustomBotTwitch(apiKey);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to connect bot account' };
    }
  });
  ipcMain.handle('connections:bot-disconnect', (_e, platform: 'kick' | 'twitch') => disconnectBotIdentity(requireApiKey(), platform));

  ipcMain.handle('connections:subscription-status', () => {
    const me = currentStatus.me;
    if (!me) return { kick: false, twitch: false };
    return getSubscriptionStatus(me.userId);
  });
  ipcMain.handle('connections:subscribe-events', (_e, platform: 'kick' | 'twitch') => {
    const me = currentStatus.me;
    if (!me) throw new Error('Not connected yet');
    return subscribeEvents(me.userId, platform);
  });

  // ----- Settings (2026-10-22, native rebuild) -----
  ipcMain.handle('settings:discord-get', () => getDiscordSettings(requireApiKey()));
  ipcMain.handle('settings:discord-save', (_e, body: { webhookUrl: string; enabled: boolean }) => saveDiscordSettings(requireApiKey(), body));
  ipcMain.handle('settings:discord-test', (_e, webhookUrl: string) => testDiscordWebhook(requireApiKey(), webhookUrl));
  ipcMain.handle('settings:delete-account', async () => {
    const result = await deleteAccount(requireApiKey());
    if (result.ok) {
      // Same teardown as config:disconnect above — the account no longer
      // exists at all now, so there's nothing left to stay connected to.
      wsHandle?.close(); wsHandle = null;
      twitchIrcHandle?.close(); twitchIrcHandle = null;
      clearChatFeed();
      remoteConfig = null;
      scenesConfig = null;
      saveConfig({ apiKey: null });
      setStatus({ connected: false, me: null });
    }
    return result;
  });

  // Public, no apiKey needed — but still routed through main (not a plain
  // renderer fetch) so it goes through the same configurable
  // KICKPULSE_API_BASE every other call here respects.
  ipcMain.handle('chat-feed:get-kick-subscriber-badges', (_e, slug: string) => getKickSubscriberBadges(slug));

  ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url));

  // Webview guest preload (2026-10-18) — see electron/webview-preload.ts's
  // own header. Compiles alongside main.ts/preload.ts to the same output
  // dir, so this is just that same dir with a different filename.
  ipcMain.handle('get-webview-preload-url', () => toFileUrl(path.join(__dirname, 'webview-preload.js')));

  // browse-local-file (2026-10-18) — the HOST half of webview-preload.ts's
  // round trip: a page embedded in a <webview> (website content, via
  // ipcRenderer.sendToHost) asks the REAL renderer process (which owns this
  // app's native file dialog and local media server) to pick a file, and
  // the result is sent back into that same guest page. Each embed page's
  // own <webview> wires this up — see src/lib/webviewBridge.ts.
  ipcMain.handle('browse-local-file-for-webview', async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? (undefined as any), {
      properties: ['openFile'],
      filters: [
        { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const item = addLocalMediaItem(res.filePaths[0]);
    if (!mediaServerInfo) return null;
    return `${mediaServerInfo.baseUrl}/media/${item.id}`;
  });

  const existing = loadConfig();
  if (existing.apiKey) connectAccount(existing.apiKey);
  if (existing.obsUrl) {
    obsClient.connectObs(existing.obsUrl, existing.obsPassword).catch(() => {
      // OBS likely just isn't running yet — surfaced as a disconnected
      // status on the OBS Control page, not a startup failure.
    });
  }
  if (existing.meldUrl) {
    meldClient.connectMeld(existing.meldUrl).catch(() => {
      // Same reasoning as the OBS auto-reconnect above — Meld likely just
      // isn't running yet.
    });
  }
  // Report whatever lights are already configured so Pulse Engine's device
  // picker is populated immediately on launch, not just after the next add/
  // remove/rename (same reasoning as the OBS scene report on connect above).
  reportLightDevicesNow();
  reportLightScenesNow();
  reportLightReactionsNow();
  // Re-report periodically too, not just on boot/mutation — the website's
  // own cache of this (lib/lightDevices.js etc.) deliberately goes stale
  // after 10 minutes with no report (quitting the app should make its
  // pickers go empty, not keep showing devices/scenes/reactions that may no
  // longer be real), but that same timeout was making a long-running,
  // completely idle app look just as stale — found 2026-10-21 checking why
  // the website "doesn't recognize" scenes/reactions that had genuinely been
  // reported hours earlier. Comfortably under the 10-minute expiry so an
  // open app never goes quiet long enough to trip it.
  setInterval(() => {
    reportLightDevicesNow();
    reportLightScenesNow();
    reportLightReactionsNow();
    reportVoiceEnabledNow();
  }, 4 * 60 * 1000);
  // Apply whichever Light Scene is the current baseline the moment the app
  // opens — "They should be able to set a default for their lights that
  // gets sent out when the app opens" (direct request). A no-op if nothing's
  // been set as active yet.
  lightScenes.applyActiveScene().catch(() => {});
  // Voice Commands — resume listening if it was already turned on last
  // session (persisted in config.json, same as every other on/off setting
  // this app remembers across restarts).
  if (loadConfig().voiceEnabled && isModelReady(loadConfig().voiceModelSize)) {
    startVoiceListening(loadConfig().voiceInputDeviceId);
  }
  reportVoiceEnabledNow();
});

app.on('window-all-closed', () => {
  // Real "stay running in the tray even with the main window closed"
  // background mode is a near-term follow-up — see the project README's
  // Next list — not needed to verify today's core mechanism.
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  wsHandle?.close();
  obsClient.disconnectObs().catch(() => {});
  meldClient.disconnectMeld().catch(() => {});
});
