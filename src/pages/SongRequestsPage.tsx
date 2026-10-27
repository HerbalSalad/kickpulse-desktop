// src/pages/SongRequestsPage.tsx — direct Skip/Pause/Resume/Previous
// buttons for Song Requests, with no Pulse Engine rule needed (2026-10-27,
// direct request: "I was hoping to have spotify and youtube song requests
// controls for the desktop app and for stream deck. Ideally we would be
// able to use the same button regardless of using spotify or youtube for
// our song requests page.").
//
// Fires the exact same music_skip/music_pause/music_resume/music_previous
// Pulse Engine actions the website/Stream Deck already use, via
// window.kickpulseDesktop.pulseRules.runAction (POST /pulse-rules/run-action,
// no saved rule needed) — server-side, these are source-mode-aware
// (routes/songRequests.js's controlPlayer): Spotify mode calls the real
// Spotify Web API transport; YouTube mode relays to the website's own
// SongRequests dashboard page's embedded player over the WS hub (that page
// needs to be open in a browser tab for YouTube mode specifically — there's
// no second, separate YouTube player anywhere else, same real limitation
// the website's own UI already has). Previous is Spotify-only — YouTube's
// queue mode has no "go back" concept at all.
import { useState } from 'react';
import { Music, SkipBack, SkipForward, Pause, Play } from 'lucide-react';
import { Page, Section, Button, COLORS } from '../components/ui';

type MusicAction = 'music_skip' | 'music_pause' | 'music_resume' | 'music_previous';

export default function SongRequestsPage() {
  const [busy, setBusy] = useState<MusicAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fire = async (type: MusicAction) => {
    setBusy(type);
    setError(null);
    try {
      await window.kickpulseDesktop.pulseRules.runAction({ type });
    } catch (err: any) {
      setError(err?.message || 'Failed to run — is a Kick account connected?');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Song Requests" icon={<Music size={22} color={COLORS.accent} />}
      subtitle="Control playback directly — works whether your Song Requests source is Spotify or YouTube.">
      <Section title="Playback">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button onClick={() => fire('music_previous')} disabled={busy !== null} title="Spotify only">
            <SkipBack size={14} /> Previous
          </Button>
          <Button onClick={() => fire('music_pause')} disabled={busy !== null}>
            <Pause size={14} /> Pause
          </Button>
          <Button onClick={() => fire('music_resume')} disabled={busy !== null}>
            <Play size={14} /> Resume
          </Button>
          <Button variant="primary" onClick={() => fire('music_skip')} disabled={busy !== null}>
            <SkipForward size={14} /> Skip
          </Button>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12.5 }}>
            {error}
          </div>
        )}
        <p style={{ fontSize: 11.5, color: COLORS.textFaint, marginTop: 14 }}>
          Previous only works in Spotify mode — YouTube's request queue has no "previous track" to go back to.
          In YouTube mode, these buttons control the SongRequests page's own embedded player, so that page needs to be open in a browser tab.
          Set your source on the website's Song Requests settings.
        </p>
      </Section>
    </Page>
  );
}
