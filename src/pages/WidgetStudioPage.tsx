// src/pages/WidgetStudioPage.tsx — Widget Studio, an embedded view of the
// real website's own editor (/widget-studio/edit) — same pattern as Overlay
// Studio/Alert Studio (see those pages' own file headers): a free-form,
// heavily customized canvas like this one is a second, independently-
// drifting schema waiting to happen if ported natively, so the config
// edited here IS the exact same widget_studio_configs row the website's own
// /widgets/widget-studio OBS source reads. widget_studio_configs supports
// several named configs per user (same shape as alert_studio_configs/
// hud_layouts), so this page's own job is "which config do you want open."
//
// Browse grid (2026-10-22, same ConfigGrid redesign as Overlay Studio/
// Alert Studio — see Overlay Studio's own header comment) — each card's
// preview is the row's own already-captured `thumbnail` column, same real
// screenshot WidgetStudioList.tsx (the website's own list page) already
// shows.
import { useEffect, useState } from 'react';
import { Blocks, ArrowLeft, ExternalLink } from 'lucide-react';
import { Page, Section, Button, EmptyState, COLORS } from '../components/ui';
import { ConfigGrid, type ConfigCardItem } from '../components/ConfigGrid';
import { supabase } from '../lib/supabase';
import { desktopSessionFragment } from '../lib/webviewSession';
import { useWebviewPreloadUrl, useWebviewLocalFileBridge } from '../lib/webviewBridge';

const WEBSITE = 'https://www.kickpulsebot.com';

export default function WidgetStudioPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const preloadUrl = useWebviewPreloadUrl();
  const webviewRef = useWebviewLocalFileBridge();
  const [configs, setConfigs] = useState<ConfigCardItem[]>([]);
  const [activeId, setActiveId] = useState<string | 'new' | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshConfigs = async (uid: string) => {
    const { data } = await supabase.from('widget_studio_configs').select('id, config, thumbnail').eq('user_id', uid).order('created_at', { ascending: true });
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
    await supabase.from('widget_studio_configs').delete().eq('id', id);
    setConfigs((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  if (loading) return null;

  const editorPath = activeId && activeId !== 'new' ? `/widget-studio/edit?config=${activeId}` : '/widget-studio/edit';
  const embedSrc = userId ? `${WEBSITE}${editorPath}${desktopSessionFragment(userId)}` : '';
  const plainUrl = `${WEBSITE}${editorPath}`;

  const backToGrid = () => { setActiveId(null); if (userId) refreshConfigs(userId); };

  return (
    <Page
      title="Widget Studio"
      icon={<Blocks size={22} color={COLORS.accent} />}
      subtitle="A free-form canvas of data-bound building blocks — bars, rings, numbers, event feeds, images, sounds, and a Chat element. This is the real website editor, embedded — anything saved here plays back live at your /widgets/widget-studio OBS source exactly as if you'd edited it on the site."
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
        <EmptyState title="Connect your account first" body="Widget Studio needs your KickPulse account connected (Settings → API key)." />
      ) : !activeId ? (
        <ConfigGrid
          items={configs}
          onOpen={setActiveId}
          onDelete={deleteConfig}
          onCreate={() => setActiveId('new')}
          createLabel="New Config"
          emptyTitle="No Widget Studio configs yet"
          emptyBody="Create one to build a free-form canvas of bars, rings, numbers, event feeds, images, sounds, and a Chat element."
        />
      ) : (
        <Section style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 500, marginBottom: 0 }}>
          <webview ref={webviewRef} src={embedSrc} preload={preloadUrl ?? undefined} style={{ width: '100%', height: '100%', display: 'flex' }} partition="persist:kickpulse-webembed" />
        </Section>
      )}
    </Page>
  );
}
