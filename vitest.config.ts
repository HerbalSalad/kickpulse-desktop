// vitest.config.ts — a separate, minimal config from vite.config.ts (which
// builds the React renderer). Tests run against electron/*.ts directly in
// Node, not through the renderer build at all — obs-client.ts and
// meld-client.ts have no Electron-API dependency of their own (no `import
// 'electron'`), so they run fine standalone with just their one external
// client library (obs-websocket-js / qwebchannel+ws) mocked out.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts'],
  },
});
