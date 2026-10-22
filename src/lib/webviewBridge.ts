// src/lib/webviewBridge.ts — shared by every page that embeds a real
// website page in a <webview> (WidgetEditorPage, ScenesPage, AlertStudioPage,
// OverlayStudioPage, WidgetStudioPage), so the website's own MediaPicker.tsx
// can offer a real "Browse on this PC" option. See electron/
// webview-preload.ts's own header for the full round-trip this completes.
import { useEffect, useState } from 'react';

export function useWebviewPreloadUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    window.kickpulseDesktop.getWebviewPreloadUrl().then(setUrl).catch(() => {});
  }, []);
  return url;
}

/** Returns a ref-callback to hand to a <webview>'s own `ref` prop. Handles
 *  the guest page's browseLocalFile() request (sent via
 *  ipcRenderer.sendToHost in webview-preload.ts) by opening this app's real
 *  native file dialog and sending the resulting URL back into the guest. */
export function useWebviewLocalFileBridge(): (el: any) => void {
  const [el, setEl] = useState<any>(null);
  useEffect(() => {
    if (!el) return;
    const handler = async (event: any) => {
      if (event.channel !== 'browse-local-file') return;
      const requestId = event.args?.[0];
      const url = await window.kickpulseDesktop.browseLocalFileForWebview();
      el.send('local-file-chosen', { requestId, url });
    };
    el.addEventListener('ipc-message', handler);
    return () => el.removeEventListener('ipc-message', handler);
  }, [el]);
  return setEl;
}
