// src/components/TitleBar.tsx — custom window title bar (2026-10-20, direct
// feedback: "that logo on the top bar of the app is far too small to even
// be seen. lets just center the name kickpulse on that bar, and then put a
// logo next to where it says kickpulse desktop (not on the top bar but on
// the actual app)"). A native Windows title bar can't center its text or
// show the icon any larger than the OS's own small fixed size — no amount
// of asset tweaking fixes that, the window has to go frame: false
// (electron/main.ts) and draw its own bar instead. Minimize/maximize/close
// have no native equivalent anymore, so this renders its own, wired to
// window:minimize/maximize-toggle/close over IPC (preload.ts).
import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { COLORS } from './ui';

const BAR_HEIGHT = 36;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.kickpulseDesktop.windowIsMaximized().then(setMaximized);
    window.kickpulseDesktop.onWindowMaximizedChange(setMaximized);
  }, []);

  return (
    <div
      style={{
        height: BAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        background: COLORS.panel,
        borderBottom: `1px solid ${COLORS.border}`,
        // Makes the whole bar draggable by default; interactive children
        // (the buttons below) opt back out with noDrag.
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
      onDoubleClick={() => window.kickpulseDesktop.windowMaximizeToggle()}
    >
      {/* Left spacer mirrors the button group's width so the centered
          title is genuinely centered on the window, not just the
          remaining space after the buttons. */}
      <div style={{ width: 138 }} />
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: COLORS.textDim,
          userSelect: 'none',
        }}
      >
        KickPulse
      </div>
      <div style={{ display: 'flex', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <TitleBarButton label="Minimize" onClick={() => window.kickpulseDesktop.windowMinimize()}>
          <Minus size={14} />
        </TitleBarButton>
        <TitleBarButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => window.kickpulseDesktop.windowMaximizeToggle()}>
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </TitleBarButton>
        <TitleBarButton label="Close" danger onClick={() => window.kickpulseDesktop.windowClose()}>
          <X size={14} />
        </TitleBarButton>
      </div>
    </div>
  );
}

function TitleBarButton({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 46,
        height: BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        background: hover ? (danger ? COLORS.danger : 'rgba(255,255,255,0.08)') : 'transparent',
        color: hover && danger ? '#fff' : COLORS.textDim,
        cursor: 'pointer',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {children}
    </button>
  );
}
