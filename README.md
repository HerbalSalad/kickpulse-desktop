# KickPulse Desktop

A full desktop app for KickPulse streamers: a HUD that plays jumpscares (and,
going forward, other live-triggered effects) directly on your screen, over
any game; a fully-fledged editor for your account — every widget, Overlay
Studio, Alert Studio — running right alongside it; real OBS control; local
file hosting for any widget; and, eventually, smart-light control.

## The core architecture decision

Rather than rebuild Overlay Studio, Alert Studio, and every one of
KickPulse's ~50 widget settings pages as native Electron code — weeks of
duplicate work, and double maintenance forever after every time the website
changes — **this app embeds the real website** for all configuration, and
only builds genuinely new native code for what the website structurally
can't do: draw over other apps, open a WebSocket to OBS, open a local HTTP
server, talk to hardware on your local network.

- **Overlay Studio / Alert Studio / Widgets catalog** → real
  `kickpulsebot.com` pages, loaded in an Electron `<webview>`, in their own
  persistent session. Log in once (same Kick/Twitch OAuth as the website),
  it stays logged in across restarts. Zero duplicate code; every future
  website feature just works here too, automatically.
- **The overlay itself, OBS control, local media, lights** → real native
  code, because only a native process can do these things at all.

## How auth works

Two genuinely separate credentials, for two separate purposes:
- **API key** (Dashboard → Settings → API Keys) — same mechanism the Stream
  Deck plugin uses. Lets this app *listen* for real-time triggers (a chat
  command, a Pulse Engine action, the Jumpscare Meter maxing out) over the
  same WS hub every OBS widget already uses.
- **Website login** (inside the embedded pages) — real Kick/Twitch OAuth,
  exactly like visiting the website directly. Lets you *edit* everything.

## Architecture

```
electron/
  main.ts            — app entry: windows, global hotkey, every IPC handler
  preload.ts          — contextBridge surface exposed to the overlay + shell
  overlay-window.ts   — the actual trick: one transparent, click-through,
                         always-on-top window, content swapped via IPC
  obs-client.ts        — persistent OBS WebSocket connection (obs-websocket-js)
  media-server.ts      — local HTTP server turning a picked file into a
                         stable http://127.0.0.1:<port>/media/<id> URL
  ws-client.ts         — subscribes to the same WS hub OBS widgets use
  api.ts               — thin client for the two /desktop/* endpoints
  store.ts             — local settings (API key, OBS connection, media library)
src/
  App.tsx              — the app shell: sidebar + content area
  components/
    Sidebar.tsx         — nav (Home / Overlay Studio / Alert Studio / Widgets
                          / OBS Control / Local Media / Lights)
    EmbeddedPage.tsx     — the <webview> wrapper used by every website page
  pages/
    HomePage.tsx         — account connect + jumpscare local override + test
    ObsControlPage.tsx   — OBS connect, live scene/source browser, manual control
    LocalMediaPage.tsx   — add/list/remove local files, copy their URL
    LightsPage.tsx        — stub, not built yet
  OverlayApp.tsx         — what renders inside the overlay window
```

Backend additions live in kickpulse-new, not here:
- `routes/desktop.js` — `GET /desktop/me` (identity + tier), `GET /desktop/
  jumpscare-config` (the streamer's own configured media), both gated by the
  same `authenticateKickOrApiKey` middleware the Stream Deck plugin's routes
  already use.

## Running it

```
npm install
npm run dev
```

Opens two windows: the always-on-top overlay (invisible until something
plays) and the main app shell. **Ctrl+Alt+J** fires the bundled sample clip
immediately, zero login required.

## What actually works right now (verified live, not just built)

- The overlay mechanism itself — a transparent, click-through, always-on-top
  window genuinely composites a full-screen video/image + audio over
  whatever else is on screen, confirmed via real screen capture.
- The full app shell — sidebar, page switching, native pages that don't
  crash or misrender.
- **The embedded dashboard** — confirmed live: Overlay Studio/Alert Studio/
  Widgets all load the real website (its own real sidebar, the real Widgets
  catalog, real widget cards) inside the app, in a persistent session.
- **OBS control** — connects to OBS's real WebSocket server, browses real
  scenes/sources, can switch scenes and toggle source visibility. Confirmed
  the connection attempt and graceful failure handling both work correctly
  (tested against OBS not running — surfaces a clear error, doesn't crash).
- **Local media hosting** — add a file, get a stable `http://127.0.0.1:
  47832/media/<id>` URL with HTTP Range support (so video actually streams/
  seeks correctly), pasteable into any widget's existing "paste a URL"
  field, on the website or in the embedded pages.
- Once connected (API key), a real jumpscare trigger from your actual
  stream (chat command, Pulse Engine action, meter maxing out) plays
  locally, using your local override if set, else whatever's configured on
  the website.

## Known limitations (being honest, not hiding them)

- **Fullscreen-exclusive games are not guaranteed to show the overlay** —
  the standard always-on-top trick works reliably over borderless/windowed
  games and the normal compositor; true exclusive fullscreen bypasses the
  compositor entirely and needs DirectX/OpenGL/Vulkan render-hooking (what
  MSI Afterburner/RTSS do) — fragile per engine, risks anti-cheat flags.
  Deliberately not attempted — this is the "easy half" on purpose.
- **OBS Game Capture won't show the overlay** — it hooks the game's own
  rendered frame directly, not other windows drawn on top of it by the
  compositor. *Display Capture* (or Window Capture of the desktop) will.
- **Primary monitor only** for the overlay window — no per-display overlays
  yet.
- **Chat can't trigger OBS actions yet** — the OBS *connection* and manual
  control are real and working; wiring a chat command / Pulse Engine rule
  to actually fire an OBS action needs a new Pulse Engine action type
  (broadcasting a new WS event this app would react to, the same way
  `jumpscare_trigger` already works) plus website-side UI to pick a
  scene/source — a real, separate next phase, not attempted this pass.
- **Lights not built at all** — Philips Hue first (most common among
  streamers), once started.
- **No installer/packaging** — `npm run dev` only. electron-builder for a
  real installable `.exe` is a near-term follow-up.
- **No system-tray/background mode** — closing the main window quits the
  whole app, including the overlay.
- **Only one Jumpscare Meter config is ever fetched** (the oldest one) — a
  config picker is a follow-up once someone actually has more than one.
- **Embedded webview security**: the embedded pages run with no preload and
  no elevated Electron APIs exposed to them — they behave like a normal
  isolated browser tab, same as visiting kickpulsebot.com directly.

## Next

- Chat → OBS action pipeline (new Pulse Engine action type + website picker
  UI + this app reacting to it — mirrors the jumpscare mechanism exactly).
- Philips Hue integration.
- Packaging + auto-update.
- Multi-monitor overlay windows.
- System tray / background mode.
- A config picker for Jumpscare Meter once multi-config is actually used.
