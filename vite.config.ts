import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Packaged production build loads index.html via Electron's loadFile()
  // (a file:// URL), not an http:// origin — Vite's default base ('/')
  // produces absolute asset paths like src="/assets/main-X.js", which
  // resolve to the filesystem ROOT under file://, not the HTML's own
  // directory. Every asset 404s, React never mounts, and the window just
  // shows its own plain background color — a real black-screen bug found
  // live (2026-10-25) because the earlier verification only checked that
  // background Node processes started, never actually looked at the
  // window's own content. './' makes every asset path relative instead,
  // which resolves correctly under BOTH file:// (packaged) and the dev
  // server's http://localhost (npm run dev) origin.
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
        voice: path.resolve(__dirname, 'voice.html'),
      },
    },
  },
});
