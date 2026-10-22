import { useMemo, useState, type CSSProperties } from 'react';
import { WIDGET_CATALOG } from '../lib/widgetCatalog';

interface WidgetsPageProps {
  isPremium: boolean;
  onOpen: (key: string) => void;
}

const CATEGORIES = ['All', ...Array.from(new Set(WIDGET_CATALOG.map((w) => w.category)))];

export default function WidgetsPage({ isPremium, onOpen }: WidgetsPageProps) {
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return WIDGET_CATALOG.filter(
      (w) =>
        (category === 'All' || w.category === category) &&
        (!q || w.label.toLowerCase().includes(q) || w.desc.toLowerCase().includes(q))
    );
  }, [category, search]);

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Widgets</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        {WIDGET_CATALOG.length} widgets. Click one to edit its real settings directly — same data your OBS
        sources already read.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search widgets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '7px 12px',
            borderRadius: 8,
            border: '1px solid #374151',
            background: '#0f1117',
            color: '#fff',
            fontSize: 13,
            minWidth: 200,
          }}
        />
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
              background: category === c ? '#7c3aed' : '#1a1a22',
              color: category === c ? '#fff' : '#9ca3af',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {filtered.map((w) => {
          const locked = w.premium && !isPremium;
          return (
            <button
              key={w.key}
              onClick={() => onOpen(w.key)}
              style={{
                ...cardStyle,
                opacity: locked ? 0.55 : 1,
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{w.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                {w.label}
                {w.premium && (
                  <span style={{ fontSize: 10, background: '#7c3aed', padding: '1px 6px', borderRadius: 999 }}>
                    {locked ? '🔒 Premium' : 'Premium'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, lineHeight: 1.4 }}>{w.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: '#111827',
  borderRadius: 10,
  padding: 14,
  border: '1px solid rgba(255,255,255,0.06)',
  cursor: 'pointer',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
};
