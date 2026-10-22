// electron/light-scenes.ts — the steady-state "mood" a streamer's lights
// sit at. See electron/types.ts's own LightScene comment for why Scenes and
// Reactions (electron/light-reactions.ts) are split into two real lifecycles
// instead of one "loop or don't" flag: a Scene is the baseline that gets
// applied once on launch and RESTORED automatically whenever a Reaction
// finishes — Reactions are the only thing that ever interrupts it.
import { loadConfig, saveConfig } from './store';
import * as lights from './lights-manager';
import type { LightScene } from './types';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listScenes(): LightScene[] {
  return loadConfig().lightScenes;
}

export function getActiveSceneId(): string | null {
  return loadConfig().activeLightSceneId;
}

export function saveScene(scene: Partial<LightScene> & { name: string; targets: LightScene['targets'] }): LightScene {
  const cfg = loadConfig();
  if (scene.id) {
    const id = scene.id;
    const next = cfg.lightScenes.map((s) => (s.id === id ? ({ ...s, ...scene, id } as LightScene) : s));
    saveConfig({ lightScenes: next });
    // Editing the scene you're currently sitting in should actually change
    // what's lit right now, not just what gets restored next time.
    if (cfg.activeLightSceneId === id) applyScene(id);
    return next.find((s) => s.id === id)!;
  }
  const created: LightScene = { id: uid(), name: scene.name, targets: scene.targets };
  saveConfig({ lightScenes: [...cfg.lightScenes, created] });
  return created;
}

export function deleteScene(id: string): void {
  const cfg = loadConfig();
  saveConfig({ lightScenes: cfg.lightScenes.filter((s) => s.id !== id) });
  if (cfg.activeLightSceneId === id) saveConfig({ activeLightSceneId: null });
}

/** Applies a scene's targets to the real devices WITHOUT changing which
 *  scene is persisted as active — used internally (restoring after a
 *  Reaction ends) and by setActiveScene below (which does both). */
export async function applyScene(id: string): Promise<{ ok: boolean; error?: string }> {
  const scene = listScenes().find((s) => s.id === id);
  if (!scene) return { ok: false, error: 'Scene not found' };
  await Promise.all(
    Object.entries(scene.targets).map(([target, t]) =>
      lights
        .setDeviceState(target, { on: t.on, brightness: t.brightness, color: t.color, transitionMs: t.transitionMs })
        .catch((err) => console.error(`[light-scenes] apply failed for target ${target}`, err?.message || err))
    )
  );
  return { ok: true };
}

/** Makes `id` the new baseline AND applies it immediately. */
export async function setActiveScene(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = await applyScene(id);
  if (result.ok) saveConfig({ activeLightSceneId: id });
  return result;
}

/** Re-applies whichever scene is currently active — called once at app
 *  launch (main.ts) and after any Reaction finishes (light-reactions.ts).
 *  A no-op if nothing's been set active yet (nothing to return to). */
export async function applyActiveScene(): Promise<void> {
  const id = getActiveSceneId();
  if (id) await applyScene(id);
}
