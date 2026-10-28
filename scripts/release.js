#!/usr/bin/env node
// scripts/release.js — wraps the real build + electron-builder GitHub
// publish, fixing a real, recurring race (2026-10-28, after it hit FOUR
// releases in a row — v0.2.4, v0.2.5, v0.2.6, v0.2.7 — each needing a
// manual asset fix afterward).
//
// electron-builder's GitHub publisher uploads the installer, its
// .blockmap, and latest.yml in PARALLEL. When the release for this tag
// doesn't exist yet, more than one of those parallel tasks can race to
// call GitHub's own "create a release" endpoint at the same instant —
// GitHub accepts exactly one and rejects the rest with a 422 ("Published
// releases must have a valid tag" — a real, transient GitHub-side
// create-release race, not a bug in this repo's own code). Whichever
// upload(s) lost the race get silently dropped, and electron-builder's
// own process still exits 1 regardless — looking like total failure even
// though a PARTIAL release (missing one or more assets) already exists.
//
// Fix: create the release ourselves, empty, before electron-builder ever
// touches it. Every one of its parallel upload tasks then finds an
// already-existing release for this tag and just uploads straight into
// it — nobody races to CREATE it, because by then there's nothing left to
// create.
const { execSync } = require('node:child_process');
const pkg = require('../package.json');

const REPO = 'HerbalSalad/kickpulse-desktop';
const version = pkg.version;
const tag = `v${version}`;
const token = process.env.GH_TOKEN;

if (!token) {
  console.error('GH_TOKEN is not set — export it first, e.g.:');
  console.error('  PowerShell: $env:GH_TOKEN = & "C:\\Program Files\\GitHub CLI\\gh.exe" auth token');
  process.exit(1);
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function releaseExists() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  return res.ok;
}

async function createEmptyRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tag_name: tag, name: tag, draft: false, prerelease: false, generate_release_notes: true }),
  });
  if (!res.ok) {
    throw new Error(`Failed to pre-create release ${tag}: ${res.status} ${await res.text()}`);
  }
  console.log(`Pre-created release ${tag} (no assets yet) — electron-builder will upload straight into it.`);
}

(async () => {
  run('npm run build');

  if (await releaseExists()) {
    console.log(`Release ${tag} already exists — reusing it (electron-builder will just add/replace its assets).`);
  } else {
    await createEmptyRelease();
  }

  run('npx electron-builder --win --publish always');
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
