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
import { ImageOff, Plus, Trash2 } from 'lucide-react';
import { Section, Button, IconButton, EmptyState, COLORS, CHECKER_BG } from './ui';

export interface ConfigCardItem {
  id: string;
  name: string;
  thumbnail?: string | null;
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
        <IconButton title="Delete" danger onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={13} /></IconButton>
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
