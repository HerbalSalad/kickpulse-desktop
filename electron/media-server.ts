// electron/media-server.ts — the actual mechanism behind "use locally
// hosted files." A tiny HTTP server bound to 127.0.0.1 that serves
// user-picked local files by a stable id — turning a local file path into
// a real http:// URL that ANY widget's existing "paste a URL" field
// (on the real website, or embedded in this app) can reference directly,
// with zero website-side changes needed at all.
//
// The port is deliberately FIXED, not auto-assigned/ephemeral — a local
// media URL gets pasted into a widget config and persisted on the website,
// so it has to keep resolving to the same port across app restarts, or
// every previously-configured reference would silently break. If the fixed
// port is already taken by something else, this surfaces a real error
// rather than silently falling back to a different port that would break
// already-saved URLs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { LocalMediaItem, MediaServerInfo } from './types';

const PORT = 47832;

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

let server: http.Server | null = null;

export function startMediaServer(getLibrary: () => LocalMediaItem[]): Promise<MediaServerInfo> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve({ port: PORT, baseUrl: `http://127.0.0.1:${PORT}` });
      return;
    }

    const srv = http.createServer((req, res) => {
      // CORS: a widget config's own value (e.g. this URL referenced from a
      // real OBS Browser Source) is a plain cross-origin <img>/<video>/
      // <audio> src — those don't need CORS headers to display at all.
      // This header only matters for the rare case something tries to read the response via
      // fetch()/canvas, and costs nothing to allow for local-only content.
      res.setHeader('Access-Control-Allow-Origin', '*');

      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
      const match = url.pathname.match(/^\/media\/([^/]+)/);
      if (!match) {
        res.writeHead(404).end('Not found');
        return;
      }

      const item = getLibrary().find((i) => i.id === match[1]);
      if (!item) {
        res.writeHead(404).end('Unknown media id');
        return;
      }

      fs.stat(item.filePath, (err, stat) => {
        if (err) {
          res.writeHead(404).end('File missing on disk');
          return;
        }

        const ext = path.extname(item.filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const range = req.headers.range;

        // HTTP Range support matters for real playback — browsers/OBS
        // commonly seek video via Range requests, and a response that
        // doesn't support them can make a large local video fail to play
        // or scrub correctly.
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          const start = m && m[1] ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
          });
          fs.createReadStream(item.filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          });
          fs.createReadStream(item.filePath).pipe(res);
        }
      });
    });

    srv.on('error', (err) => {
      server = null;
      reject(err);
    });

    srv.listen(PORT, '127.0.0.1', () => {
      server = srv;
      resolve({ port: PORT, baseUrl: `http://127.0.0.1:${PORT}` });
    });
  });
}

export function mediaUrlFor(id: string): string {
  return `http://127.0.0.1:${PORT}/media/${id}`;
}

export function stopMediaServer(): void {
  server?.close();
  server = null;
}
