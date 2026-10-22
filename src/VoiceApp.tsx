// src/VoiceApp.tsx — Voice Commands' mic capture (2026-10-23 rewrite,
// Whisper-WASM -> Vosk). This hidden, never-shown window now does ONLY mic
// capture — `getUserMedia` is a renderer-only browser API, which is the one
// reason any of this still needs to run in a renderer at all. Every bit of
// actual recognition (Vosk, grammar/word-list, confidence, partial results)
// now runs in electron/voiceCommands.ts, in the main process — see that
// file's own header for why that's both possible and a better fit now that
// the engine is a real native module instead of a WASM model.
//
// Captures raw 16kHz mono PCM and streams it to the main process as fast as
// it's produced — Vosk has a genuine streaming API (unlike Whisper, which
// needed a complete buffer), so there's no more "record N seconds, then
// transcribe" chunking at all; recognition runs continuously as audio
// arrives.
import { useEffect, useRef } from 'react';

const SAMPLE_RATE = 16000;
// 4096 samples @ 16kHz ≈ 256ms per frame — small enough to keep partial
// results feeling responsive, large enough not to flood IPC with overhead.
const BUFFER_SIZE = 4096;

declare global {
  interface Window {
    kickpulseVoice?: {
      onSetInputDevice: (cb: (deviceId: string | null) => void) => void;
      sendAudioFrame: (frame: ArrayBuffer) => void;
    };
  }
}

export default function VoiceApp() {
  const deviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    window.kickpulseVoice?.onSetInputDevice((deviceId) => { deviceIdRef.current = deviceId; });
  }, []);

  useEffect(() => {
    let stopped = false;
    let mediaStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    (async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: deviceIdRef.current ? { deviceId: { exact: deviceIdRef.current } } : true,
        });
        if (stopped) { mediaStream.getTracks().forEach(t => t.stop()); return; }

        // Requesting the AudioContext itself at 16kHz makes Chromium's own
        // internal resampler convert from whatever the mic's native rate is
        // (commonly 44.1k/48k) down to exactly what Vosk expects — simpler
        // and higher quality than a hand-rolled decimation step.
        audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        source = audioCtx.createMediaStreamSource(mediaStream);
        // ScriptProcessorNode is deprecated in favor of AudioWorklet, but
        // this is a hidden, internal, never-rendered window with no UI
        // thread contention to worry about — the simpler inline API is
        // fine here and avoids needing a separate worklet module file.
        processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        processor.onaudioprocess = (e) => {
          const floatData = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(floatData.length);
          for (let i = 0; i < floatData.length; i++) {
            const s = Math.max(-1, Math.min(1, floatData[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          window.kickpulseVoice?.sendAudioFrame(pcm.buffer);
        };
        source.connect(processor);
        // A ScriptProcessorNode only fires onaudioprocess while connected
        // all the way to a real destination — connecting to a muted gain
        // node (rather than audioCtx.destination directly) avoids actually
        // playing the mic audio back out loud while still keeping the
        // processing graph alive.
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      } catch (err) {
        console.error('[voice] mic capture failed', err);
      }
    })();

    return () => {
      stopped = true;
      processor?.disconnect();
      source?.disconnect();
      audioCtx?.close();
      mediaStream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Nothing is ever rendered — this window is never shown.
  return null;
}
