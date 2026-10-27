// src/pages/ChatBotPage.tsx — Chat Bot, rebuilt as a real native page
// (2026-10-18, direct feedback: "you did the chatbot, chat alerts, and
// moderation horribly for the app. I want them actually built in. there is
// no real reason to load the site instead of having them actually in the
// app.") Ported from the website's own src/pages/ChatBot.tsx — same
// Commands/Timers/Walk-ons/Keywords/Counters/Spam Filter surface, same
// REST endpoints (widened to accept this app's API key the same day, see
// routes/commands.js/routes/counters.js/server.js's own comments), same
// free/premium limits enforced server-side exactly like the website.
// Deliberately NOT ported yet: Module packs (a thin, mostly-mechanical
// wrapper over this same modal — a real fast-follow, not core) and the
// "System Sounds" banner (pure decoration/link). See CommandModal.tsx's own
// header for the message-editor scope cuts.
import { useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, Clock, Footprints, Sparkles, Hash, Shield,
  Plus, Trash2, Pencil, Play, Search,
} from 'lucide-react';
import { Page, Section, Row, TextInput, NumberInput, Select, Toggle, Button, IconButton, EmptyState, COLORS, Tabs } from '../components/ui';
import CommandModal, { CommandDraft, CommandType, PERM_CONFIG, PERM_ORDER, newCommandDraft, draftFromRow, draftToPayload } from '../components/CommandModal';

type MainTab = 'variable' | 'timed' | 'walkon' | 'keyword' | 'counters' | 'spam';
type SortMode = 'created' | 'az' | 'access';

const TAB_DEFS: { id: MainTab; label: string; icon: any }[] = [
  { id: 'variable', label: 'Commands', icon: MessageSquare },
  { id: 'timed', label: 'Timers', icon: Clock },
  { id: 'walkon', label: 'Walk-ons', icon: Footprints },
  { id: 'keyword', label: 'Keywords', icon: Sparkles },
  { id: 'counters', label: 'Counters', icon: Hash },
  { id: 'spam', label: 'Spam Filter', icon: Shield },
];

export default function ChatBotPage() {
  const [tab, setTab] = useState<MainTab>('variable');
  const [commands, setCommands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('created');
  const [editing, setEditing] = useState<CommandDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counters, setCounters] = useState<string[]>([]);
  const [ignoreBots, setIgnoreBots] = useState(true);
  const [botUsernames, setBotUsernames] = useState('');
  const [ignoreBotsSaving, setIgnoreBotsSaving] = useState(false);
  useEffect(() => {
    window.kickpulseDesktop.chatBot.getSettings().then((d: any) => {
      setIgnoreBots(d?.ignore_bots !== false);
      setBotUsernames(d?.bot_usernames || '');
    }).catch(() => {});
  }, []);
  const saveIgnoreBots = async () => {
    setIgnoreBotsSaving(true);
    try { await window.kickpulseDesktop.chatBot.saveSettings({ ignore_bots: ignoreBots, bot_usernames: botUsernames }); }
    finally { setIgnoreBotsSaving(false); }
  };
  // Rich Actions on a Command/Keyword (2026-10-21) are Premium-only — same
  // status.me?.userId/isPremium read PulseEnginePage.tsx already does from
  // GET /desktop/me. userId is needed by this page's own PulseActionEditor
  // (it takes it as an explicit prop rather than a shared auth context).
  const [userId, setUserId] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  useEffect(() => {
    window.kickpulseDesktop.getStatus().then((status) => {
      setUserId(status.me?.userId ?? null);
      setIsPremium(!!status.me?.isPremium);
    });
  }, []);

  const load = async () => {
    try {
      const [cmds, ctrs] = await Promise.all([
        window.kickpulseDesktop.chatBot.listCommands(),
        window.kickpulseDesktop.chatBot.listCounters(),
      ]);
      setCommands(Array.isArray(cmds) ? cmds : []);
      setCounters((Array.isArray(ctrs) ? ctrs : []).map((c: any) => c.name));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load — Premium may be required');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (tab === 'counters' || tab === 'spam') return [];
    const q = search.trim().toLowerCase();
    let list = commands.filter((c) => c.type === tab && !c.module_id);
    if (q) {
      list = list.filter((c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.message || '').toLowerCase().includes(q) ||
        (c.keyword_phrases || []).some((p: string) => p.toLowerCase().includes(q))
      );
    }
    if (sortMode === 'az') list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sortMode === 'access') {
      list = [...list].sort((a, b) => {
        const ra = PERM_ORDER.indexOf(a.permission || 'everyone'), rb = PERM_ORDER.indexOf(b.permission || 'everyone');
        return ra !== rb ? ra - rb : (a.name || '').localeCompare(b.name || '');
      });
    }
    return list;
  }, [commands, tab, search, sortMode]);

  const newItem = () => setEditing(newCommandDraft(tab === 'counters' || tab === 'spam' ? 'variable' : (tab as CommandType)));
  const editItem = (row: any) => setEditing(draftFromRow(row));
  const closeEditor = () => setEditing(null);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload(editing);
      if (editing.id) await window.kickpulseDesktop.chatBot.updateCommand(editing.id, payload);
      else await window.kickpulseDesktop.chatBot.createCommand(payload);
      closeEditor();
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this?')) return;
    await window.kickpulseDesktop.chatBot.deleteCommand(id);
    await load();
  };

  const toggleEnabled = async (row: any) => {
    setCommands((prev) => prev.map((c) => (c.id === row.id ? { ...c, enabled: !row.enabled } : c)));
    try { await window.kickpulseDesktop.chatBot.updateCommand(row.id, { enabled: !row.enabled }); }
    catch { await load(); }
  };

  const play = async (row: any) => {
    try {
      await window.kickpulseDesktop.chatBot.testSendCommand({ message: row.message, platform: row.platform, sendAsUser: row.send_as_user, targetUsername: row.target_username || null });
    } catch (e: any) {
      setError(e?.message || 'Test send failed');
    }
  };

  if (loading) return null;

  return (
    <Page title="Chat Bot" icon={<MessageSquare size={22} color={COLORS.accent} />} subtitle="Commands, timed messages, walk-ons, keywords, counters, and the spam filter.">
      <Tabs value={tab} onChange={(v) => setTab(v as MainTab)} options={TAB_DEFS.map((t) => ({ value: t.id, label: t.label, icon: <t.icon size={14} /> }))} />

      {error && <Section style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}><span style={{ color: '#fca5a5', fontSize: 13 }}>{error}</span></Section>}

      {tab === 'counters' ? (
        <CountersTab counters={commands} onReload={load} />
      ) : tab === 'spam' ? (
        <SpamFilterTab />
      ) : (
        <>
          {(tab === 'variable' || tab === 'walkon' || tab === 'keyword') && (
            <div style={{ marginBottom: 14, padding: 12, background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
              <Toggle checked={ignoreBots} onChange={setIgnoreBots} label="Ignore known bots (Nightbot, StreamElements, etc.)" />
              <p style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 4 }}>
                Stops known chat bots from triggering walk-ons, commands, and keyword replies — so your bot doesn't
                "welcome in" or respond to someone else's bot. Applies across Commands, Walk-ons, and Keywords.
              </p>
              {ignoreBots && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: COLORS.textDim, marginBottom: 6 }}>
                    Also ignore these usernames (comma or newline separated)
                  </label>
                  <textarea value={botUsernames} onChange={(e) => setBotUsernames(e.target.value)} rows={2}
                    placeholder="mybotname, anothermod_bot"
                    style={{ width: '100%', padding: 10, background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }} />
                  <p style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 4 }}>
                    Your own username is always ignored here, even if typed in above — this can't be used to silence your own commands.
                  </p>
                </div>
              )}
              <Button variant="primary" onClick={saveIgnoreBots} disabled={ignoreBotsSaving} style={{ marginTop: 10 }}>
                {ignoreBotsSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 8, background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '7px 10px' }}>
              <Search size={14} color={COLORS.textFaint} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" style={{ background: 'none', border: 'none', outline: 'none', color: COLORS.text, fontSize: 13, flex: 1 }} />
            </div>
            <Select value={sortMode} onChange={(v) => setSortMode(v as SortMode)}
              options={[{ value: 'created', label: 'Sort: Created' }, { value: 'az', label: 'Sort: A-Z' }, { value: 'access', label: 'Sort: Access' }]} style={{ width: 160 }} />
            <Button variant="primary" onClick={newItem}><Plus size={14} />Add</Button>
          </div>

          <Section title="">
            {filtered.length === 0 ? (
              <EmptyState title="Nothing here yet" action={<Button variant="primary" onClick={newItem}>Add one</Button>} />
            ) : (
              filtered.map((row) => (
                <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px', borderBottom: `1px solid ${COLORS.border}`, opacity: row.enabled === false ? 0.55 : 1 }}>
                  <button onClick={() => toggleEnabled(row)} style={{
                    position: 'relative', width: 34, height: 19, borderRadius: 999, flexShrink: 0, border: 'none', cursor: 'pointer',
                    background: row.enabled === false ? 'rgba(255,255,255,0.14)' : COLORS.success,
                  }}>
                    <span style={{ position: 'absolute', top: 2, left: row.enabled === false ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} />
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.message}</div>
                  </div>
                  {(row.type === 'variable' || row.type === 'keyword') && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: PERM_CONFIG[(row.permission || 'everyone') as keyof typeof PERM_CONFIG]?.color, color: '#fff', flexShrink: 0 }}>
                      {PERM_CONFIG[(row.permission || 'everyone') as keyof typeof PERM_CONFIG]?.label}
                    </span>
                  )}
                  <IconButton title="Test send" onClick={() => play(row)}><Play size={13} /></IconButton>
                  <IconButton title="Edit" onClick={() => editItem(row)}><Pencil size={13} /></IconButton>
                  <IconButton title="Delete" danger onClick={() => remove(row.id)}><Trash2 size={13} /></IconButton>
                </div>
              ))
            )}
          </Section>
        </>
      )}

      {editing && (
        <CommandModal draft={editing} onChange={setEditing} onSave={save} onCancel={closeEditor} saving={saving} counters={counters} isPremium={isPremium} userId={userId} />
      )}
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════
function CountersTab({ onReload }: { counters: any[]; onReload: () => void }) {
  const [rows, setRows] = useState<{ id: string; name: string; value: number }[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const list = await window.kickpulseDesktop.chatBot.listCounters();
    setRows(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    await window.kickpulseDesktop.chatBot.createCounter(newName.trim());
    setNewName('');
    await load();
    onReload();
  };
  const adjust = async (name: string, delta: number) => { await window.kickpulseDesktop.chatBot.adjustCounter(name, { delta }); await load(); };
  const reset = async (name: string) => { await window.kickpulseDesktop.chatBot.adjustCounter(name, { value: 0 }); await load(); };
  const remove = async (name: string) => {
    if (!window.confirm('Delete this counter?')) return;
    await window.kickpulseDesktop.chatBot.deleteCounter(name);
    await load();
    onReload();
  };

  if (loading) return null;

  return (
    <Section title="Counters">
      <Row label="New counter">
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput value={newName} onChange={setNewName} placeholder="e.g. deaths" style={{ flex: 1 }} />
          <Button variant="primary" onClick={create} disabled={!newName.trim()}><Plus size={14} />Create</Button>
        </div>
      </Row>
      {rows.length === 0 ? (
        <EmptyState title="No counters yet" body="Create one above — it'll be usable in any command's Counter action." />
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: `1px solid ${COLORS.border}` }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'monospace' }}>{r.name}</span>
            <Button onClick={() => adjust(r.name, -1)}>−</Button>
            <span style={{ width: 50, textAlign: 'center', fontWeight: 700 }}>{r.value}</span>
            <Button onClick={() => adjust(r.name, 1)}>+</Button>
            <Button onClick={() => reset(r.name)}>Reset</Button>
            <IconButton title="Delete" danger onClick={() => remove(r.name)}><Trash2 size={13} /></IconButton>
          </div>
        ))
      )}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Emote spam / user repetition / group repetition / bot-promo protection
// (2026-10-22) — ported from the website's own ChatBot.tsx Spam tab, which
// had all four plus a Banned Usernames editor this native page was still
// missing (the `bannedUsernames` field existed in DEFAULT_SPAM below, but
// nothing ever rendered it — found while bringing this page up to parity).
// Field names/defaults match server.js's detectSpamViolation() exactly —
// see that function for the real enforcement side of each of these.
const DEFAULT_SPAM = {
  bannedWords: [] as { word: string; action: string; timeoutDuration: number }[],
  bannedUsernames: [] as { word: string; action: string; timeoutDuration: number }[],
  blockLinks: false, linkWhitelist: [] as string[],
  blockAllCaps: false, capsPercent: 70, capsMinLength: 15,
  maxRepeatedChars: 0, maxMessageLength: 0,
  blockEmoteSpam: false, maxEmotesPerMessage: 10,
  blockUserRepetition: false, userRepetitionCount: 3, userRepetitionWindowSeconds: 15,
  blockGroupRepetition: false, groupRepetitionCount: 3, groupRepetitionWindowSeconds: 10,
  blockBotPromo: false, botPromoPhrases: [] as string[],
  exemptRoles: ['moderator'] as string[],
};

function SpamFilterTab() {
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<typeof DEFAULT_SPAM>(DEFAULT_SPAM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPromoPhrase, setNewPromoPhrase] = useState('');

  useEffect(() => {
    window.kickpulseDesktop.chatBot.getSpamFilter().then((res) => {
      setEnabled(!!res?.enabled);
      setConfig({ ...DEFAULT_SPAM, ...(res?.config || {}) });
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    await window.kickpulseDesktop.chatBot.saveSpamFilter(enabled, config as any);
    setSaving(false);
  };

  const addWord = () => {
    if (!newWord.trim()) return;
    setConfig({ ...config, bannedWords: [...config.bannedWords, { word: newWord.trim(), action: 'delete', timeoutDuration: 60 }] });
    setNewWord('');
  };

  // Banned Usernames — matched against the SENDER's username only, never
  // message content (same reason this is a separate list on the website:
  // a username can legitimately contain a word you'd never want to ban
  // from chat messages themselves).
  const addUsername = () => {
    if (!newUsername.trim() || config.bannedUsernames.some((e) => e.word === newUsername.trim())) { setNewUsername(''); return; }
    setConfig({ ...config, bannedUsernames: [...config.bannedUsernames, { word: newUsername.trim(), action: 'delete', timeoutDuration: 300 }] });
    setNewUsername('');
  };

  const addPromoPhrase = () => {
    if (!newPromoPhrase.trim() || config.botPromoPhrases.includes(newPromoPhrase.trim())) { setNewPromoPhrase(''); return; }
    setConfig({ ...config, botPromoPhrases: [...config.botPromoPhrases, newPromoPhrase.trim()] });
    setNewPromoPhrase('');
  };
  const removePromoPhrase = (w: string) => setConfig({ ...config, botPromoPhrases: config.botPromoPhrases.filter((x) => x !== w) });

  if (loading) return null;

  return (
    <>
      <Section title="Spam Filter">
        <Row label="Enabled">
          <Toggle checked={enabled} onChange={setEnabled} />
        </Row>
        <Row label="Exempt roles">
          <div style={{ display: 'flex', gap: 6 }}>
            {['moderator', 'vip', 'subscriber'].map((role) => {
              const active = config.exemptRoles.includes(role);
              return (
                <button key={role} onClick={() => setConfig({ ...config, exemptRoles: active ? config.exemptRoles.filter((r) => r !== role) : [...config.exemptRoles, role] })}
                  style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: active ? COLORS.accent : 'rgba(255,255,255,0.06)', color: active ? '#fff' : COLORS.textDim }}>
                  {role}
                </button>
              );
            })}
          </div>
        </Row>
      </Section>

      <Section title="Banned Words">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <TextInput value={newWord} onChange={setNewWord} placeholder="word or phrase" style={{ flex: 1 }} />
          <Button variant="primary" onClick={addWord}><Plus size={14} />Add</Button>
        </div>
        {config.bannedWords.map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'monospace' }}>{w.word}</span>
            <Select value={w.action} onChange={(v) => setConfig({ ...config, bannedWords: config.bannedWords.map((x, xi) => xi === i ? { ...x, action: v } : x) })}
              options={[{ value: 'delete', label: 'Delete' }, { value: 'timeout', label: 'Timeout' }, { value: 'ban', label: 'Ban' }]} style={{ width: 110 }} />
            {w.action === 'timeout' && <NumberInput value={w.timeoutDuration} min={1} onChange={(v) => setConfig({ ...config, bannedWords: config.bannedWords.map((x, xi) => xi === i ? { ...x, timeoutDuration: v } : x) })} style={{ width: 70 }} />}
            <IconButton title="Remove" danger onClick={() => setConfig({ ...config, bannedWords: config.bannedWords.filter((_, xi) => xi !== i) })}><Trash2 size={13} /></IconButton>
          </div>
        ))}
      </Section>

      <Section title="Banned Usernames">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <TextInput value={newUsername} onChange={setNewUsername} placeholder="part of a username" style={{ flex: 1 }} />
          <Button variant="primary" onClick={addUsername}><Plus size={14} />Add</Button>
        </div>
        {config.bannedUsernames.map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'monospace' }}>{w.word}</span>
            <Select value={w.action} onChange={(v) => setConfig({ ...config, bannedUsernames: config.bannedUsernames.map((x, xi) => xi === i ? { ...x, action: v } : x) })}
              options={[{ value: 'delete', label: 'Delete' }, { value: 'timeout', label: 'Timeout' }, { value: 'ban', label: 'Ban' }]} style={{ width: 110 }} />
            {w.action === 'timeout' && <NumberInput value={w.timeoutDuration} min={1} onChange={(v) => setConfig({ ...config, bannedUsernames: config.bannedUsernames.map((x, xi) => xi === i ? { ...x, timeoutDuration: v } : x) })} style={{ width: 70 }} />}
            <IconButton title="Remove" danger onClick={() => setConfig({ ...config, bannedUsernames: config.bannedUsernames.filter((_, xi) => xi !== i) })}><Trash2 size={13} /></IconButton>
          </div>
        ))}
      </Section>

      <Section title="Automatic Rules">
        <Row label="Block links">
          <Toggle checked={config.blockLinks} onChange={(v) => setConfig({ ...config, blockLinks: v })} />
        </Row>
        <Row label="Block all-caps">
          <Toggle checked={config.blockAllCaps} onChange={(v) => setConfig({ ...config, blockAllCaps: v })} />
        </Row>
        {config.blockAllCaps && (
          <>
            <Row label="Caps % threshold"><NumberInput value={config.capsPercent} min={1} max={100} onChange={(v) => setConfig({ ...config, capsPercent: v })} style={{ width: 70 }} /></Row>
            <Row label="Min message length"><NumberInput value={config.capsMinLength} min={1} onChange={(v) => setConfig({ ...config, capsMinLength: v })} style={{ width: 70 }} /></Row>
          </>
        )}
        <Row label="Max repeated chars" hint="0 = off"><NumberInput value={config.maxRepeatedChars} min={0} onChange={(v) => setConfig({ ...config, maxRepeatedChars: v })} style={{ width: 70 }} /></Row>
        <Row label="Max message length" hint="0 = off"><NumberInput value={config.maxMessageLength} min={0} onChange={(v) => setConfig({ ...config, maxMessageLength: v })} style={{ width: 70 }} /></Row>

        <Row label="Block emote spam">
          <Toggle checked={config.blockEmoteSpam} onChange={(v) => setConfig({ ...config, blockEmoteSpam: v })} />
        </Row>
        {config.blockEmoteSpam && (
          <Row label="Max emotes per message" hint="3+ emote-heavy messages in 30s from the same person also get flagged">
            <NumberInput value={config.maxEmotesPerMessage} min={1} max={100} onChange={(v) => setConfig({ ...config, maxEmotesPerMessage: Math.max(1, v) })} style={{ width: 70 }} />
          </Row>
        )}

        <Row label="Block user repetition">
          <Toggle checked={config.blockUserRepetition} onChange={(v) => setConfig({ ...config, blockUserRepetition: v })} />
        </Row>
        {config.blockUserRepetition && (
          <Row label="Same message, times within seconds" hint="Resets the moment they say something genuinely different">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <NumberInput value={config.userRepetitionCount} min={2} max={20} onChange={(v) => setConfig({ ...config, userRepetitionCount: Math.max(2, v) })} style={{ width: 56 }} />
              <NumberInput value={config.userRepetitionWindowSeconds} min={5} max={600} onChange={(v) => setConfig({ ...config, userRepetitionWindowSeconds: Math.max(5, v) })} style={{ width: 64 }} />
            </div>
          </Row>
        )}

        <Row label="Block group repetition" hint="Copypasta waves — retroactively deletes earlier copies too">
          <Toggle checked={config.blockGroupRepetition} onChange={(v) => setConfig({ ...config, blockGroupRepetition: v })} />
        </Row>
        {config.blockGroupRepetition && (
          <Row label="Different people, within seconds">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <NumberInput value={config.groupRepetitionCount} min={2} max={20} onChange={(v) => setConfig({ ...config, groupRepetitionCount: Math.max(2, v) })} style={{ width: 56 }} />
              <NumberInput value={config.groupRepetitionWindowSeconds} min={3} max={120} onChange={(v) => setConfig({ ...config, groupRepetitionWindowSeconds: Math.max(3, v) })} style={{ width: 64 }} />
            </div>
          </Row>
        )}
      </Section>

      <Section title="Bot / Promo Protection">
        <p style={{ fontSize: 12, color: COLORS.textDim, marginTop: -4, marginBottom: 10 }}>
          A heuristic, not a guaranteed catch-all. A phrase hit from someone chatting for the first time
          this session gets timed out; the same phrase from a known regular just gets deleted.
        </p>
        <Row label="Enabled">
          <Toggle checked={config.blockBotPromo} onChange={(v) => setConfig({ ...config, blockBotPromo: v })} />
        </Row>
        {config.blockBotPromo && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 10 }}>
              <TextInput value={newPromoPhrase} onChange={setNewPromoPhrase} placeholder="dm me for…" style={{ flex: 1 }} />
              <Button variant="primary" onClick={addPromoPhrase}><Plus size={14} />Add</Button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {config.botPromoPhrases.map((w) => (
                <span key={w} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 8, fontSize: 12, background: 'rgba(255,255,255,0.06)', color: COLORS.textDim }}>
                  {w}
                  <IconButton title="Remove" danger onClick={() => removePromoPhrase(w)}><Trash2 size={11} /></IconButton>
                </span>
              ))}
            </div>
          </>
        )}
      </Section>

      <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Spam Filter'}</Button>
    </>
  );
}
