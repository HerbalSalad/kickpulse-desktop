// src/pages/ScenesPage.tsx — Scenes, an embedded view of the real website's
// own editor (/scenes/edit) — same pattern as Overlay Studio/Alert Studio/
// Pulse Engine (see those pages' own file headers).
//
// 2026-10-18 — direct feedback: the native SceneEditor.tsx port (shared with
// Alert Studio's own pre-webview version) never got all the way to parity
// with the much more actively maintained website editor. Same pivot already
// applied to Overlay Studio/Alert Studio/Pulse Engine: this now embeds the
// real editor directly. Unlike those three, Scenes has no "which config"
// list at all at the ROW level — scenes_configs is one row per user holding
// every one of a streamer's named Scenes inside `config.scenes[]`.
//
// Browse grid (2026-10-22, direct feedback: "still also not seeing the
// preview panels for overlay studio, alert studio, widget studio, and
// scenes in the desktop app... I dont care for the small config buttons up
// top and would rather the new layout button be up top with panels below
// for each config that gives us a small preview of it"). Mirrors the
// website's own ScenesList.tsx exactly: one card per NAMED SCENE inside the
// single row (not one per row, since there's only one) — each card's
// preview is that scene's own already-captured `thumbnailUrl` (real
// html-to-image screenshot, captured by the editor at save time for
// whichever scene was active — same field ScenesList.tsx's own SceneTile
// already reads). Reuses the shared ConfigGrid/ConfigCard component, same
// as Overlay Studio/Alert Studio/Widget Studio.
import { useEffect, useState } from 'react';
import { Clapperboard, ArrowLeft, ExternalLink } from 'lucide-react';
import { Page, Section, Button, EmptyState, COLORS } from '../components/ui';
import { ConfigGrid, type ConfigCardItem } from '../components/ConfigGrid';
import { supabase } from '../lib/supabase';
import { desktopSessionFragment } from '../lib/webviewSession';
import { useWebviewPreloadUrl, useWebviewLocalFileBridge } from '../lib/webviewBridge';
import { newPulseScene, type PulseScene } from '../lib/sceneTypes';

const WEBSITE = 'https://www.kickpulsebot.com';

export default function ScenesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<PulseScene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const preloadUrl = useWebviewPreloadUrl();
  const webviewRef = useWebviewLocalFileBridge();

  const refreshScenes = async (uid: string) => {
    const { data } = await supabase.from('scenes_configs').select('id, config').eq('user_id', uid).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (data) {
      setConfigId((data as any).id);
      setScenes(((data as any).config?.scenes as PulseScene[]) ?? []);
    } else {
      setConfigId(null);
      setScenes([]);
    }
  };

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then(async (status) => {
      const uid = status.me?.userId ?? null;
      setUserId(uid);
      if (uid) await refreshScenes(uid);
      setLoading(false);
    });
  }, []);

  // Read-modify-write the one row's `scenes` array — there's no independent
  // row per scene to address directly.
  const persistScenes = async (nextScenes: PulseScene[]) => {
    if (!userId) return false;
    if (configId) {
      const { error } = await supabase.from('scenes_configs').update({ config: { scenes: nextScenes } }).eq('id', configId).eq('user_id', userId);
      if (error) return false;
    } else {
      const { data, error } = await supabase.from('scenes_configs').insert({ user_id: userId, config: { scenes: nextScenes } }).select('id').single();
      if (error) return false;
      setConfigId((data as any).id);
    }
    setScenes(nextScenes);
    return true;
  };

  // Same "keep at least one scene" floor the website's own list page
  // enforces — the editor's own default-scene bootstrap would otherwise
  // silently hand back a synthesized scene next load, disagreeing with
  // what was actually just deleted here.
  const deleteScene = async (id: string) => {
    if (scenes.length <= 1) return;
    await persistScenes(scenes.filter((s) => s.id !== id));
    if (activeSceneId === id) setActiveSceneId(null);
  };

  const createScene = async () => {
    // No row at all yet — hand off to the editor's own existing
    // default-scene bootstrap instead of duplicating that logic here.
    if (!configId) { setActiveSceneId('new'); return; }
    const scene = newPulseScene(`Scene ${scenes.length + 1}`);
    const ok = await persistScenes([...scenes, scene]);
    if (ok) setActiveSceneId(scene.id);
  };

  if (loading) return null;

  const editorPath = activeSceneId && activeSceneId !== 'new' ? `/scenes/edit?scene=${activeSceneId}` : '/scenes/edit';
  const embedSrc = userId ? `${WEBSITE}${editorPath}${desktopSessionFragment(userId)}` : '';
  const plainUrl = `${WEBSITE}${editorPath}`;

  const backToGrid = () => { setActiveSceneId(null); if (userId) refreshScenes(userId); };

  const items: ConfigCardItem[] = scenes.map((s) => ({ id: s.id, name: s.name || 'Untitled Scene', thumbnail: (s as any).thumbnailUrl ?? null }));

  return (
    <Page
      title="Scenes"
      icon={<Clapperboard size={22} color={COLORS.accent} />}
      subtitle="The text/media/light/shape/fill/counter/container composer — fired by a Pulse Engine “Trigger Scene” action, among other triggers. This is the real website editor, embedded — anything saved here plays back exactly as if you'd edited it on the site."
      fullBleed
      actions={
        activeSceneId ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={backToGrid}><ArrowLeft size={14} />Back to all</Button>
            <Button onClick={() => window.kickpulseDesktop.openExternal(plainUrl)}><ExternalLink size={14} />Open in browser</Button>
          </div>
        ) : undefined
      }
    >
      {!userId ? (
        <EmptyState title="Connect your account first" body="Scenes needs your KickPulse account connected (Settings → API key)." />
      ) : !activeSceneId ? (
        <ConfigGrid
          items={items}
          onOpen={setActiveSceneId}
          onDelete={deleteScene}
          onCreate={createScene}
          createLabel="New Scene"
          emptyTitle="No scenes yet"
          emptyBody="Create one to build a freely-positioned text/media/light/shape/fill/counter scene, fired by Pulse Engine or a widget's own trigger."
        />
      ) : (
        <Section style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 500, marginBottom: 0 }}>
          <webview ref={webviewRef} src={embedSrc} preload={preloadUrl ?? undefined} style={{ width: '100%', height: '100%', display: 'flex' }} partition="persist:kickpulse-webembed" />
        </Section>
      )}
    </Page>
  );
}
