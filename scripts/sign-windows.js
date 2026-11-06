// scripts/sign-windows.js — electron-builder's win.signtoolOptions.sign
// custom hook (2026-11-06). Routes every Windows exe electron-builder
// wants to sign (the packaged app exe AND the final NSIS installer/
// uninstaller) through Azure Trusted Signing via the `sign` dotnet global
// tool, authenticated through this machine's own `az login` session
// (-act azure-cli), not a service principal/env-var credential — the same
// real, already-working setup used for Obzidian's own signed app. A
// Certificate Profile is a verified publisher identity, not tied to one
// app, so this reuses that exact account/profile rather than provisioning
// a new Azure resource.
//
// electron-builder normally asks to sign each file twice (sha1 + sha256,
// legacy dual-signing for old Windows) — turned off via
// signingHashAlgorithms: ['sha256'] in package.json's win.signtoolOptions,
// since `sign` has no signtool.exe-style "/as" append-signature mode;
// calling it twice would just overwrite the first signature, not append
// to it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SIGN_ENDPOINT = 'https://eus.codesigning.azure.net/';
const SIGN_ACCOUNT = 'obzidian';
const SIGN_PROFILE = 'ObzidianPublicTrust';

// Defensive PATH prepend — the two real gotchas hit setting this up for
// Obzidian on a fresh/non-interactive shell (dotnet global tools and the
// Azure CLI aren't always already on PATH there).
function withToolsOnPath() {
  const env = { ...process.env };
  const dotnetTools = path.join(process.env.USERPROFILE || '', '.dotnet', 'tools');
  const azCli = 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin';
  env.PATH = [dotnetTools, azCli, env.PATH || ''].join(path.delimiter);
  return env;
}

exports.sign = async function sign(configuration) {
  const filePath = configuration.path;
  console.log(`[sign-windows] Azure Trusted Signing: ${filePath}`);
  // No shell:true — `sign` resolves to a real sign.exe (not a .cmd shim),
  // and shell:true concatenates args into one unescaped string, which
  // breaks on the spaces in "KickPulse Desktop.exe" / "KickPulse Desktop".
  execFileSync('sign', [
    'code', 'artifact-signing', filePath,
    '-ase', SIGN_ENDPOINT,
    '-asa', SIGN_ACCOUNT,
    '-ascp', SIGN_PROFILE,
    '-act', 'azure-cli',
    '-d', 'KickPulse Desktop',
    '-u', 'https://github.com/HerbalSalad/kickpulse-desktop',
  ], { stdio: 'inherit', env: withToolsOnPath() });
};
