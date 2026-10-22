// electron/oauth-login.ts — "Login with Kick/Twitch" (2026-10-20, direct
// request: "an alternative way to login to the desktop app, like an actual
// flow for kick or twitch, instead of relying explicitly on an api key").
//
// This app's one real credential is a Bearer token checked against
// `session_token OR access_token` on platform_accounts
// (middleware/authenticateKickOrApiKey.js on the server) — a KickPulse API
// key is just one way to get a value into that slot; a REAL session_token
// from actually logging in works exactly as well, with zero server changes
// needed for the auth check itself. So this does the exact same OAuth
// dance the website's own Home.tsx/KickAuthCallback.tsx/
// TwitchAuthCallback.tsx already do, then hands the resulting
// session_token to this app's own existing saveApiKey/connectAccount path
// — same slot, same auth check, it just never found out the string came
// from a real login instead of Settings → API Keys.
//
// Mechanics: a real BrowserWindow (so Kick/Twitch's own login page renders
// normally — no hidden webview, the person actually sees and interacts
// with the real page) loads the real authorize URL, using the EXACT same
// registered redirect_uri the website uses
// (https://www.kickpulsebot.com/auth/kick|twitch/callback) — there is no
// separate redirect URI to register with Kick/Twitch's own OAuth app
// config. Once the window navigates there, the code/state are pulled
// straight off that URL before the real website page ever finishes
// loading, and the window closes — this app never lets the real callback
// SPA page run at all, it does its own equivalent of what that page does
// (exchange the code, call the same Supabase RPC), just from the main
// process instead of a browser tab.
import { BrowserWindow } from 'electron';
import crypto from 'node:crypto';

const WEBSITE = 'https://www.kickpulsebot.com';

// Same public anon key the real website's own bundle embeds (not a secret
// — see src/lib/supabase.ts's own comment on this exact pair) — used here
// via a plain REST call instead of the JS SDK, since the main process has
// no reason to pull in the whole supabase-js client for one RPC call.
const SUPABASE_URL = 'https://blqnhiatjjzuqpujhdmr.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJscW5oaWF0amp6dXFwdWpoZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2MDUxMDAsImV4cCI6MjA4MzE4MTEwMH0.Q2WKOKEIWJl1bT3GJZ-Mu0UQftUQ7mIXc4jUAUwneHI';

const KICK_SCOPES = [
  'user:read', 'channel:read', 'channel:write', 'channel:rewards:read', 'channel:rewards:write',
  'chat:write', 'streamkey:read', 'events:subscribe', 'moderation:ban', 'moderation:chat_message:manage', 'kicks:read',
].join(' ');

// Mirrors src/lib/auth.ts's own getTwitchAuthUrl() scope list exactly.
const TWITCH_SCOPES = [
  'user:read:email', 'channel:read:subscriptions', 'bits:read', 'channel:read:hype_train',
  'channel:read:polls', 'channel:manage:polls', 'channel:read:predictions', 'channel:manage:predictions',
  'channel:read:redemptions', 'channel:manage:redemptions', 'channel:read:goals', 'channel:read:charity',
  'moderator:read:shoutouts', 'moderator:manage:shoutouts', 'moderator:read:shield_mode', 'moderator:manage:shield_mode',
  'channel:read:ads', 'channel:manage:ads', 'channel:read:vips', 'channel:manage:vips',
  'moderator:read:followers', 'channel:manage:raids', 'channel:read:guest_star', 'user:read:broadcast',
  'channel:manage:broadcast', 'moderator:manage:banned_users', 'user:bot', 'channel:bot',
].join(' ');

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function generateVerifier(): string { return base64url(crypto.randomBytes(32)); }
function generateChallenge(verifier: string): string { return base64url(crypto.createHash('sha256').update(verifier).digest()); }
function generateState(): string { return base64url(crypto.randomBytes(24)); }

async function fetchClientIds(): Promise<{ kickClientId: string | null; twitchClientId: string | null }> {
  try {
    const r = await fetch(`${WEBSITE}/auth/client-ids`);
    if (!r.ok) return { kickClientId: null, twitchClientId: null };
    return (await r.json()) as any;
  } catch {
    return { kickClientId: null, twitchClientId: null };
  }
}

// Opens a real, visible login window and resolves with the callback URL's
// query params the moment navigation reaches `redirectUri` — never lets
// the real website's own callback SPA page actually load/run.
function waitForOAuthRedirect(authUrl: string, redirectUri: string): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480,
      height: 720,
      title: 'Log in',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      try { win.close(); } catch {}
    };
    const checkUrl = (url: string) => {
      if (!url.startsWith(redirectUri)) return;
      try {
        finish(() => resolve(new URL(url).searchParams));
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    };

    win.webContents.on('will-redirect', (_e, url) => checkUrl(url));
    win.webContents.on('will-navigate', (_e, url) => checkUrl(url));
    win.webContents.on('did-navigate', (_e, url) => checkUrl(url));
    win.on('closed', () => finish(() => reject(new Error('Login window was closed before finishing'))));

    win.loadURL(authUrl).catch((e) => finish(() => reject(e)));
  });
}

async function readErrorMessage(r: Response): Promise<string | undefined> {
  try {
    const body: any = await r.json();
    return body?.error;
  } catch {
    return undefined;
  }
}

async function exchangeKickCode(code: string, codeVerifier: string, redirectUri: string): Promise<{ tokens: any; user: any }> {
  const r = await fetch(`${WEBSITE}/auth/kick/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });
  if (!r.ok) throw new Error((await readErrorMessage(r)) || 'Kick token exchange failed');
  return r.json() as Promise<any>;
}

async function exchangeTwitchCode(code: string, redirectUri: string): Promise<{ tokens: any; user: any }> {
  const r = await fetch(`${WEBSITE}/auth/twitch/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!r.ok) throw new Error((await readErrorMessage(r)) || 'Twitch token exchange failed');
  return r.json() as Promise<any>;
}

// Same SECURITY DEFINER RPC the website's own callbacks call directly from
// the browser (see KickAuthCallback.tsx/TwitchAuthCallback.tsx) — handing
// back session_token straight from the RPC response is the whole point of
// the 2026-09-29 session_token-anon-exposure fix (CLAUDE.md's own writeup),
// so no separate anon SELECT is ever needed here either.
async function findOrCreatePlatformUser(params: Record<string, unknown>): Promise<{ userId: string | null; sessionToken: string | null }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_or_create_platform_user`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(await r.text().catch(() => 'Account lookup failed'));
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { userId: row?.user_id ?? null, sessionToken: row?.session_token ?? null };
}

export async function loginWithKick(): Promise<string> {
  const { kickClientId } = await fetchClientIds();
  if (!kickClientId) throw new Error('Kick login is not configured on the server right now');

  const codeVerifier = generateVerifier();
  const codeChallenge = generateChallenge(codeVerifier);
  const state = generateState();
  const redirectUri = `${WEBSITE}/auth/kick/callback`;

  const authUrl = `https://id.kick.com/oauth/authorize?${new URLSearchParams({
    client_id: kickClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: KICK_SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256',
  })}`;

  const params = await waitForOAuthRedirect(authUrl, redirectUri);
  const error = params.get('error');
  if (error) throw new Error(`Kick login failed (${error})`);
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new Error('Kick login failed — invalid response');

  const { tokens, user } = await exchangeKickCode(code, codeVerifier, redirectUri);
  if (!user) throw new Error('No Kick user data returned');
  const platformUserId = String(user.user_id);
  const username = user.username || user.name || '';

  const { sessionToken } = await findOrCreatePlatformUser({
    p_platform: 'kick',
    p_platform_user_id: platformUserId,
    p_username: username,
    p_display_name: user.display_name || username,
    p_profile_picture: user.profile_picture || null,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_in: tokens.expires_in || 3600,
    p_referral_code: null,
  });
  if (!sessionToken) throw new Error('Login succeeded but no session token was returned');
  return sessionToken;
}

// linkKick/linkTwitch (2026-10-22, native Connections page — direct
// feedback: "I want the settings and connections page on the desktop app
// to be actually on the app. Not loading the site.") — same real
// BrowserWindow OAuth dance as loginWithKick/loginWithTwitch above, but
// calls link_platform_account instead of find_or_create_platform_user:
// attaches the platform to the ALREADY-logged-in desktop session's own
// userId instead of resolving/creating a (possibly different) one. Mirrors
// the website's own Settings.tsx "Connect Twitch"/"Connect Kick" buttons
// (src/lib/auth.ts's getKickAuthUrl/getTwitchAuthUrl + KickAuthCallback.tsx/
// TwitchAuthCallback.tsx's own link-vs-fresh-login branch) — same RPC, same
// params, just called directly from the main process instead of a browser
// callback page.
async function linkPlatformAccount(params: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/link_platform_account`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(await r.text().catch(() => 'Failed to link account'));
}

export async function linkKick(userId: string): Promise<void> {
  const { kickClientId } = await fetchClientIds();
  if (!kickClientId) throw new Error('Kick login is not configured on the server right now');

  const codeVerifier = generateVerifier();
  const codeChallenge = generateChallenge(codeVerifier);
  const state = generateState();
  const redirectUri = `${WEBSITE}/auth/kick/callback`;

  const authUrl = `https://id.kick.com/oauth/authorize?${new URLSearchParams({
    client_id: kickClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: KICK_SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256',
  })}`;

  const params = await waitForOAuthRedirect(authUrl, redirectUri);
  const error = params.get('error');
  if (error) throw new Error(`Kick login failed (${error})`);
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new Error('Kick login failed — invalid response');

  const { tokens, user } = await exchangeKickCode(code, codeVerifier, redirectUri);
  if (!user) throw new Error('No Kick user data returned');
  const username = user.username || user.name || '';

  await linkPlatformAccount({
    p_user_id: userId,
    p_platform: 'kick',
    p_platform_user_id: String(user.user_id),
    p_username: username,
    p_display_name: user.display_name || username,
    p_profile_picture: user.profile_picture || null,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_in: tokens.expires_in || 3600,
  });
}

export async function linkTwitch(userId: string): Promise<void> {
  const { twitchClientId } = await fetchClientIds();
  if (!twitchClientId) throw new Error('Twitch login is not configured on the server right now');

  const state = generateState();
  const redirectUri = `${WEBSITE}/auth/twitch/callback`;

  const authUrl = `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({
    client_id: twitchClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: TWITCH_SCOPES, state, force_verify: 'true',
  })}`;

  const params = await waitForOAuthRedirect(authUrl, redirectUri);
  const error = params.get('error');
  if (error) throw new Error(`Twitch login failed (${error})`);
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new Error('Twitch login failed — invalid response');

  const { tokens, user } = await exchangeTwitchCode(code, redirectUri);
  if (!user) throw new Error('No Twitch user data returned');
  const username = user.login || user.display_name || '';

  await linkPlatformAccount({
    p_user_id: userId,
    p_platform: 'twitch',
    p_platform_user_id: String(user.id),
    p_username: username,
    p_display_name: user.display_name || username,
    p_profile_picture: user.profile_image_url || null,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_in: tokens.expires_in || 3600,
  });
}

// connectCustomBotKick/connectCustomBotTwitch (2026-10-22, native Connections
// page) — "bring your own bot account" (Ultimate-gated), mirroring the
// website's own getKickBotAuthUrl('custom')/getTwitchBotAuthUrl('custom')
// (src/lib/auth.ts) + POST /bot-identity/save, but done here as a real
// BrowserWindow round trip instead of a browser redirect, same pattern as
// loginWithKick/linkKick above. Requires the app's own apiKey (Bearer
// credential) to call /bot-identity/save, which is Ultimate-gate-checked
// server-side regardless of what this sends.
const KICK_BOT_SCOPES = 'user:read chat:write moderation:ban moderation:chat_message:manage';
const TWITCH_BOT_SCOPES = ['user:read:email', 'user:bot', 'user:write:chat', 'moderator:manage:banned_users', 'moderator:manage:chat_messages'].join(' ');

async function saveBotIdentity(apiKey: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${WEBSITE}/bot-identity/save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await readErrorMessage(r)) || 'Failed to connect bot account');
}

export async function connectCustomBotKick(apiKey: string): Promise<void> {
  const { kickClientId } = await fetchClientIds();
  if (!kickClientId) throw new Error('Kick login is not configured on the server right now');

  const codeVerifier = generateVerifier();
  const codeChallenge = generateChallenge(codeVerifier);
  const state = generateState();
  const redirectUri = `${WEBSITE}/auth/kick/callback`;

  const authUrl = `https://id.kick.com/oauth/authorize?${new URLSearchParams({
    client_id: kickClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: KICK_BOT_SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256',
  })}`;

  const params = await waitForOAuthRedirect(authUrl, redirectUri);
  const error = params.get('error');
  if (error) throw new Error(`Bot connect failed (${error})`);
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new Error('Bot connect failed — invalid response');

  const { tokens, user } = await exchangeKickCode(code, codeVerifier, redirectUri);
  if (!user) throw new Error('No Kick user data returned');
  const username = user.username || user.name || '';

  await saveBotIdentity(apiKey, {
    platform: 'kick',
    platformUserId: String(user.user_id),
    username,
    displayName: user.display_name || username,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in || 3600,
  });
}

export async function connectCustomBotTwitch(apiKey: string): Promise<void> {
  const { twitchClientId } = await fetchClientIds();
  if (!twitchClientId) throw new Error('Twitch login is not configured on the server right now');

  const state = generateState();
  const redirectUri = `${WEBSITE}/auth/twitch/callback`;

  const authUrl = `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({
    client_id: twitchClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: TWITCH_BOT_SCOPES, state, force_verify: 'true',
  })}`;

  const params = await waitForOAuthRedirect(authUrl, redirectUri);
  const error = params.get('error');
  if (error) throw new Error(`Bot connect failed (${error})`);
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new Error('Bot connect failed — invalid response');

  const { tokens, user } = await exchangeTwitchCode(code, redirectUri);
  if (!user) throw new Error('No Twitch user data returned');
  const username = user.login || user.display_name || '';

  await saveBotIdentity(apiKey, {
    platform: 'twitch',
    platformUserId: String(user.id),
    username,
    displayName: user.display_name || username,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in || 3600,
  });
}

export async function loginWithTwitch(): Promise<string> {
  const { twitchClientId } = await fetchClientIds();
  if (!twitchClientId) throw new Error('Twitch login is not configured on the server right now');

  const state = generateState();
  const redirectUri = `${WEBSITE}/auth/twitch/callback`;

  const authUrl = `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({
    client_id: twitchClientId, redirect_uri: redirectUri, response_type: 'code',
    scope: TWITCH_SCOPES, state, force_verify: 'true',
  })}`;

  const params = await waitForOAuthRedirect(authUrl, redirectUri);
  const error = params.get('error');
  if (error) throw new Error(`Twitch login failed (${error})`);
  const code = params.get('code');
  if (!code || params.get('state') !== state) throw new Error('Twitch login failed — invalid response');

  const { tokens, user } = await exchangeTwitchCode(code, redirectUri);
  if (!user) throw new Error('No Twitch user data returned');
  const platformUserId = String(user.id);
  const username = user.login || user.display_name || '';

  const { sessionToken } = await findOrCreatePlatformUser({
    p_platform: 'twitch',
    p_platform_user_id: platformUserId,
    p_username: username,
    p_display_name: user.display_name || username,
    p_profile_picture: user.profile_image_url || null,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_in: tokens.expires_in || 3600,
    p_referral_code: null,
  });
  if (!sessionToken) throw new Error('Login succeeded but no session token was returned');
  return sessionToken;
}
