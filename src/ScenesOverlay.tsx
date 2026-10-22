// src/ScenesOverlay.tsx — the Pulse Scenes playback queue for the always-on
// overlay window. Mounted alongside OverlayApp's own jumpscare layer (see
// OverlayApp.tsx) so a scene and a jumpscare can both exist without a
// second transparent window. Mirrors useScenes.ts's useScenesQueue on the
// website (same sequential-drain, same matchMedia safety net) — see
// src/lib/sceneTypes.ts's own header for what this port does and doesn't
// fully replicate.
import { useEffect, useRef, useState } from 'react';
import type { PulseScene, SceneFirePayload } from './lib/sceneTypes';
import { resolveMatchMediaTarget } from './lib/sceneTypes';
import { ensureSceneCss, SceneBackgroundView, SceneElementView, entranceAnimStyle } from './components/SceneElements';

interface QueuedScene {
  id: string;
  scene: PulseScene;
  payload: SceneFirePayload;
}

// A 'matchMedia' scene has no fixed timer at all — it waits for the real
// matched <video> to end. This is the ceiling for "that video never loads/
// errors and never fires anything" so a broken URL can't wedge the queue
// open forever.
const MATCH_MEDIA_SAFETY_MS = 10 * 60_000;

export default function ScenesOverlay() {
  useEffect(() => { ensureSceneCss(); }, []);

  const [active, setActive] = useState<QueuedScene | null>(null);
  const [exiting, setExiting] = useState(false);

  const queueRef = useRef<QueuedScene[]>([]);
  const busyRef = useRef(false);
  const pendingFinishRef = useRef<(() => void) | null>(null);
  const soundRef = useRef<HTMLAudioElement | null>(null);

  const drainQueue = () => {
    if (busyRef.current || queueRef.current.length === 0) return;
    const item = queueRef.current.shift()!;
    busyRef.current = true;
    setExiting(false);
    setActive(item);

    if (item.scene.soundUrl) {
      try {
        const audio = soundRef.current || new Audio();
        soundRef.current = audio;
        audio.src = item.scene.soundUrl;
        audio.volume = Math.min((item.scene.soundVolume ?? 80) / 100, 1);
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch {
        // non-fatal — the scene still plays visually with no sound
      }
    }

    const exitMs = Math.max(100, (item.scene.sceneExitSec ?? 0.45) * 1000);
    const finish = () => {
      pendingFinishRef.current = null;
      setExiting(true);
      setTimeout(() => {
        setActive(null);
        setExiting(false);
        busyRef.current = false;
        setTimeout(drainQueue, 150);
      }, exitMs);
    };

    const matchTarget = item.scene.durationMode === 'matchMedia' ? resolveMatchMediaTarget(item.scene) : null;
    if (matchTarget) {
      pendingFinishRef.current = finish;
      setTimeout(() => { if (pendingFinishRef.current === finish) finish(); }, MATCH_MEDIA_SAFETY_MS);
    } else {
      const durMs = Math.max(300, (item.scene.duration || 6) * 1000);
      setTimeout(finish, durMs);
    }
  };

  const reportMediaEnded = () => { pendingFinishRef.current?.(); };

  useEffect(() => {
    window.kickpulseOverlay.onPlayScene((payload) => {
      // The main process hands us a loosely-typed SceneSummary (see
      // electron/types.ts) — it's the exact JSON the website itself stores,
      // so this cast just asserts the shape this app actually renders.
      const scene = payload.scene as unknown as PulseScene;
      queueRef.current.push({ id: `${Date.now()}-${Math.random()}`, scene, payload: payload.tokens });
      drainQueue();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!active) return null;

  const matchTarget = active.scene.durationMode === 'matchMedia' ? resolveMatchMediaTarget(active.scene) : null;
  const dur = exiting ? Math.max(0.1, active.scene.sceneExitSec ?? 0.45) : Math.max(0.1, active.scene.sceneEnterSec ?? 0.5);
  const transitionKind = exiting ? active.scene.sceneExit : active.scene.sceneEnter;
  // entranceAnimStyle returns {className, animationDuration} now (matching
  // the website's real as-scene-in-*/as-scene-out-* CSS-class approach
  // instead of a hand-built inline `animation` string) — className has to be
  // applied separately, it isn't a valid key inside a React `style` object.
  const { className: sceneAnimClass, ...sceneAnimStyle } = entranceAnimStyle(transitionKind, exiting, dur) as any;

  return (
    <div className={sceneAnimClass} style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...sceneAnimStyle }}>
      <SceneBackgroundView bg={active.scene.background} onEnded={matchTarget?.kind === 'background' ? reportMediaEnded : undefined} />
      {active.scene.elements.filter((e) => e.visible).map((el) => (
        <SceneElementView key={el.id} el={el} payload={active.payload} exiting={exiting} onMediaEnded={reportMediaEnded} matchTarget={matchTarget} />
      ))}
    </div>
  );
}
