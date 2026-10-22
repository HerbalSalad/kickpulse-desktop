// src/components/Sidebar.tsx — redesigned 2026-10-15 (direct feedback: "the
// menu looks like shit, make it more modern... youre using wackass lame
// icons"). Real lucide-react icons instead of raw emoji, grouped into
// named sections (same organizing idea CLAUDE.md documents for the
// website's own Sidebar.tsx — Overview / Create / Hardware), a left accent
// bar on the active item instead of just a background tint, and a
// connection-status footer so "am I actually connected right now" doesn't
// require switching to the Home tab to check.
import {
  LayoutDashboard, Blocks, LayoutTemplate, Sparkles, Clapperboard, Zap, Shapes,
  Video, Monitor, FolderOpen, Plug, MessageSquare, Bell, ShieldCheck, Sun, Flame, Mic, Settings, ShieldAlert, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string | null; // null = ungrouped (Home sits alone, on its own)
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  // Dashboard (2026-10-19) — now the default landing page, direct
  // feedback: "it should be at the top (it should honestly be the default
  // page)." Home's old role (account connect/disconnect) moved to Settings,
  // at the bottom where account-adjacent/utility pages belong.
  { label: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Create',
    items: [
      { id: 'widgets', label: 'Widgets', icon: Blocks },
      { id: 'overlay-studio', label: 'Overlay Studio', icon: LayoutTemplate },
      { id: 'alert-studio', label: 'Alert Studio', icon: Sparkles },
      { id: 'widget-studio', label: 'Widget Studio', icon: Shapes },
      { id: 'scenes', label: 'Scenes', icon: Clapperboard },
    ],
  },
  {
    label: 'Chat',
    items: [
      { id: 'chatbot', label: 'Chat Bot', icon: MessageSquare },
      // Moved here from 'Create' (2026-10-21) — Commands/Keywords can now
      // carry the same rich Actions a Pulse Engine rule can, so the two
      // read as siblings ("something typed" vs "something happened"), same
      // section the website's own Sidebar.tsx already groups them in.
      { id: 'pulse-engine', label: 'Pulse Engine', icon: Zap },
      { id: 'chat-alerts', label: 'Chat Alerts', icon: Bell },
      { id: 'moderation', label: 'Moderation', icon: ShieldCheck },
      { id: 'community-bans', label: 'Community Bans', icon: ShieldAlert },
    ],
  },
  {
    label: 'Hardware',
    items: [
      { id: 'obs', label: 'OBS Control', icon: Video },
      { id: 'overlay-display', label: 'Overlay Display', icon: Monitor },
      { id: 'local-media', label: 'Local Media', icon: FolderOpen },
      { id: 'devices', label: 'Devices', icon: Plug },
      { id: 'light-scenes', label: 'Light Scenes', icon: Sun },
      { id: 'light-reactions', label: 'Light Reactions', icon: Flame },
      { id: 'voice-commands', label: 'Voice Commands', icon: Mic },
    ],
  },
  { label: null, items: [{ id: 'settings', label: 'Settings', icon: Settings }] },
];

// Flat list, same identifiers as before — kept so App.tsx's own `active`
// state/routing logic (and anything else that iterates the old NAV_ITEMS)
// doesn't need to change shape, just where it imports from.
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export default function Sidebar({ active, onSelect, connected }: { active: string; onSelect: (id: string) => void; connected?: boolean }) {
  return (
    <nav
      style={{
        width: 212, flexShrink: 0, background: '#0a0a0e', borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', padding: '18px 0 14px',
      }}
    >
      <div style={{ padding: '0 18px 20px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <img src="/icon.png" alt="" style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0 }} />
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 0.2, color: '#fff' }}>
          KickPulse <span style={{ color: '#a78bfa', fontWeight: 700 }}>Desktop</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px' }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} style={{ marginBottom: 14 }}>
            {section.label && (
              <div style={{ padding: '0 10px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: '#4b5563', textTransform: 'uppercase' }}>
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const isActive = active === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  style={{
                    position: 'relative', width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px 8px 14px', borderRadius: 8, border: 'none', marginBottom: 1,
                    background: isActive ? 'rgba(124,58,237,0.16)' : 'transparent',
                    color: isActive ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  {isActive && (
                    <span style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: '#a78bfa' }} />
                  )}
                  <Icon size={16} strokeWidth={2} color={isActive ? '#a78bfa' : '#6b7280'} style={{ flexShrink: 0 }} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, margin: '0 10px' }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: connected ? '#22c55e' : '#4b5563',
          boxShadow: connected ? '0 0 6px #22c55e' : 'none',
        }} />
        <span style={{ fontSize: 11.5, color: connected ? '#9ca3af' : '#6b7280' }}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
    </nav>
  );
}
