// src/components/ConfigGrid.tsx — shared "browse your saved configs" grid
// for Overlay Studio / Alert Studio / Widget Studio (2026-10-22, direct
// feedback: "I dont care for the small config buttons up top and would
// rather the new layout button be up top with panels below for each
// config that gives us a small preview of it"). Replaces the small inline
// pill-row each of those pages used to show every saved row as.
//
// The preview is each row's OWN already-captured `thumbnail` column — the
// exact same real html-to-image screenshot the website's own list pages
// (HudDesigner "My Overlays" list / AlertStudioList / WidgetStudioList)
// already save at editor-save-time and already show on their own cards —
// not a live re-render of anything, so there's no second rendering engine
// here to drift out of sync with the website. A row saved before this
// thumbnail convention existed, or never opened+saved since, simply has
// none yet — shown as a plain placeholder, same as the website's own list
// pages already do, not an error.
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Plus, Trash2, MoreVertical } from 'lucide-react';
import { Section, Button, IconButton, EmptyState, COLORS, CHECKER_BG } from './ui';

export interface ConfigCardItem {
  id: string;
  name: string;
  thumbnail?: string | null;
}

// Real incident, 2026-10-29 — a Trash2 IconButton sat directly in the card
// footer, right where the website's own list pages (Overlays.tsx's
// OverlayMenu) put a plain "Edit" affordance instead: a user clicked
// Delete on instinct going for Edit. Fixed to match the website's own
// established safety pattern exactly — delete lives behind a kebab (⋮)
// menu (two deliberate clicks, not one) with a real confirm() on top,
// rather than a single always-visible destructive button in the one spot
// a user's cursor naturally lands after reading the card's title.
function CardMenu({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <IconButton title="More options" onClick={(e) => { e.stopPropagation(); setOpen(p => !p); }}>
        <MoreVertical size={13} />
      </IconButton>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, width: 150,
            background: '#15151c', border: `1px solid ${COLORS.border}`, borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 20, overflow: 'hidden',
          }}
        >
          <button
            onClick={() => {
              setOpen(false);
              if (window.confirm(`Delete "${name}"? This can't be undone, and any OBS source pointed at it will stop working.`)) onDelete();
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px',
              border: 'none', background: 'transparent', color: '#fca5a5', fontSize: 12.5, cursor: 'pointer',
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function ConfigCard({ item, onOpen, onDelete }: {
  item: ConfigCardItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 14,
        overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column',
      }}
      onClick={onOpen}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 9', ...CHECKER_BG }}>
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: COLORS.textFaint }}>
            <ImageOff size={28} />
            <span style={{ fontSize: 11 }}>No preview yet — open to generate one</span>
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
        <CardMenu name={item.name} onDelete={onDelete} />
      </div>
    </div>
  );
}

export function ConfigGrid({ items, onOpen, onDelete, onCreate, createLabel, emptyTitle, emptyBody }: {
  items: ConfigCardItem[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  createLabel: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <Button variant="primary" onClick={onCreate}><Plus size={16} />{createLabel}</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} action={<Button variant="primary" onClick={onCreate}><Plus size={14} />{createLabel}</Button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {items.map((item) => (
            <ConfigCard key={item.id} item={item} onOpen={() => onOpen(item.id)} onDelete={() => onDelete(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
