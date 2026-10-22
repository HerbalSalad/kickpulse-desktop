// electron/light-reactions.ts — timed, event-triggered temporary lighting
// effects (replaces the original single "Light Presets" concept — see
// electron/types.ts's own LightReaction/LightScene comment for why these
// got split into two real lifecycles). A Reaction plays through its steps
// (once, or looping until stopped) and then hands control back to whichever
// Light Scene is currently active (electron/light-scenes.ts) — "it can have
// a reaction, and then return to the same mood that it was afterwards" was
// the direct ask that drove this split.
import { loadConfig, saveConfig } from './store';
import * as lights from './lights-manager';
import * as lightScenes from './light-scenes';
import { getOverlayWindow } from './overlay-window';
import type { LightReaction } from './types';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Reads a reaction as saved on disk BEFORE playMode existed (plain
// `loop: boolean`, no `playMode`/`durationSeconds` at all) and fills in the
// equivalent current shape — see types.ts's own LightReaction comment. Pure
// read-time normalization, not a destructive rewrite: an old reaction keeps
// playing exactly as it always did (once/loop) until its own next explicit
// save, at which point the editor writes the new shape back out itself.
function normalizeReaction(r: LightReaction & { loop?: boolean }): LightReaction {
  if (r.playMode) return r;
  return { ...r, playMode: r.loop ? 'loop' : 'once' };
}

export function listReactions(): LightReaction[] {
  return loadConfig().lightReactions.map(normalizeReaction);
}

export function saveReaction(reaction: Partial<LightReaction> & { name: string; playMode: LightReaction['playMode']; steps: LightReaction['steps'] }): LightReaction {
  const cfg = loadConfig();
  if (reaction.id) {
    const id = reaction.id;
    const next = cfg.lightReactions.map((r) => (r.id === id ? ({ ...normalizeReaction(r), ...reaction, id } as LightReaction) : r));
    saveConfig({ lightReactions: next });
    return next.find((r) => r.id === id)!;
  }
  const created: LightReaction = {
    id: uid(), name: reaction.name, playMode: reaction.playMode, durationSeconds: reaction.durationSeconds, steps: reaction.steps,
    soundUrl: reaction.soundUrl, soundVolume: reaction.soundVolume,
  };
  saveConfig({ lightReactions: [...cfg.lightReactions, created] });
  return created;
}

export function deleteReaction(id: string): void {
  stopReaction(id);
  saveConfig({ lightReactions: loadConfig().lightReactions.filter((r) => r.id !== id) });
}

// ── Playback ────────────────────────────────────────────────────────────
// `timer` (2026-10-18) — only set for playMode 'timed': fires handle.stopped
// after durationSeconds, which the playback loop below already checks at
// the same points an explicit Stop does (so a timed reaction auto-ends with
// identical granularity/latency to clicking Stop by hand — at most one
// step's own duration late, never mid-step).
interface PlaybackHandle { stopped: boolean; timer?: ReturnType<typeof setTimeout> }
const running = new Map<string, PlaybackHandle>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHexColor(): string {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

async function applyStep(step: LightReaction['steps'][number]): Promise<void> {
  await Promise.all(
    Object.entries(step.targets).map(([target, t]) =>
      lights
        .setDeviceState(target, { on: t.on, brightness: t.brightness, color: t.random ? randomHexColor() : t.color, transitionMs: t.transitionMs })
        .catch((err) => console.error(`[light-reactions] step failed for target ${target}`, err?.message || err))
    )
  );
}

export function listRunningReactionIds(): string[] {
  return [...running.keys()];
}

/** Stops a running Reaction AND restores whichever Light Scene is currently
 *  active — "return to the same mood it was" applies whether the Reaction
 *  finished on its own or was interrupted. A no-op (no Scene call) if
 *  nothing's active. */
export function stopReaction(id: string): void {
  const handle = running.get(id);
  if (handle) {
    handle.stopped = true;
    if (handle.timer) clearTimeout(handle.timer);
  }
  running.delete(id);
  lightScenes.applyActiveScene().catch(() => {});
}

export function firePreset(id: string): { ok: boolean; error?: string } {
  return fireReaction(id);
}

export function fireReaction(id: string): { ok: boolean; error?: string } {
  const reaction = listReactions().find((r) => r.id === id);
  if (!reaction) return { ok: false, error: 'Reaction not found' };
  if (!reaction.steps.length) return { ok: false, error: 'This reaction has no steps' };

  // Stop (and restore-scene) any instance of THIS reaction already running
  // before starting fresh — but skip the scene restore for that stop, since
  // we're about to immediately override it anyway; only the FINAL stop
  // (natural end or explicit Stop) should restore the scene.
  const already = running.get(id);
  if (already) {
    already.stopped = true;
    if (already.timer) clearTimeout(already.timer);
    running.delete(id);
  }

  const handle: PlaybackHandle = { stopped: false };
  running.set(id, handle);

  // 'timed' — auto-stop after durationSeconds, same as an explicit Stop
  // (restores the active Scene via the natural-end branch below, since
  // setting handle.stopped just makes the loop below end on its own).
  if (reaction.playMode === 'timed') {
    const ms = Math.max(1, reaction.durationSeconds || 10) * 1000;
    handle.timer = setTimeout(() => { handle.stopped = true; }, ms);
  }

  if (reaction.soundUrl) {
    getOverlayWindow()?.webContents.send('play-preset-sound', { url: reaction.soundUrl, volume: (reaction.soundVolume ?? 100) / 100 });
  }

  const cycles = reaction.playMode === 'loop' || reaction.playMode === 'timed';

  (async () => {
    do {
      for (const step of reaction.steps) {
        if (handle.stopped) break;
        await applyStep(step);
        if (reaction.steps.length > 1 && !handle.stopped) {
          await sleep(Math.max(50, step.durationMs || 500));
        }
      }
    } while (cycles && !handle.stopped);
    // Natural end (ran out of steps, 'once' never cycles, or 'timed' just
    // hit its own stopped flag) — restore the active Scene exactly like an
    // explicit stop does. Only the instance that's STILL the current one
    // for this id does this (an already-superseded run, stopped by a newer
    // fireReaction() call above, must not clobber whatever the newer run is
    // doing).
    if (running.get(id) === handle) {
      if (handle.timer) clearTimeout(handle.timer);
      running.delete(id);
      lightScenes.applyActiveScene().catch(() => {});
    }
  })();

  return { ok: true };
}
