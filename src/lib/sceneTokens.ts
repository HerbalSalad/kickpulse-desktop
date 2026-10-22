// src/lib/sceneTokens.ts — ported verbatim (logic, not comments) from the
// website's useScenes.ts/useAlertStudio.ts: the generic {username}/{amount}/
// {message}/{viewers}/{reward} substitution a Pulse Scene's text/media
// elements use. A Scene is fired by an arbitrary Pulse Engine trigger with
// no "which of 12 alert kinds" concept at all, so this is the flat token
// vocabulary — same one Pulse Engine's own bot_message action substitutes.

import type { CounterElement, SceneFirePayload } from './sceneTypes';

export function resolveSceneTokens(payload: SceneFirePayload): Record<string, string> {
  return {
    '{username}': payload.username || 'Someone',
    '{amount}':   String(payload.amount ?? ''),
    '{message}':  payload.message || '',
    '{viewers}':  String(payload.viewers ?? ''),
    '{reward}':   payload.reward || '',
    ...(payload.extraTokens || {}),
  };
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function applyVariableCase(val: string, mode?: 'none' | 'upper' | 'lower' | 'capitalize'): string {
  switch (mode) {
    case 'upper': return val.toUpperCase();
    case 'lower': return val.toLowerCase();
    case 'capitalize': return val.replace(/\b\w/g, (c) => c.toUpperCase());
    default: return val;
  }
}

// Returns an HTML string — literal template text passes through unescaped
// (it's the streamer's own typed text, rendered only in their own overlay),
// substituted VALUES are HTML-escaped and wrapped in a colored span so a
// viewer-controlled username etc. can never break the markup.
export function applyTemplateTokens(
  template: string, tokens: Record<string, string>,
  variableColor: string, variableCase?: 'none' | 'upper' | 'lower' | 'capitalize',
  rainbow?: boolean, rainbowSpeed?: number,
): string {
  let out = template || '';
  const openTag = rainbow
    ? `<span class="sc-var-rainbow" style="color:#ff2ec2;font-weight:900;animation-duration:${Math.max(0.3, rainbowSpeed || 2.5)}s">`
    : `<span style="color:#${variableColor};font-weight:900">`;
  for (const [token, val] of Object.entries(tokens)) {
    if (!out.includes(token)) continue;
    const span = `${openTag}${escapeHtml(applyVariableCase(val, variableCase))}</span>`;
    out = out.split(token).join(span);
  }
  return out;
}

export function buildSceneText(
  template: string, payload: SceneFirePayload,
  variableColor: string, variableCase?: 'none' | 'upper' | 'lower' | 'capitalize',
  rainbow?: boolean, rainbowSpeed?: number,
): string {
  return applyTemplateTokens(template, resolveSceneTokens(payload), variableColor, variableCase, rainbow, rainbowSpeed);
}

// A Media element's `url` can ALSO be (or contain) a {token} — resolved the
// same way text is, just swapped in as a plain value (not HTML-escaped/
// wrapped — a URL isn't rendered as visible text).
export function resolveSceneMediaUrl(url: string, payload: SceneFirePayload): string {
  if (!url || !url.includes('{')) return url;
  const tokens = resolveSceneTokens(payload);
  let out = url;
  for (const [token, val] of Object.entries(tokens)) {
    if (out.includes(token)) out = out.split(token).join(val);
  }
  return out;
}

export function resolveSceneCounterTarget(el: CounterElement, payload: SceneFirePayload): number {
  if (el.source === 'fixed') return el.fixedValue || 0;
  if (el.source === 'viewers') return Number(payload.viewers) || 0;
  // 'months' has no equivalent in Pulse Scenes' own flat token vocabulary
  // (nothing fires a scene with a real month count) — but Alert Studio's
  // resub kinds DO set payload.months (see sceneTypes.ts's SceneFirePayload),
  // so this now reads it when present instead of always returning 0.
  if (el.source === 'months') return Number(payload.months) || 0;
  return Number(payload.amount) || 0; // 'amount'
}
