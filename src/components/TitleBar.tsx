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
import UpdateBadge from './UpdateBadge';

const BAR_HEIGHT = 36;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState('');
  // Manual update check (2026-10-28, direct request after "its not fucking
  // giving me an update" — there was no way to force a check at all, only
  // a silent 10s-after-launch check then every 2 hours, with zero feedback
  // either way if nothing was found). Clicking the version number now
  // triggers a real check and shows what happened — UpdateBadge still owns
  // what happens once an update IS found/downloading/ready.
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');

  useEffect(() => {
    window.kickpulseDesktop.windowIsMaximized().then(setMaximized);
    window.kickpulseDesktop.onWindowMaximizedChange(setMaximized);
    window.kickpulseDesktop.getAppVersion().then(setVersion);
  }, []);

  const checkForUpdatesNow = async () => {
    if (checkState === 'checking') return;
    setCheckState('checking');
    const res = await window.kickpulseDesktop.updater.check();
    if (!res.ok) {
      setCheckState('error');
      setTimeout(() => setCheckState('idle'), 5000);
      return;
    }
    // "Up to date" only means something if there genuinely ISN'T an update —
    // checking the real status here (rather than just trusting res.ok, which
    // only means "the network request succeeded") avoids this flashing a
    // misleading "up to date" right as UpdateBadge is about to show a real
    // one it found.
    const status = await window.kickpulseDesktop.updater.getStatus();
    if (status.phase === 'idle') {
      setCheckState('done');
      setTimeout(() => setCheckState('idle'), 3000);
    } else {
      setCheckState('idle');
    }
  };

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
        {version && (
          <span
            onClick={checkForUpdatesNow}
            title={checkState === 'error' ? 'Check failed — click to retry' : 'Click to check for updates'}
            style={{
              marginLeft: 6,
              fontSize: 10,
              fontWeight: 500,
              color: checkState === 'error' ? COLORS.danger : COLORS.textDim,
              opacity: checkState === 'idle' ? 0.6 : 1,
              cursor: 'pointer',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            {checkState === 'checking' ? 'checking for updates…'
              : checkState === 'done' ? 'you’re up to date ✓'
              : checkState === 'error' ? 'check failed — retry'
              : `v${version}`}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <UpdateBadge />
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
