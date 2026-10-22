import { useEffect, useRef, useState } from 'react';
import ScenesOverlay from './ScenesOverlay';

interface JumpscarePayload {
  mediaUrl: string;
  audioUrl?: string;
  duration: number;
  volume: number;
  placeholder?: boolean;
}

const VIDEO_EXT = /\.(mp4|webm|mov)(\?|$)/i;

export default function OverlayApp() {
  const [active, setActive] = useState<JumpscarePayload | null>(null);
  const [highlightMs, setHighlightMs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    window.kickpulseOverlay.onPlayJumpscare((payload) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setActive(payload);
      const ms = Math.max(0.5, payload.duration || 5) * 1000;
      timerRef.current = setTimeout(() => setActive(null), ms);
    });
  }, []);

  // "Highlight This Screen" (Overlay settings page) — a plain visual flash
  // with no media/audio of its own, so someone with several monitors can
  // actually see which physical screen this window is on right now.
  useEffect(() => {
    window.kickpulseOverlay.onHighlight(({ ms }) => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightMs(ms);
      highlightTimerRef.current = setTimeout(() => setHighlightMs(null), ms);
    });
  }, []);

  // Light Reaction sound (electron/light-reactions.ts) — audio-only, no visual
  // layer of its own; the main process has no DOM to play audio with, so it
  // routes through this same always-on window.
  const presetAudioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    window.kickpulseOverlay.onPresetSound(({ url, volume }) => {
      if (!presetAudioRef.current) return;
      presetAudioRef.current.src = url;
      presetAudioRef.current.volume = Math.max(0, Math.min(1, volume));
      presetAudioRef.current.currentTime = 0;
      presetAudioRef.current.play().catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = active?.volume ?? 1;
    if (audioRef.current) audioRef.current.volume = active?.volume ?? 1;
  }, [active]);

  const isVideo = active ? VIDEO_EXT.test(active.mediaUrl) : false;

  // Scenes (its own queue/timing, see ScenesOverlay.tsx) is always mounted —
  // it has to keep listening for play-scene IPC messages regardless of
  // whether a jumpscare happens to be active; the jumpscare layer below it
  // still renders nothing (`display:none`-equivalent via early return inside
  // this same tree) when idle, exactly as before.
  //
  // Overlay Studio and Alert Studio do NOT have layers here (2026-10-15,
  // reverted the same day they were added) — both are OBS-source-authoring
  // tools (an Overlay Studio layout is an `/overlay/:id` OBS browser source;
  // an Alert Studio config is a `/widgets/alert-studio` one), not something
  // meant to render over the desktop's own game capture. See
  // src/pages/OverlayStudioPage.tsx / AlertStudioPage.tsx — both are real
  // in-app EDITORS now, with no connection to this overlay window at all.
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'transparent' }}>
      <audio ref={presetAudioRef} style={{ display: 'none' }} />
      <ScenesOverlay />
      {highlightMs != null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: 'rgba(124,58,237,0.22)',
            border: '14px solid #7c3aed',
            boxSizing: 'border-box',
            boxShadow: 'inset 0 0 120px rgba(124,58,237,0.6)',
          }}
        >
          <div style={{ fontSize: 56, fontWeight: 800, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,0.6)', fontFamily: 'system-ui, sans-serif' }}>
            KickPulse Overlay
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, color: '#ede9fe', textShadow: '0 2px 10px rgba(0,0,0,0.6)', fontFamily: 'system-ui, sans-serif' }}>
            This screen is where jumpscares and scenes will appear
          </div>
        </div>
      )}
      {active && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
          }}
        >
          {active.placeholder ? (
            // No real media AND no real Scene configured yet (see
            // electron/main.ts's resolvePayload()) — a plain on-brand
            // placeholder instead of playing a file that doesn't represent
            // anything the streamer actually set up.
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: '28px 44px', borderRadius: 20, background: 'rgba(239,68,68,0.18)', border: '4px solid #ef4444',
                boxShadow: '0 0 60px rgba(239,68,68,0.5)', fontFamily: 'system-ui, sans-serif',
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>Test Jumpscare</div>
              <div style={{ fontSize: 16, color: '#fecaca', textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
                No media or Scene configured yet — set one up on the Jumpscare Meter settings page.
              </div>
            </div>
          ) : isVideo ? (
            <video
              key={active.mediaUrl}
              ref={videoRef}
              src={active.mediaUrl}
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <img key={active.mediaUrl} src={active.mediaUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {active.audioUrl && !active.placeholder && <audio key={active.audioUrl} ref={audioRef} src={active.audioUrl} autoPlay />}
        </div>
      )}
    </div>
  );
}
