// electron/webview-preload.ts — injected into the REAL website when it's
// loaded inside one of this app's own <webview> tags (WidgetEditorPage.tsx,
// ScenesPage.tsx, AlertStudioPage.tsx, OverlayStudioPage.tsx,
// WidgetStudioPage.tsx — see each page's own `preload` attribute), NOT into
// this app's own pages (those use preload.ts). Gives the website's own
// MediaPicker.tsx a real "browse a file on this PC" option, the one thing
// genuinely lost when those editors stopped being a second, hand-built
// native form and started embedding the real website page directly — see
// WidgetEditorPage.tsx's own header for that history, and direct feedback:
// "not sure what you are talking about the local file stuff. Make it work,
// make it make sense."
//
// contextBridge here exposes a plain, non-secret marker + one async
// function to the GUEST page's own JS — the website only shows its extra
// button when `window.kickpulseDesktopBridge?.isDesktopApp` is true, so
// this has zero effect on a normal browser visitor to the real site.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kickpulseDesktopBridge', {
  isDesktopApp: true,
  // Round-trips through the HOST page (the <webview>'s own ipc-message
  // listener — see src/lib/webviewBridge.ts), which is what actually owns
  // the dialog.showOpenDialog()/local media server call; this preload has
  // no access to either on its own. requestId pairs this call's own
  // response back to THIS call specifically, in case the website ever
  // fires two browseLocalFile() calls close together.
  browseLocalFile: (): Promise<string | null> => {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const onResponse = (_e: Electron.IpcRendererEvent, payload: { requestId: string; url: string | null }) => {
        if (payload.requestId !== requestId) return;
        ipcRenderer.off('local-file-chosen', onResponse);
        resolve(payload.url);
      };
      ipcRenderer.on('local-file-chosen', onResponse);
      ipcRenderer.sendToHost('browse-local-file', requestId);
    });
  },
});
