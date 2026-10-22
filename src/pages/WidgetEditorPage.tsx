// src/pages/WidgetEditorPage.tsx — a widget's settings, now an embedded
// view of the real website's own settings page (/widgets/{key}/settings)
// rather than a generic AutoForm + raw-OBS-URL preview.
//
// 2026-10-18 — direct feedback: "chat overlay is lacking the simulated
// chat to see how changes affect. goal bar shows a preview but it doesnt
// show my goals properly, as it thinks I have a ton of configs even
// though thats configs for each bar type under my one overall config. It
// should function much more like it does on the site." Both are real,
// structural limitations of the generic approach, not polish gaps:
//   - A plain `<webview src=".../widgets/{key}?config_id=...">` only ever
//     shows the REAL OBS output — empty air until a real chat message
//     actually arrives. Chat Overlay's own settings page has its own
//     built-in simulated/mock preview specifically so you can see styling
//     changes without needing live chat; a raw OBS-URL iframe can never
//     have that, because it IS the OBS output, not the settings page.
//   - Goal Bar isn't "one config" at all on the real schema — it's a BAR
//     TYPE (Kicks/Subs/Followers/Combo/etc, its own top-level tab) crossed
//     with any number of NAMED PRESETS within that type (MultiConfigTabs).
//     The generic editor had no idea bar type and preset were two
//     different axes — it just listed every single row in the table as
//     one flat "pick one of N" list, which looks like a pile of near-
//     duplicate configs instead of the real, intentional structure.
// Same conclusion Alert Studio/Overlay Studio/Scenes/Widget Studio already
// reached for the exact same reason (see each of those pages' own file
// headers): rather than keep chasing a second, drifting re-implementation
// of each widget's own custom preview/picker/tab logic, this just embeds
// the real settings page directly. Every widget's own page already shows
// its OWN OBS URL/Save/Share inline (CLAUDE.md's settings-page header
// convention) and already handles its own multi-config switching, so no
// separate "pick a config" screen or OBS-URL plumbing is needed here at
// all anymore — a config behaves identically whether edited here or on
// the website, because it's the exact same page.
//
// Trade-off, disclosed rather than silently dropped: the old generic
// editor's "browse a local file on this PC" media picker (this app's own
// local media server) doesn't carry over — the real website's own
// MediaPicker has no concept of a local Electron filesystem. Local media
// files are still usable from the dedicated Local Media tab (copy its
// served URL into any field on the page below), just not auto-wired into
// every media field the way it was here before.
import { ExternalLink, ArrowLeft } from 'lucide-react';
import { widgetForKey } from '../lib/widgetCatalog';
import { Page, Section, Button, EmptyState, COLORS } from '../components/ui';
import { desktopSessionFragment } from '../lib/webviewSession';
import { useWebviewPreloadUrl, useWebviewLocalFileBridge } from '../lib/webviewBridge';

const WEBSITE = 'https://www.kickpulsebot.com';

interface WidgetEditorPageProps {
  widgetKey: string;
  userId: string;
  isPremium: boolean;
  onBack: () => void;
}

export default function WidgetEditorPage({ widgetKey, userId, isPremium, onBack }: WidgetEditorPageProps) {
  const widget = widgetForKey(widgetKey);
  const preloadUrl = useWebviewPreloadUrl();
  const webviewRef = useWebviewLocalFileBridge();

  if (!widget) {
    return (
      <div style={{ padding: 28 }}>
        <Button onClick={onBack}><ArrowLeft size={14} />Back</Button>
        <div style={{ color: COLORS.danger, marginTop: 16 }}>Unknown widget.</div>
      </div>
    );
  }

  const locked = widget.premium && !isPremium;
  const plainUrl = `${WEBSITE}/widgets/${widget.key}/settings`;
  // ?embed=1 (2026-10-22) — the website's DashboardLayout now renders
  // chrome-free (no sidebar) for any dashboard route when this is set, so
  // this embed no longer shows the whole site — just the widget's own
  // settings panel, same as the Studio pages' own embeds. Appended after
  // desktopSessionFragment's own hash fragment since that's a `#...` auth
  // token, not a query string — `?embed=1` has to land before the `#`.
  const embedSrc = userId ? `${plainUrl}?embed=1${desktopSessionFragment(userId)}` : '';

  return (
    <Page
      title={widget.label}
      icon={<span style={{ fontSize: 20 }}>{widget.icon}</span>}
      subtitle={widget.desc}
      fullBleed
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button onClick={onBack}><ArrowLeft size={14} />Widgets</Button>
          <Button onClick={() => window.kickpulseDesktop.openExternal(plainUrl)}><ExternalLink size={14} />Open in browser</Button>
        </div>
      }
    >
      {locked ? (
        <EmptyState title="Premium widget" body="Upgrade on the website to edit this one." />
      ) : !userId ? (
        <EmptyState title="Connect your account first" body="Widgets need your KickPulse account connected (Home tab → API key)." />
      ) : (
        <Section style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 500, marginBottom: 0 }}>
          <webview ref={webviewRef} src={embedSrc} preload={preloadUrl ?? undefined} style={{ width: '100%', height: '100%', display: 'flex' }} partition="persist:kickpulse-webembed" />
        </Section>
      )}
    </Page>
  );
}
