// src/lib/widgetCatalog.ts — the real widget catalog (names/descriptions/
// icons/premium flags), copied directly from kickpulse-new's own
// src/lib/widgetCatalog.ts, not invented — keep this in sync if a widget is
// added/renamed on the website.
//
// `table`/`hasBroadcasterIdColumn` (2026-10-18) — removed. WidgetEditorPage.tsx
// no longer reads a widget's config table directly (it embeds the real
// website settings page instead — see that file's own header), so `key`
// (which doubles as the real `/widgets/{key}/settings` route) is the only
// thing this catalog needs per widget now.

export interface WidgetDef {
  key: string;
  label: string;
  desc: string;
  icon: string;
  premium: boolean;
  category: string;
}

export const WIDGET_CATALOG: WidgetDef[] = [
  // ---- Free ----
  { key: 'alerts', label: 'Alert Box', desc: 'Animated alerts for follows, subs, gifts, raids, rewards and more. Fully customizable per event.', icon: '🔔', premium: false, category: 'Alerts & Events' },
  { key: 'chat', label: 'Chat Overlay', desc: 'Real-time Kick chat for OBS. Fully customizable — fonts, colors, badges, animations, emotes and more.', icon: '💬', premium: false, category: 'Chat & Text' },
  { key: 'goal-bar', label: 'Goal Bar', desc: 'Track subs, follows, or kicks toward a goal with a live progress bar, image reveal, or combo mode.', icon: '🎯', premium: false, category: 'Goals & Progress' },
  { key: 'spin-wheel', label: 'Spin Wheel', desc: 'Interactive spinning wheel for challenges or viewer raffles.', icon: '🎡', premium: false, category: 'Media & Fun' },
  { key: 'stream-timer', label: 'Stream Timer', desc: 'Uptime counter, countdown, stopwatch, or subathon timer. Reacts to subs, follows and more.', icon: '⏱️', premium: false, category: 'Utility' },
  { key: 'social-rotator', label: 'Social Rotator', desc: 'Cycles through your social handles on stream.', icon: '🔄', premium: false, category: 'Info & Displays' },
  { key: 'brand-rotator', label: 'Brand Rotator', desc: 'Proudly display your sponsors and affiliations.', icon: '🏷️', premium: false, category: 'Info & Displays' },
  { key: 'counter-display', label: 'Counter Display', desc: 'Show a live chatbot counter on your stream — deaths, wins, resets.', icon: '🔢', premium: false, category: 'Info & Displays' },
  { key: 'viewer-count', label: 'Viewer Count', desc: 'A small live viewer counter — platform icon plus number.', icon: '👁️', premium: false, category: 'Info & Displays' },
  { key: 'event-labels', label: 'Event Labels', desc: 'Last Follower, Last Sub, Last Gift and more — a compact readout.', icon: '🏷️', premium: false, category: 'Info & Displays' },
  { key: 'name-roller', label: 'Name Roller', desc: 'Slot-machine drum that spins through viewer names and lands on a winner.', icon: '🎰', premium: false, category: 'Media & Fun' },
  { key: 'kicks-rain', label: 'Kicks Rain', desc: 'Coins, stars, or confetti rain down your stream whenever someone gifts Kicks or cheers.', icon: '🪙', premium: false, category: 'Media & Fun' },
  { key: 'viewer-fight', label: 'Viewer Fight', desc: 'Viewers challenge each other to battles with !fight.', icon: '⚔️', premium: false, category: 'Media & Fun' },
  { key: 'scrolling-ticker', label: 'Scrolling Ticker', desc: 'Clean news-ticker bar showing latest sub, follower, gift sub and more.', icon: '📰', premium: false, category: 'Chat & Text' },
  { key: 'scrolling-chat', label: 'Scrolling Chat', desc: 'A horizontal chat crawl with full styling and multi-platform support.', icon: '💬', premium: false, category: 'Chat & Text' },
  { key: 'scrolling-announcements', label: 'Scrolling Announcements', desc: 'A ticker of your own messages — sponsor plugs, reminders, shoutouts.', icon: '📢', premium: false, category: 'Chat & Text' },
  { key: 'scrolling-commands', label: 'Scrolling Commands', desc: "Advertises your chat commands on a ticker, auto-pulled from Chat Bot.", icon: '📜', premium: false, category: 'Chat & Text' },
  { key: 'now-playing', label: 'Now Playing', desc: 'Live now-playing overlay fed by the Song Requests player.', icon: '💿', premium: false, category: 'Media & Fun' },
  { key: 'karaoke', label: 'Karaoke Lyrics', desc: 'Time-synced on-screen lyrics for whatever the Song Requests player plays.', icon: '🎤', premium: false, category: 'Media & Fun' },
  { key: 'shoutout', label: 'Shoutout Clip', desc: 'Shout out a streamer with !so and one of their clips plays on stream.', icon: '📣', premium: false, category: 'Info & Displays' },
  { key: 'emote-rain', label: 'Emote Rain', desc: 'Chat emotes animate across your stream — rain, explode, fountain, or bounce.', icon: '🌧️', premium: false, category: 'Media & Fun' },

  // ---- Premium ----
  { key: 'todo-list', label: 'To-Do List', desc: 'An on-stream checklist for your stream goals.', icon: '📋', premium: true, category: 'Info & Displays' },
  { key: 'community-spotlight', label: 'Community Spotlight', desc: 'A big, cinematic slideshow for community art, fan logos, or shoutouts.', icon: '✨', premium: true, category: 'Info & Displays' },
  { key: 'giveaway', label: 'Giveaway', desc: 'Raffle a real prize — viewers enter from chat, winner drawn fairly.', icon: '🎁', premium: true, category: 'Media & Fun' },
  { key: 'race', label: 'Race', desc: 'A duck race for your chat — viewers join with !race and pick a character.', icon: '🦆', premium: true, category: 'Media & Fun' },
  { key: 'slot-machine', label: 'Slot Machine', desc: 'A real 3-reel slot machine using your own emotes as symbols.', icon: '🎰', premium: true, category: 'Media & Fun' },
  { key: 'credits-roll', label: 'Credits Roll', desc: 'Movie-style end-of-stream credits built from your session.', icon: '🎞️', premium: true, category: 'Info & Displays' },
  { key: 'jumpscare-meter', label: 'Jumpscare Meter', desc: 'Subs and kicks fill a danger meter. When it maxes out, a fullscreen jumpscare fires.', icon: '💀', premium: true, category: 'Alerts & Events' },
  { key: 'hype-train', label: 'Hype Train', desc: 'Visual hype train progress tracker with real-time Kick & Twitch events.', icon: '🚂', premium: true, category: 'Alerts & Events' },
  { key: 'clip-player', label: 'Clip Player', desc: 'Load your Kick or Twitch clips, select favorites, get a looping OBS URL.', icon: '🎬', premium: true, category: 'Media & Fun' },
  { key: 'events-list', label: 'Events List', desc: 'Live ticker of stream events — follows, subs, gifts, kicks, raids and more.', icon: '📋', premium: true, category: 'Info & Displays' },
  { key: 'leaderboard', label: 'Leaderboard', desc: 'Live ranked leaderboard of your top gifters, followers, bits donors.', icon: '🏆', premium: true, category: 'Goals & Progress' },
  { key: 'hype-gauge', label: 'Hype Gauge', desc: 'Community energy meter that fills from events and drains over time.', icon: '⚡', premium: true, category: 'Alerts & Events' },
  { key: 'sub-burst', label: 'Sub Burst', desc: 'Explosive screen effects on every sub, resub, and gift bomb.', icon: '💥', premium: true, category: 'Alerts & Events' },
  { key: 'sub-constellation', label: 'Sub Constellation', desc: 'A night-sky overlay that grows with your community.', icon: '✨', premium: true, category: 'Alerts & Events' },
  { key: 'event-cup', label: 'Event Cup', desc: 'Kicks, bits, follows, subs, gifts all rain down and land in a cup.', icon: '🥤', premium: true, category: 'Alerts & Events' },
  { key: 'insert-coin', label: 'Insert Coin', desc: 'Old-school arcade starting-soon screen — chat messages insert coins.', icon: '🕹️', premium: true, category: 'Goals & Progress' },
  { key: 'progress-ring', label: 'Progress Ring', desc: 'A circular XP/stamina-style goal ring instead of a bar.', icon: '⭕', premium: true, category: 'Goals & Progress' },
  { key: 'moon-phase', label: 'Moon Phase', desc: 'A classic subathon visualized as a real waxing/waning moon.', icon: '🌙', premium: true, category: 'Goals & Progress' },
  { key: 'standby-screen', label: 'Standby Screen', desc: 'A fully customizable starting-soon / be-right-back / ending screen.', icon: '🛰️', premium: true, category: 'Media & Fun' },
  { key: 'character-id', label: 'GTA RP Character ID Card', desc: 'GTA RP fake-ID overlay for FiveM streamers.', icon: '🪪', premium: true, category: 'GTA RP' },
  { key: 'orb-rain', label: 'Orb Rain', desc: 'Path of Exile currency showers your stream on Kicks or cheers.', icon: '🔮', premium: true, category: 'Media & Fun' },
  { key: 'exile-id-card', label: 'Exile ID Card', desc: 'A Path of Exile character record card across 5 styles.', icon: '📜', premium: true, category: 'Media & Fun' },
  { key: 'active-chatters', label: 'Active Chatters', desc: 'Recently-active chatters shown as their own real profile pictures.', icon: '🧑‍🤝‍🧑', premium: true, category: 'Chat & Text' },
  { key: 'server-display', label: 'GTA RP Server Display', desc: 'GTA RP / FiveM server branding on stream.', icon: '🖥️', premium: true, category: 'GTA RP' },
  { key: 'wanted-level', label: 'Wanted Level', desc: 'GTA wanted-star meter — stars light up as chat/follows/subs build heat.', icon: '⭐', premium: true, category: 'GTA RP' },
  { key: 'mission-passed', label: 'Mission Passed', desc: 'GTA-style end-of-stream recap — Respect, Crew, Cash, Headshots.', icon: '🏁', premium: true, category: 'GTA RP' },
];

export function widgetForKey(key: string): WidgetDef | undefined {
  return WIDGET_CATALOG.find((w) => w.key === key);
}
