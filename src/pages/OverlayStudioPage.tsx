// src/pages/OverlayStudioPage.tsx — Overlay Studio, now an embedded view of
// the real website's own editor (/overlays/designer) rather than a second,
// independently-maintained native re-implementation.
//
// 2026-10-16 — the native engine (HudElements.tsx/HudElementFields.tsx)
// reproduced the website's own render pieces well enough in spirit, but had
// genuinely drifted from the real shared schema (its own opacity field was
// treated as 0-100 here vs. the real 0-1 scale the website actually stores
// — fixed the same day, see hudTypes.ts's own comment on HudElement.opacity
// — which is very likely the whole reason every real, website-authored
// layout rendered as if nothing were there at all). Rather than keep
// chasing drift bug-by-bug across a second implementation, this page now
// just embeds the real editor directly: the layout being edited here IS
// the exact same hud_layouts row the website's own /overlay/:id OBS source
// reads, so there is no second schema left to drift out of sync with.
// Rename/duplicate/delete and every other control now live inside the real
// editor's own top bar (it already has an inline-editable name field, same
// as Alert Studio's) — this page's own job shrinks to just "which saved
// layout do you want open," via the same direct hud_layouts query as
// before (the table is already anon-open), and the actual editing surface
// is the <webview>.
//
// Browse grid (2026-10-22, direct feedback: "I dont care for the small
// config buttons up top and would rather the new layout button be up top
// with panels below for each config that gives us a small preview of it")
// — replaces the small inline pill-row with ConfigGrid (shared with Alert
// Studio/Widget Studio). Each card's preview is the row's own already-
// captured `thumbnail` column (real html-to-image screenshot, same one the
// website's own "My Overlays" list already shows — see ConfigGrid.tsx's own
// header for why this needed no new rendering engine at all).
import { useEffect, useState } from 'react';
import { LayoutTemplate, ArrowLeft, ExternalLink } from 'lucide-react';
import { Page, Section, Button, EmptyState, COLORS } from '../components/ui';
import { ConfigGrid, type ConfigCardItem } from '../components/ConfigGrid';
import { supabase } from '../lib/supabase';
import { desktopSessionFragment } from '../lib/webviewSession';
import { useWebviewPreloadUrl, useWebviewLocalFileBridge } from '../lib/webviewBridge';

const WEBSITE = 'https://www.kickpulsebot.com';

export default function OverlayStudioPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const preloadUrl = useWebviewPreloadUrl();
  const webviewRef = useWebviewLocalFileBridge();
  const [layouts, setLayouts] = useState<ConfigCardItem[]>([]);
  const [activeId, setActiveId] = useState<string | 'new' | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshLayouts = async (uid: string) => {
    const { data } = await supabase.from('hud_layouts').select('id, name, thumbnail').eq('user_id', uid).order('updated_at', { ascending: false });
    setLayouts(((data as any[]) ?? []).map((l) => ({ id: l.id, name: l.name, thumbnail: l.thumbnail })));
  };

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then(async (status) => {
      const uid = status.me?.userId;
      setUserId(uid ?? null);
      if (uid) await refreshLayouts(uid);
      setLoading(false);
    });
  }, []);

  const deleteLayout = async (id: string) => {
    await supabase.from('hud_layouts').delete().eq('id', id);
    setLayouts((prev) => prev.filter((l) => l.id !== id));
    if (activeId === id) setActiveId(null);
  };

  if (loading) return null;

  const editorPath = activeId && activeId !== 'new' ? `/overlays/designer?layout=${activeId}` : '/overlays/designer';
  const embedSrc = userId ? `${WEBSITE}${editorPath}${desktopSessionFragment(userId)}` : '';
  const plainUrl = `${WEBSITE}${editorPath}`;

  // Reload the grid (picking up a freshly captured thumbnail) the moment
  // we leave the editor, not just on next app launch.
  const backToGrid = () => { setActiveId(null); if (userId) refreshLayouts(userId); };

  return (
    <Page
      title="Overlay Studio"
      icon={<LayoutTemplate size={22} color={COLORS.accent} />}
      subtitle="Design an OBS overlay layout — text, images, shapes, a clock, or your own widgets, freely placed on a 1920×1080 canvas. This is the real website editor, embedded — anything saved here plays back live at your /overlay/:id OBS source exactly as if you'd edited it on the site."
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
        <EmptyState title="Connect your account first" body="Overlay Studio needs your KickPulse account connected (Settings → API key)." />
      ) : !activeId ? (
        <ConfigGrid
          items={layouts}
          onOpen={setActiveId}
          onDelete={deleteLayout}
          onCreate={() => setActiveId('new')}
          createLabel="New Layout"
          emptyTitle="No layouts yet"
          emptyBody="Create one to design an OBS overlay — text, images, shapes, a clock, or your own widgets."
        />
      ) : (
        <Section style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 500, marginBottom: 0 }}>
          <webview ref={webviewRef} src={embedSrc} preload={preloadUrl ?? undefined} style={{ width: '100%', height: '100%', display: 'flex' }} partition="persist:kickpulse-webembed" />
        </Section>
      )}
    </Page>
  );
}
