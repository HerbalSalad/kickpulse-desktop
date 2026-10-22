// scripts/dev.js — dev orchestration: compiles the Electron main/preload
// process (tsc --watch), starts the Vite dev server for the renderer, then
// launches the real `electron` binary pointed at the compiled main process,
// with VITE_DEV_SERVER_URL telling it where to load windows from.
//
// Hand-rolled instead of a vite-plugin-electron-style plugin on purpose —
// fewer unfamiliar moving parts while this project is this new; every piece
// here (tsc --watch, the vite CLI, require('electron') resolving to the
// real binary path) is a long-stable, well-understood API.

const { spawn } = require('node:child_process');
const path = require('node:path');
const electronPath = require('electron');

// Modern package `exports` maps block arbitrary subpath requires like
// 'vite/bin/vite.js' or 'typescript/bin/tsc' even though those files really
// exist — only whatever the package explicitly exports is reachable that
// way. package.json itself is conventionally always exported though, so
// reading its own declared `bin` field and joining that onto the package's
// real directory sidesteps the restriction entirely.
function binPath(pkg) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const pkgJson = require(pkgJsonPath);
  const rel = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
  return path.join(path.dirname(pkgJsonPath), rel);
}

function spawnLabeled(cmd, args, label) {
  // No `shell: true` here on purpose — spawning an absolute executable path
  // (process.execPath) via an argv array needs no shell at all, and adding
  // one on Windows actually breaks it: cmd.exe re-splits "C:\Program Files\..."
  // on the space inside the path, which is exactly the bug this comment is
  // here to stop someone from reintroducing.
  const p = spawn(cmd, args);
  p.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
  return p;
}

let electronProcess = null;

function startElectron(devServerUrl) {
  if (electronProcess) {
    electronProcess.removeAllListeners('exit');
    electronProcess.kill();
  }
  electronProcess = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
  });
  electronProcess.on('exit', (code) => {
    console.log(`[electron] exited (${code})`);
    cleanupAndExit(code ?? 0);
  });
}

let tscWatch = null;
let vite = null;

function cleanupAndExit(code) {
  tscWatch?.kill();
  vite?.kill();
  process.exit(code);
}

async function main() {
  console.log('[dev] compiling electron main/preload…');
  tscWatch = spawnLabeled(
    process.execPath,
    [binPath('typescript'), '-p', 'electron/tsconfig.build.json', '--watch', '--preserveWatchOutput'],
    'tsc'
  );

  // Wait for the first successful compile before starting Electron or Vite.
  await new Promise((resolve, reject) => {
    const onData = (d) => {
      const text = d.toString();
      if (/Found 0 errors/.test(text)) {
        tscWatch.stdout.off('data', onData);
        resolve();
      } else if (/error TS\d+/.test(text)) {
        // Still let it keep watching (tsc reports this on every run with
        // errors), but we don't resolve on error alone — only a genuine
        // zero-error compile starts Electron.
      }
    };
    tscWatch.stdout.on('data', onData);
    tscWatch.on('error', reject);
  });

  console.log('[dev] starting Vite dev server…');
  vite = spawnLabeled(process.execPath, [binPath('vite')], 'vite');

  const devServerUrl = await new Promise((resolve) => {
    const onData = (d) => {
      // Vite colorizes its own output with ANSI escape codes that can land
      // *inside* a literal word (e.g. "Local" + ESC[22m + ":"), so a regex
      // anchored to "Local:" as contiguous text can silently never match —
      // strip escape codes first, and only look for the bare URL itself,
      // which is never split up this way.
      const text = d.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const m = text.match(/(https?:\/\/localhost:\d+\/?)/);
      if (m) {
        vite.stdout.off('data', onData);
        resolve(m[1].endsWith('/') ? m[1] : `${m[1]}/`);
      }
    };
    vite.stdout.on('data', onData);
  });

  console.log(`[dev] renderer ready at ${devServerUrl}`);
  startElectron(devServerUrl);

  // Any later successful recompile (a main-process file changed) restarts
  // Electron with the same dev server URL.
  tscWatch.stdout.on('data', (d) => {
    if (/Found 0 errors/.test(d.toString())) {
      console.log('[dev] main process changed — restarting Electron…');
      startElectron(devServerUrl);
    }
  });

  process.on('SIGINT', () => cleanupAndExit(0));
}

main().catch((err) => {
  console.error('[dev] failed to start:', err);
  cleanupAndExit(1);
});
