// src/pages/AlertStudioPage.tsx — Alert Studio, now an embedded view of the
// real website's own editor (/alert-studio/edit) rather than a second,
// independently-maintained native re-implementation.
//
// 2026-10-16 — the native engine (SceneEditor.tsx's shared editor, reused
// from the Scenes page) worked, but per direct feedback ("almost seems like
// it wants to work but there are just some things that are off and not
// proper") never got all the way to parity with the real site's own much
// larger, more actively maintained editor (per-platform variants, amount
// tiers, every background/animation option, etc.). Rather than keep
// chasing drift piece by piece across a second implementation, this now
// embeds the real editor directly: the config edited here IS the exact
// same alert_studio_configs row the website's own /widgets/alert-studio OBS
// source reads, so there is no second schema left to drift out of sync
// with. This page's own job shrinks to just "which config do you want
// open" — the same direct alert_studio_configs query as before (the table
// is already anon-open) — and the actual editing surface is the <webview>.
//
// Browse grid (2026-10-22, same ConfigGrid redesign as Overlay Studio/
// Widget Studio — see that page's own header comment) — each card's
// preview is the row's own already-captured `thumbnail` column, same real
// screenshot AlertStudioList.tsx (the website's own list page) already
// shows.
import { useEffect, useState } from 'react';
import { Sparkles, ArrowLeft, ExternalLink } from 'lucide-react';
import { Page, Section, Button, EmptyState, COLORS } from '../components/ui';
import { ConfigGrid, type ConfigCardItem } from '../components/ConfigGrid';
import { supabase } from '../lib/supabase';
import { desktopSessionFragment } from '../lib/webviewSession';
import { useWebviewPreloadUrl, useWebviewLocalFileBridge } from '../lib/webviewBridge';

const WEBSITE = 'https://www.kickpulsebot.com';

export default function AlertStudioPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const preloadUrl = useWebviewPreloadUrl();
  const webviewRef = useWebviewLocalFileBridge();
  const [configs, setConfigs] = useState<ConfigCardItem[]>([]);
  const [activeId, setActiveId] = useState<string | 'new' | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshConfigs = async (uid: string) => {
    const { data } = await supabase.from('alert_studio_configs').select('id, config, thumbnail').eq('user_id', uid).order('created_at', { ascending: true });
    const rows = (data ?? []).map((r: any) => ({ id: r.id, name: r.config?.configName || 'Untitled', thumbnail: r.thumbnail }));
    setConfigs(rows);
  };

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then(async (status) => {
      const uid = status.me?.userId;
      setUserId(uid ?? null);
      if (uid) await refreshConfigs(uid);
      setLoading(false);
    });
  }, []);

  const deleteConfig = async (id: string) => {
    await supabase.from('alert_studio_configs').delete().eq('id', id);
    setConfigs((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  if (loading) return null;

  const editorPath = activeId && activeId !== 'new' ? `/alert-studio/edit?config=${activeId}` : '/alert-studio/edit';
  const embedSrc = userId ? `${WEBSITE}${editorPath}${desktopSessionFragment(userId)}` : '';
  const plainUrl = `${WEBSITE}${editorPath}`;

  const backToGrid = () => { setActiveId(null); if (userId) refreshConfigs(userId); };

  return (
    <Page
      title="Alert Studio"
      icon={<Sparkles size={22} color={COLORS.accent} />}
      subtitle="A scene per event — assign any combination of Kick/Twitch events to a scene, with amount tiers for Kicks/Cheer/Gift Subs. This is the real website editor, embedded — anything saved here plays back live at your /widgets/alert-studio OBS source exactly as if you'd edited it on the site."
      fullBleed
      actions={
        activeId ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={backToGrid}><ArrowLeft size={14} />Back to all</Button>
            <Button onClick={() => window.kickpulseDesktop.openExternal(plainUrl)}><ExternalLink size={14} />Open in browser</Button>
          </div>
        ) : undefined
      }
    >
      {!userId ? (
        <EmptyState title="Connect your account first" body="Alert Studio needs your KickPulse account connected (Settings → API key)." />
      ) : !activeId ? (
        <ConfigGrid
          items={configs}
          onOpen={setActiveId}
          onDelete={deleteConfig}
          onCreate={() => setActiveId('new')}
          createLabel="New Config"
          emptyTitle="No Alert Studio configs yet"
          emptyBody="Create one to assign a scene to Kick/Twitch events, with amount tiers for Kicks/Cheer/Gift Subs."
        />
      ) : (
        <Section style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 500, marginBottom: 0 }}>
          <webview ref={webviewRef} src={embedSrc} preload={preloadUrl ?? undefined} style={{ width: '100%', height: '100%', display: 'flex' }} partition="persist:kickpulse-webembed" />
        </Section>
      )}
    </Page>
  );
}
