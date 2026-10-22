// src/pages/ConnectionsPage.tsx — Connections, an embedded view of the real
// website's own page (/connections) — same pattern as the widget settings
// embed (WidgetEditorPage.tsx): one page, no config list, so a plain
// chrome-free <webview> embed is all this needs (see ?embed=1 on
// DashboardLayout.tsx, website repo, 2026-10-22).
//
// Covers platforms (Kick/Twitch/YouTube/TikTok), the new bot-account
// connect flow (Ultimate-gated "bring your own bot account" + the official
// KickPulse bot account framework), and event subscriptions — all moved out
// of the website's own Settings page into this one, and genuinely needs no
// separate desktop reimplementation: connecting a bot account IS a real
// Kick/Twitch OAuth round trip, which only makes sense as a real browser
// flow either way.
import { Link2, ExternalLink } from 'lucide-react';
import { Page, Section, Button, EmptyState, COLORS } from '../components/ui';
import { desktopSessionFragment } from '../lib/webviewSession';
import { useWebviewPreloadUrl, useWebviewLocalFileBridge } from '../lib/webviewBridge';

const WEBSITE = 'https://www.kickpulsebot.com';

interface ConnectionsPageProps {
  userId: string | null;
}

export default function ConnectionsPage({ userId }: ConnectionsPageProps) {
  const preloadUrl = useWebviewPreloadUrl();
  const webviewRef = useWebviewLocalFileBridge();

  const plainUrl = `${WEBSITE}/connections`;
  const embedSrc = userId ? `${plainUrl}?embed=1${desktopSessionFragment(userId)}` : '';

  return (
    <Page
      title="Connections"
      icon={<Link2 size={22} color={COLORS.accent} />}
      subtitle="Kick, Twitch, YouTube, TikTok, bot accounts, and event subscriptions. This is the real website page, embedded."
      fullBleed
      actions={
        <Button onClick={() => window.kickpulseDesktop.openExternal(plainUrl)}><ExternalLink size={14} />Open in browser</Button>
      }
    >
      {!userId ? (
        <EmptyState title="Connect your account first" body="Connections needs your KickPulse account connected (Settings tab → API key)." />
      ) : (
        <Section style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 500, marginBottom: 0 }}>
          <webview ref={webviewRef} src={embedSrc} preload={preloadUrl ?? undefined} style={{ width: '100%', height: '100%', display: 'flex' }} partition="persist:kickpulse-webembed" />
        </Section>
      )}
    </Page>
  );
}
