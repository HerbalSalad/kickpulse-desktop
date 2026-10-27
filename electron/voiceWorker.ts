// electron/voiceWorker.ts — the real Vosk model/recognizer, moved OFF
// Electron's main process (2026-10-27 fix, direct report: "we still have an
// issue with switching the voice model. anything besides small has issues...
// any of them besides small gives me massive lag... I do not have a bad pc
// by any means so that doesnt make sense and must be a bug.").
//
// Root cause: vosk-koffi's Model/Recognizer calls are synchronous, blocking
// native FFI calls — `new vosk.Model(dir)` has to read and parse the whole
// model directory (acoustic model, language model, HCLG graph) before it
// returns, and `recognizer.acceptWaveform(buffer)` is a real, synchronous
// decode step. voiceCommands.ts used to call both DIRECTLY from
// ipcMain.on('voice:audio-frame', ...) — i.e. on Electron's own main
// process thread, the same thread that handles window compositing
// coordination, every other IPC channel, and timers. A multi-second model
// load (134MB–2.3GB) or a slow per-frame decode doesn't just make
// recognition laggy — it freezes the ENTIRE app for however long that one
// call takes, because nothing else on that thread can run until it returns.
// This explains both halves of the report: switching to a bigger model
// causes one big freeze while it loads, and "medium" specifically is the
// "-lgraph" (lazy graph) variant — Vosk's own docs note this trades a
// smaller download for SLOWER per-decode CPU cost (the HCLG graph is
// expanded on the fly during decoding, not once at load) — a real,
// documented Vosk characteristic, not something fixable in this codebase,
// but ALSO not something a fast CPU can out-run on its own: it's single-
// threaded blocking work competing with the main process for the same one
// thread, not a raw horsepower problem.
//
// Fix: run the actual Model/Recognizer here, inside a dedicated
// worker_thread — a real OS-level separate thread, not just an async
// callback. Every Vosk call below still blocks THIS thread for the same
// amount of time it always did (that part of the cost is inherent to the
// model, not fixable), but it can no longer block Electron's main process,
// so the rest of the app (window dragging, every other feature's own IPC)
// stays responsive regardless of which model is loaded. Koffi (vosk-koffi's
// underlying FFI layer) is explicitly designed to work from a worker thread
// — no special handling needed beyond just importing it here instead of in
// main.ts/voiceCommands.ts.
//
// Messages in (from voiceCommands.ts, via Worker#postMessage):
//   { type: 'configure', modelDir, size, grammar }  — (re)build model/recognizer if needed
//   { type: 'frame', buffer: ArrayBuffer }           — one 16kHz mono PCM16 chunk
//   { type: 'teardown' }                             — free everything, used on disable
// Messages out (via parentPort.postMessage):
//   { type: 'partial', raw } | { type: 'final', raw } | { type: 'error', message }
import { parentPort } from 'node:worker_threads';
import vosk from 'vosk-koffi';

vosk.setLogLevel(-1);

let model: InstanceType<typeof vosk.Model> | null = null;
let modelLoadedSize: string | null = null;
let recognizer: InstanceType<typeof vosk.Recognizer> | null = null;
let recognizerKey = '';

function ensureRecognizer(modelDir: string, size: string, grammar: string[] | undefined): void {
  const key = `${size}:${JSON.stringify(grammar)}`;
  if (recognizer && key === recognizerKey) return;

  if (!model || modelLoadedSize !== size) {
    model?.free();
    model = new vosk.Model(modelDir);
    modelLoadedSize = size;
  }
  recognizer?.free();
  recognizer = grammar
    ? new vosk.Recognizer({ model, sampleRate: 16000, grammar })
    : new vosk.Recognizer({ model, sampleRate: 16000 });
  recognizer.setWords(true);
  recognizer.setPartialWords(true);
  recognizerKey = key;
}

function teardown(): void {
  recognizer?.free(); recognizer = null; recognizerKey = '';
  model?.free(); model = null; modelLoadedSize = null;
}

parentPort?.on('message', (msg: any) => {
  try {
    if (msg?.type === 'configure') {
      ensureRecognizer(msg.modelDir, msg.size, msg.grammar);
      return;
    }
    if (msg?.type === 'frame') {
      if (!recognizer) return; // configure hasn't landed yet (or teardown already ran) — drop, same as before
      const buffer = Buffer.from(msg.buffer);
      const isUtteranceEnd = recognizer.acceptWaveform(buffer);
      if (isUtteranceEnd) {
        parentPort?.postMessage({ type: 'final', raw: recognizer.result() });
      } else {
        parentPort?.postMessage({ type: 'partial', raw: recognizer.partialResult() });
      }
      return;
    }
    if (msg?.type === 'teardown') {
      teardown();
      return;
    }
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', message: err?.message || String(err) });
  }
});
