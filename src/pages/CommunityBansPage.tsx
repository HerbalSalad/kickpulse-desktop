// src/pages/CommunityBansPage.tsx — native port of the website's own
// src/pages/CommunityBans.tsx (2026-10-20, direct request: "we should have
// access to the community bans in the desktop app as well"). Same
// routes/communityBans.js endpoints, called through electron/api.ts like
// every other native page in this app (Moderation/Chat Alerts/Chat Bot) —
// not a website embed.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldAlert, Ban, ChevronDown, ChevronUp, Users, Plus, LogIn, LogOut, Flag, Trash2 } from 'lucide-react';
import { Page, Section, Tabs, Button, COLORS } from '../components/ui';

type Tab = 'bans' | 'flags' | 'squads' | 'settings';

interface CommunityBanEntry { id: string; username: string; reason: string; source: string | null; created_at: string; appliedStatus: 'banned' | 'not_found' | 'error' | 'unbanned' | null; threat?: { level: number; label: string; count: number }; }
interface ApplyResult { total: number; banned: number; notFound: number; errors: number; skipped: number; }
interface Squad { id: string; name: string; invite_code: string; created_by: string; memberCount: number; members: string[]; }
interface ViewerFlag { id: string; username: string; platform: string; category: string; reason: string | null; created_at: string; }

const FLAG_CATEGORIES = [
  { value: 'suspicious', label: 'Suspicious' },
  { value: 'harassment', label: 'Harassment / Bullying' },
  { value: 'hate_speech', label: 'Hate Speech / Slurs' },
  { value: 'spam', label: 'Spam' },
  { value: 'self_promo', label: 'Self Promo' },
  { value: 'ban_evasion', label: 'Ban Evasion' },
  { value: 'bot_viewbot', label: 'Bot / Viewbot' },
  { value: 'nsfw', label: 'NSFW' },
  { value: 'doxxing', label: 'Doxxing / Personal Info' },
  { value: 'threats', label: 'Threats' },
  { value: 'other', label: 'Other' },
];

export default function CommunityBansPage() {
  const [tab, setTab] = useState<Tab>('bans');

  const [entries, setEntries] = useState<CommunityBanEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showList, setShowList] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // minDistinctBansFilter / applyMinDistinctBans (2026-10-27) — ported from
  // the website's own CommunityBans.tsx, direct report: "there is a way to
  // filter by distinct ban amount, but the number shown isn't listed
  // anywhere, there is no select all button... make it a bit easier and
  // more clear for the user so they know what all they are banning when
  // selecting a distinct amount of bans." minDistinctBansFilter is a
  // client-side-only LIST view filter (resets on reload); applyMinDistinctBans
  // is the persisted setting that actually gates the bulk "Apply All" button
  // (routes/communityBans.js's /settings, already accepts this app's API
  // key — no server changes needed, this page just never exposed either of
  // these). Clicking an Apply All Threshold option below also syncs the
  // list filter to match, so you SEE exactly who you're about to ban instead
  // of picking a threshold blind.
  const [minDistinctBansFilter, setMinDistinctBansFilter] = useState(1);
  const [applyMinDistinctBans, setApplyMinDistinctBans] = useState(1);
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<ApplyResult | null>(null);

  const [squads, setSquads] = useState<Squad[] | null>(null);
  const [newSquadName, setNewSquadName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const [flags, setFlags] = useState<ViewerFlag[] | null>(null);
  const [flagUsername, setFlagUsername] = useState('');
  const [flagCategory, setFlagCategory] = useState('suspicious');
  const [flagReason, setFlagReason] = useState('');

  const [minThreatLevel, setMinThreatLevel] = useState(2);

  const load = useCallback(() => {
    window.kickpulseDesktop.communityBans.list().then(d => setEntries(d.entries || [])).catch(() => setEntries([]));
  }, []);
  const loadSquads = useCallback(() => {
    window.kickpulseDesktop.communityBans.getSquads().then(d => setSquads(d.squads || [])).catch(() => {});
  }, []);
  const loadFlags = useCallback(() => {
    window.kickpulseDesktop.communityBans.getFlags().then(d => setFlags(d.flags || [])).catch(() => {});
  }, []);
  const loadSettings = useCallback(() => {
    window.kickpulseDesktop.communityBans.getSettings().then(s => {
      setMinThreatLevel(s.minThreatLevelToWarn);
      setApplyMinDistinctBans(s.applyMinDistinctBans ?? 1);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); loadSquads(); loadFlags(); loadSettings(); }, [load, loadSquads, loadFlags, loadSettings]);

  const categories = useMemo(() => {
    if (!entries) return [];
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.source || 'uncategorized', (counts.get(e.source || 'uncategorized') || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    let out = categoryFilter ? entries.filter(e => (e.source || 'uncategorized') === categoryFilter) : entries;
    if (minDistinctBansFilter > 1) out = out.filter(e => (e.threat?.count ?? 0) >= minDistinctBansFilter);
    return out;
  }, [entries, categoryFilter, minDistinctBansFilter]);

  const alreadyApplied = entries?.filter(e => e.appliedStatus === 'banned').length ?? 0;
  const newCount = (entries?.length ?? 0) - alreadyApplied;

  const thresholdCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 5: 0, 10: 0 };
    if (!entries) return counts;
    for (const min of [1, 2, 5, 10]) counts[min] = entries.filter(e => (e.threat?.count ?? 0) >= min).length;
    return counts;
  }, [entries]);
  const eligibleForApplyAll = useMemo(() => {
    if (!entries) return 0;
    return entries.filter(e => e.appliedStatus !== 'banned' && (e.threat?.count ?? 0) >= applyMinDistinctBans).length;
  }, [entries, applyMinDistinctBans]);

  const toggleSelected = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const selectAllVisible = () => setSelected(new Set(visibleEntries.map(e => e.id)));
  const clearSelection = () => setSelected(new Set());

  const apply = async (opts: { entryIds?: string[] } = {}) => {
    setApplying(true);
    setLastResult(null);
    try {
      const data = await window.kickpulseDesktop.communityBans.apply(opts);
      setLastResult(data);
      load();
    } finally {
      setApplying(false);
    }
  };
  const banOne = (id: string) => apply({ entryIds: [id] });
  const unbanOne = async (entry: CommunityBanEntry) => {
    await window.kickpulseDesktop.communityBans.unban(entry.id);
    load();
  };
  const unbanAll = async () => {
    if (!confirm(`Unban all ${alreadyApplied} accounts you've banned from this list? This can't be undone in bulk.`)) return;
    await window.kickpulseDesktop.communityBans.unbanAll();
    load();
  };

  const createSquad = async () => {
    if (!newSquadName.trim()) return;
    const d = await window.kickpulseDesktop.communityBans.createSquad(newSquadName.trim());
    setNewSquadName('');
    loadSquads();
    alert(`Squad "${d.squad.name}" created — invite code ${d.squad.invite_code}`);
  };
  const joinSquad = async () => {
    if (!joinCode.trim()) return;
    await window.kickpulseDesktop.communityBans.joinSquad(joinCode.trim());
    setJoinCode('');
    loadSquads();
  };
  const leaveSquad = async (squad: Squad) => {
    if (!confirm(`Leave "${squad.name}"?`)) return;
    await window.kickpulseDesktop.communityBans.leaveSquad(squad.id);
    loadSquads();
  };

  const addFlag = async () => {
    if (!flagUsername.trim()) return;
    await window.kickpulseDesktop.communityBans.addFlag({ username: flagUsername.trim(), category: flagCategory, reason: flagReason.trim() || undefined });
    setFlagUsername(''); setFlagReason('');
    loadFlags();
  };
  const removeFlag = async (flag: ViewerFlag) => {
    await window.kickpulseDesktop.communityBans.removeFlag(flag.id);
    loadFlags();
  };

  const saveThreatSetting = async (level: number) => {
    setMinThreatLevel(level);
    await window.kickpulseDesktop.communityBans.setSettings({ minThreatLevelToWarn: level });
  };
  const saveApplyThreshold = async (min: number) => {
    setApplyMinDistinctBans(min);
    setMinDistinctBansFilter(min);
    setShowList(true);
    setTimeout(() => document.getElementById('community-bans-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    await window.kickpulseDesktop.communityBans.setSettings({ applyMinDistinctBans: min });
  };

  if (entries === null) return null;

  return (
    <Page title="Community Bans" icon={<ShieldAlert size={22} color={COLORS.accent} />} subtitle="A shared, cross-streamer list of known bad-actor usernames — ban them on your own channel with one click, or as a group.">
      <Tabs value={tab} onChange={(v) => setTab(v as Tab)} options={[
        { value: 'bans', label: `Bans (${entries.length})`, icon: <Ban size={14} /> },
        { value: 'flags', label: `Flags (${flags?.length ?? 0})`, icon: <Flag size={14} /> },
        { value: 'squads', label: `Squads (${squads?.length ?? 0})`, icon: <Users size={14} /> },
        { value: 'settings', label: 'Warnings', icon: <ShieldAlert size={14} /> },
      ]} />

      {tab === 'bans' && (
        <>
          <Section>
            <p style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 10 }}>
              {entries.length} known bad-actor username{entries.length === 1 ? '' : 's'} on the shared list
              {alreadyApplied > 0 && <> — <span style={{ color: COLORS.success, fontWeight: 600 }}>{alreadyApplied} already banned</span> on your channel, {newCount} new</>}.
              {applyMinDistinctBans > 1 && (
                <span style={{ color: COLORS.warn }}> Apply All is currently limited to entries with {applyMinDistinctBans}+ distinct bans — that's <b>{eligibleForApplyAll}</b> account{eligibleForApplyAll === 1 ? '' : 's'} right now (see Apply All Threshold below).</span>
              )}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button variant="primary" onClick={() => apply({})} disabled={applying || entries.length === 0 || eligibleForApplyAll === 0}>
                <Ban size={14} /> {applying ? 'Applying…' : `Apply All${eligibleForApplyAll > 0 ? ` (${eligibleForApplyAll} new)` : ''}`}
              </Button>
              {selected.size > 0 && (
                <Button onClick={() => apply({ entryIds: Array.from(selected) })} disabled={applying}>
                  Apply Selected ({selected.size})
                </Button>
              )}
              {alreadyApplied > 0 && <Button onClick={unbanAll}>Unban All</Button>}
              <Button onClick={() => setShowList(s => !s)} style={{ marginLeft: 'auto' }}>
                {showList ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {showList ? 'Hide list' : 'Show list'}
              </Button>
            </div>
            {lastResult && (
              <p style={{ fontSize: 12, color: COLORS.textFaint, marginTop: 8 }}>
                Last run: {lastResult.banned} banned, {lastResult.skipped} skipped, {lastResult.notFound} not found{lastResult.errors ? `, ${lastResult.errors} errors` : ''}.
              </p>
            )}
          </Section>

          {showList && (
            <Section>
              <div id="community-bans-list" />
              {categories.length > 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  <button onClick={() => setCategoryFilter(null)} style={chipStyle(categoryFilter === null)}>All ({entries.length})</button>
                  {categories.map(([cat, count]) => (
                    <button key={cat} onClick={() => setCategoryFilter(cat)} style={chipStyle(categoryFilter === cat)}>{cat} ({count})</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLORS.textFaint, marginBottom: 10 }}>
                <span>Min. distinct bans:</span>
                <select value={minDistinctBansFilter} onChange={e => setMinDistinctBansFilter(Number(e.target.value))}
                  style={{ background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.textDim, padding: '3px 8px', fontSize: 11 }}>
                  <option value={1}>1+ (show all)</option>
                  <option value={2}>2+</option>
                  <option value={5}>5+</option>
                  <option value={10}>10+</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 11, color: COLORS.textFaint, marginBottom: 8 }}>
                <button onClick={selectAllVisible} style={linkStyle}>Select all shown ({visibleEntries.length})</button>
                {selected.size > 0 && <button onClick={clearSelection} style={linkStyle}>Clear selection</button>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {visibleEntries.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: COLORS.panelAlt }}>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelected(e.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>@{e.username}</div>
                      <div style={{ fontSize: 11, color: COLORS.textFaint }}>{e.reason}{e.source && <span> · {e.source}</span>}</div>
                    </div>
                    <span title="How many distinct streamers have ever banned this exact username"
                      style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, flexShrink: 0, background: (e.threat?.count ?? 0) >= 2 ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)', color: (e.threat?.count ?? 0) >= 2 ? COLORS.warn : COLORS.textFaint }}>
                      {e.threat?.count ?? 0} ban{(e.threat?.count ?? 0) === 1 ? '' : 's'}
                    </span>
                    <span style={statusChipStyle(e.appliedStatus)}>
                      {e.appliedStatus === 'banned' ? 'BANNED' : e.appliedStatus === 'not_found' ? 'NOT FOUND' : e.appliedStatus === 'error' ? 'ERROR' : 'NOT YET APPLIED'}
                    </span>
                    {e.appliedStatus === 'banned'
                      ? <Button onClick={() => unbanOne(e)}>Unban</Button>
                      : <Button variant="danger" onClick={() => banOne(e.id)} disabled={applying}>Ban</Button>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Apply All Threshold">
            <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
              How the "Apply All" button above decides which entries to actually ban. Picking a single entry (checkbox or
              its own Ban button) always bans it regardless of this setting. Each option shows how many accounts qualify
              right now — picking one also opens and filters the list above to exactly those accounts.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { min: 1, label: 'Ban everyone on the list' },
                { min: 2, label: '2+ distinct bans' },
                { min: 5, label: '5+ distinct bans' },
                { min: 10, label: '10+ distinct bans' },
              ].map(o => (
                <button key={o.min} onClick={() => saveApplyThreshold(o.min)} style={chipStyle(applyMinDistinctBans === o.min)}>
                  {o.label} ({thresholdCounts[o.min] ?? 0})
                </button>
              ))}
            </div>
          </Section>
        </>
      )}

      {tab === 'flags' && (
        <>
          <Section title="Flag a Viewer">
            <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
              Flag someone without banning them — just a reason the Dashboard's Live Chat can warn you about when they chat.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>Username</label>
                <input value={flagUsername} onChange={e => setFlagUsername(e.target.value)} placeholder="viewer_name" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Category</label>
                <select value={flagCategory} onChange={e => setFlagCategory(e.target.value)} style={inputStyle}>
                  {FLAG_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={labelStyle}>Note (optional)</label>
                <input value={flagReason} onChange={e => setFlagReason(e.target.value)} placeholder="Extra detail" style={{ ...inputStyle, width: '100%' }} />
              </div>
              <Button variant="primary" onClick={addFlag}><Flag size={14} /> Flag</Button>
            </div>
          </Section>
          <Section title={`Flagged Viewers (${flags?.length ?? 0})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(flags ?? []).map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: COLORS.panelAlt }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>@{f.username} <span style={{ color: COLORS.textFaint }}>({f.platform})</span></div>
                    <div style={{ fontSize: 11, color: COLORS.textFaint }}>
                      {FLAG_CATEGORIES.find(c => c.value === f.category)?.label || f.category}{f.reason && <span> — {f.reason}</span>}
                    </div>
                  </div>
                  <button onClick={() => removeFlag(f)} style={{ ...linkStyle, color: COLORS.danger }}><Trash2 size={13} /></button>
                </div>
              ))}
              {(flags ?? []).length === 0 && <p style={{ fontSize: 12, color: COLORS.textFaint }}>No one flagged yet.</p>}
            </div>
          </Section>
        </>
      )}

      {tab === 'squads' && (
        <Section title="Ban Squads">
          <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
            Group up with streamers you trust — a ban any member makes anywhere in the app automatically bans that same account on every other member's channel too.
          </p>
          {(squads ?? []).map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 8, background: COLORS.panelAlt, marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: COLORS.textFaint }}>{s.memberCount} member{s.memberCount === 1 ? '' : 's'}: {s.members.join(', ')}</div>
                <div style={{ fontSize: 11, color: COLORS.textFaint }}>Invite code: <code style={{ color: COLORS.success }}>{s.invite_code}</code></div>
              </div>
              <Button onClick={() => leaveSquad(s)}><LogOut size={13} /> Leave</Button>
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <input value={newSquadName} onChange={e => setNewSquadName(e.target.value)} placeholder="New squad name" style={inputStyle} />
            <Button onClick={createSquad}><Plus size={14} /> Create</Button>
            <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Invite code" style={{ ...inputStyle, width: 120 }} />
            <Button onClick={joinSquad}><LogIn size={14} /> Join</Button>
          </div>
        </Section>
      )}

      {tab === 'settings' && (
        <Section title="Threat Warnings">
          <p style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>
            How many other streamers need to have banned someone before the Dashboard's Live Chat flags them as a threat.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { level: 0, label: 'Off' },
              { level: 1, label: 'Any report' },
              { level: 2, label: 'Suspicious+ (2+)' },
              { level: 3, label: 'Likely bot+ (5+)' },
              { level: 4, label: 'Confirmed only (10+)' },
            ].map(o => (
              <label key={o.level} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="radio" checked={minThreatLevel === o.level} onChange={() => saveThreatSetting(o.level)} />
                {o.label}
              </label>
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}

const labelStyle = { fontSize: 11, color: COLORS.textDim, display: 'block', marginBottom: 4 } as const;
const inputStyle = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${COLORS.border}`,
  background: COLORS.panelAlt, color: COLORS.text, fontSize: 13,
} as const;
const linkStyle = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: COLORS.textFaint, textDecoration: 'underline' } as const;

function chipStyle(active: boolean) {
  return {
    padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
    background: active ? COLORS.accentDim : COLORS.panelAlt,
    border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
    color: active ? COLORS.text : COLORS.textDim,
  } as const;
}
function statusChipStyle(status: CommunityBanEntry['appliedStatus']) {
  const map: Record<string, { bg: string; color: string }> = {
    banned: { bg: 'rgba(34,197,94,0.15)', color: COLORS.success },
    not_found: { bg: 'rgba(255,255,255,0.06)', color: COLORS.textFaint },
    error: { bg: 'rgba(245,158,11,0.15)', color: COLORS.warn },
  };
  const s = (status && map[status]) || { bg: 'rgba(255,255,255,0.06)', color: COLORS.textDim };
  return { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.color, flexShrink: 0 } as const;
}
