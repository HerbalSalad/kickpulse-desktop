// src/components/UpdateBadge.tsx — the one visible, always-on surface for
// auto-updates (electron/updater.ts). Lives in TitleBar.tsx so it's on
// screen no matter which page is open. Deliberately silent for 'idle' and
// 'checking' — a background check that finds nothing new has nothing worth
// interrupting a streamer over; it only shows up once there's something to
// either wait on or act on.
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { COLORS } from './ui';

export default function UpdateBadge() {
  const [status, setStatus] = useState<UpdaterStatus>({ phase: 'idle' });

  useEffect(() => {
    window.kickpulseDesktop.updater.getStatus().then(setStatus);
    window.kickpulseDesktop.updater.onStatus(setStatus);
  }, []);

  if (status.phase === 'idle' || status.phase === 'checking' || status.phase === 'error') return null;

  const downloading = status.phase === 'downloading';

  return (
    <button
      onClick={() => { if (!downloading) window.kickpulseDesktop.updater.install(); }}
      title={downloading ? `Downloading v${status.version}…` : `Restart to install v${status.version}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 24,
        padding: '0 10px',
        marginRight: 8,
        borderRadius: 12,
        border: `1px solid ${downloading ? COLORS.border : COLORS.success}`,
        background: downloading ? 'rgba(255,255,255,0.04)' : 'rgba(34,197,94,0.14)',
        color: downloading ? COLORS.textDim : COLORS.success,
        fontSize: 11,
        fontWeight: 700,
        cursor: downloading ? 'default' : 'pointer',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {downloading
        ? <><RefreshCw size={12} /> Updating… {status.percent ?? 0}%</>
        : <><Download size={12} /> Restart to update</>}
    </button>
  );
}
