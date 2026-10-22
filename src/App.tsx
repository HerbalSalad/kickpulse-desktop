import { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import ConnectionsPage from './pages/ConnectionsPage';
import ObsControlPage from './pages/ObsControlPage';
import OverlayDisplayPage from './pages/OverlayDisplayPage';
import LocalMediaPage from './pages/LocalMediaPage';
import DevicesPage from './pages/DevicesPage';
import LightScenesPage from './pages/LightScenesPage';
import LightReactionsPage from './pages/LightReactionsPage';
import VoiceCommandsPage from './pages/VoiceCommandsPage';
import WidgetsPage from './pages/WidgetsPage';
import WidgetEditorPage from './pages/WidgetEditorPage';
import ComingSoonPage from './pages/ComingSoonPage';
import OverlayStudioPage from './pages/OverlayStudioPage';
import AlertStudioPage from './pages/AlertStudioPage';
import WidgetStudioPage from './pages/WidgetStudioPage';
import ScenesPage from './pages/ScenesPage';
import PulseEnginePage from './pages/PulseEnginePage';
import ChatBotPage from './pages/ChatBotPage';
import ChatAlertsPage from './pages/ChatAlertsPage';
import ModerationPage from './pages/ModerationPage';
import CommunityBansPage from './pages/CommunityBansPage';

export default function App() {
  const [active, setActive] = useState('dashboard');
  const [editingWidgetKey, setEditingWidgetKey] = useState<string | null>(null);
  const [status, setStatus] = useState<DesktopStatus | null>(null);

  useEffect(() => {
    window.kickpulseDesktop.getStatus().then(setStatus);
    window.kickpulseDesktop.onStatus(setStatus);
  }, []);

  const select = (id: string) => {
    setActive(id);
    if (id !== 'widgets') setEditingWidgetKey(null);
  };

  const me = status?.me;
  const connected = !!status?.connected;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', background: '#0b0b10', color: '#fff' }}>
      <TitleBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <Sidebar active={active} onSelect={select} connected={connected} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {active === 'dashboard' && <DashboardPage />}
        {active === 'settings' && <SettingsPage />}
        {active === 'connections' && <ConnectionsPage userId={me?.userId || null} />}

        {active === 'widgets' &&
          (editingWidgetKey ? (
            <WidgetEditorPage
              widgetKey={editingWidgetKey}
              userId={me?.userId || ''}
              isPremium={!!me?.isPremium}
              onBack={() => setEditingWidgetKey(null)}
            />
          ) : me ? (
            <WidgetsPage isPremium={!!me.isPremium} onOpen={setEditingWidgetKey} />
          ) : (
            <ComingSoonPage
              title="Widgets"
              body="Connect your account on the Settings tab first — this needs to know which account's widgets to show."
            />
          ))}

        {active === 'overlay-studio' && (
          me ? <OverlayStudioPage /> : (
            <ComingSoonPage title="Overlay Studio" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'alert-studio' && (
          me ? <AlertStudioPage /> : (
            <ComingSoonPage title="Alert Studio" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'widget-studio' && (
          me ? <WidgetStudioPage /> : (
            <ComingSoonPage title="Widget Studio" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'scenes' && (
          me ? <ScenesPage /> : (
            <ComingSoonPage title="Scenes" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'pulse-engine' && (
          me ? <PulseEnginePage /> : (
            <ComingSoonPage title="Pulse Engine" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'chatbot' && (
          me ? <ChatBotPage /> : (
            <ComingSoonPage title="Chat Bot" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'chat-alerts' && (
          me ? <ChatAlertsPage /> : (
            <ComingSoonPage title="Chat Alerts" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'moderation' && (
          me ? <ModerationPage /> : (
            <ComingSoonPage title="Moderation" body="Connect your account on the Settings tab first." />
          )
        )}
        {active === 'community-bans' && (
          me ? <CommunityBansPage /> : (
            <ComingSoonPage title="Community Bans" body="Connect your account on the Settings tab first." />
          )
        )}

        {active === 'obs' && <ObsControlPage />}
        {active === 'overlay-display' && <OverlayDisplayPage />}
        {active === 'local-media' && <LocalMediaPage />}
        {active === 'devices' && <DevicesPage />}
        {active === 'light-scenes' && <LightScenesPage />}
        {active === 'light-reactions' && <LightReactionsPage />}
        {active === 'voice-commands' && <VoiceCommandsPage />}
      </main>
      </div>
    </div>
  );
}
