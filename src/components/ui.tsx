// src/components/ui.tsx — small shared inline-style primitives for every
// page in this app. This app has no Tailwind/CSS framework at all (every
// existing page — HomePage.tsx, ObsControlPage.tsx, etc. — is plain
// `style={{...}}` CSSProperties objects), and the new Pulse Engine/Scenes/
// Overlay Studio/Alert Studio pages need a LOT of small form controls — so
// rather than hand-rolling the same button/input/toggle styling dozens of
// times across those files (exactly how the website ended up with ~19
// independently-drifting ColorPicker copies, see kickpulse-new's own
// CLAUDE.md "Styling Rules" note on this), they're built once here.
//
// Deliberately NOT Tailwind — adding a whole CSS framework just for this
// would be a second styling convention living alongside the rest of the
// app's existing plain-inline-style pages, not a replacement for it.

import { useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export const COLORS = {
  bg: '#0b0b10',
  panel: '#121218',
  panelAlt: '#17171f',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  text: '#f3f4f6',
  textDim: '#9ca3af',
  textFaint: '#6b7280',
  accent: '#7c3aed',
  accentDim: 'rgba(124,58,237,0.18)',
  danger: '#ef4444',
  success: '#22c55e',
  warn: '#f59e0b',
};

// "Checkerboard = transparency" — same convention the website uses for
// every live preview/thumbnail that can show a transparent background
// (Alert Box's image previews, Alert Studio's own scene preview, Image
// Studio) — ported directly rather than reinvented. A hardcoded solid
// backdrop color behind a preview makes a genuinely-correct `transparent`
// background look like an opaque black box sitting in front of everything,
// which is exactly the bug this fixes (found 2026-10-15, reported
// directly: "transparent should be shown as transparent... checkered or
// something to show that its transparent").
export const CHECKER_BG: CSSProperties = {
  backgroundColor: '#1a1a1a',
  backgroundImage:
    'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), ' +
    'linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

export function Page({ title, icon, subtitle, actions, children, fullBleed }: {
  title: string; icon?: ReactNode; subtitle?: string; actions?: ReactNode; children: ReactNode;
  // fullBleed (2026-10-16) — Overlay Studio / Alert Studio / Pulse Engine all
  // embed the real website's own editor in a <webview>; squeezing that into
  // this page's normal 1100px reading-width column (meant for plain settings
  // forms) is exactly what made those pages "far too small... doesn't auto
  // adjust when I full screen" (direct report) — the webview was capped at
  // 1100px wide no matter how big the actual window was, and its height was
  // a guessed `calc(100vh - 230px)` that was never reliably correct either.
  // When true: no max-width cap, and the content area becomes a flex column
  // filling 100% of the real available height — this page's own direct
  // parent (<main> in App.tsx) already has a real, bounded 100vh-derived
  // height (a flex row child with no overflow issue), so a `flex: 1` child
  // placed inside the wrapper below genuinely fills whatever's left below
  // the header at ANY window size, maximized or not, with zero guessing.
  fullBleed?: boolean;
}) {
  return (
    <div style={{
      padding: fullBleed ? '20px 24px' : '28px 32px 60px',
      maxWidth: fullBleed ? 'none' : 1100,
      height: fullBleed ? '100%' : undefined,
      display: fullBleed ? 'flex' : undefined,
      flexDirection: fullBleed ? 'column' : undefined,
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: fullBleed ? 14 : 22, flexShrink: 0 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 700, margin: 0 }}>
            {icon}{title}
          </h1>
          {subtitle && <p style={{ color: COLORS.textDim, fontSize: 13, margin: '6px 0 0' }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>{actions}</div>}
      </div>
      {fullBleed ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div> : children}
    </div>
  );
}

export function Section({ title, right, children, style }: {
  title?: string; right?: ReactNode; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 14,
      padding: 18, marginBottom: 16, ...style,
    }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Row({ label, hint, children, align = 'center' }: {
  label?: string; hint?: string; children: ReactNode; align?: 'center' | 'flex-start';
}) {
  return (
    <div style={{ display: 'flex', alignItems: align, gap: 14, padding: '7px 0' }}>
      {label !== undefined && (
        <div style={{ width: 170, flexShrink: 0, fontSize: 13, color: COLORS.textDim, paddingTop: align === 'flex-start' ? 6 : 0 }}>
          {label}
          {hint && <div style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 2 }}>{hint}</div>}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

const fieldBase: CSSProperties = {
  background: '#0e0e14',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  color: COLORS.text,
  fontSize: 13,
  padding: '7px 10px',
  outline: 'none',
  fontFamily: 'inherit',
};

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; style?: CSSProperties; multiline?: boolean }) {
  if (props.multiline) {
    return (
      <textarea
        value={props.value} placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ ...fieldBase, width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', ...props.style }}
      />
    );
  }
  return (
    <input
      type="text" value={props.value} placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ ...fieldBase, width: '100%', boxSizing: 'border-box', ...props.style }}
    />
  );
}

export function NumberInput(props: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; style?: CSSProperties }) {
  return (
    <input
      type="number" value={Number.isFinite(props.value) ? props.value : 0}
      min={props.min} max={props.max} step={props.step ?? 1}
      onChange={(e) => props.onChange(parseFloat(e.target.value) || 0)}
      style={{ ...fieldBase, width: 90, textAlign: 'right', ...props.style }}
    />
  );
}

export function Select<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; style?: CSSProperties; title?: string }) {
  return (
    <select
      value={props.value} onChange={(e) => props.onChange(e.target.value as T)} title={props.title}
      style={{ ...fieldBase, width: '100%', boxSizing: 'border-box', appearance: 'none', cursor: 'pointer', ...props.style }}
    >
      {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent',
        cursor: 'pointer', padding: 0, color: COLORS.text, fontSize: 13,
      }}
    >
      <span style={{
        width: 36, height: 20, borderRadius: 999, flexShrink: 0,
        background: checked ? COLORS.accent : 'rgba(255,255,255,0.14)',
        position: 'relative', transition: 'background 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.15s',
        }} />
      </span>
      {label}
    </button>
  );
}

// Hex color with or without a leading '#', matching this app's own saved
// scene/layout shape (sceneTypes.ts/hudTypes.ts fields are sometimes stored
// WITH the '#', sometimes without — see each field's own type comment on
// the website this was ported from). `bare` tells this component which
// convention the field it's editing actually uses, so round-tripping a
// real website-saved scene never silently mangles its colors.
export function ColorInput({ value, onChange, bare }: { value: string; onChange: (v: string) => void; bare?: boolean }) {
  const hex = value.startsWith('#') ? value : `#${value || '000000'}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="color" value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
        onChange={(e) => onChange(bare ? e.target.value.replace('#', '') : e.target.value)}
        style={{ width: 32, height: 32, border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: 0, background: 'none', cursor: 'pointer' }}
      />
      <input
        type="text" value={value}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9a-fA-F#]/g, '');
          onChange(bare ? raw.replace('#', '') : raw);
        }}
        placeholder={bare ? '00ff9d' : '#00ff9d'}
        style={{ ...fieldBase, width: 86 }}
      />
    </div>
  );
}

export function Button({ children, onClick, variant = 'default', disabled, title, style }: {
  children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean; title?: string; style?: CSSProperties;
}) {
  const palette: Record<string, CSSProperties> = {
    default: { background: '#1b1b24', border: `1px solid ${COLORS.border}`, color: COLORS.text },
    primary: { background: COLORS.accent, border: `1px solid ${COLORS.accent}`, color: '#fff' },
    danger:  { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' },
    ghost:   { background: 'transparent', border: '1px solid transparent', color: COLORS.textDim },
  };
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8,
        fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        ...palette[variant], ...style,
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({ children, onClick, title, danger }: { children: ReactNode; onClick?: (e: MouseEvent) => void; title?: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
        borderRadius: 7, border: `1px solid ${COLORS.border}`, background: '#1b1b24',
        color: danger ? '#fca5a5' : COLORS.textDim, cursor: 'pointer', flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[] }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 18 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value} onClick={() => onChange(o.value)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', border: 'none', background: 'transparent',
              color: active ? COLORS.text : COLORS.textDim, fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
              borderBottom: active ? `2px solid ${COLORS.accent}` : '2px solid transparent', marginBottom: -1,
            }}
          >
            {o.icon}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div style={{
      border: `1px dashed ${COLORS.border}`, borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: COLORS.textDim,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: body ? 6 : 14 }}>{title}</div>
      {body && <div style={{ fontSize: 13, marginBottom: 16, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>{body}</div>}
      {action}
    </div>
  );
}

export function PremiumLock({ feature }: { feature: string }) {
  return (
    <EmptyState
      title={`${feature} is a Premium feature`}
      body="Upgrade on the website to use this from the desktop app too."
    />
  );
}

// A tiny custom dropdown (not a native <select>) for pickers that need to
// show more than plain text per option (a color swatch, a small count) —
// native <option> elements can't render arbitrary JSX. Used sparingly,
// only where that actually matters.
export function Dropdown<T>({ value, options, onSelect, render, placeholder }: {
  value: T | null; options: { value: T; key: string }[]; onSelect: (v: T) => void;
  render: (v: T | null) => ReactNode; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...fieldBase, width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <span style={{ color: value ? COLORS.text : COLORS.textFaint }}>{value ? render(value) : (placeholder || 'Select…')}</span>
        <ChevronDown size={14} color={COLORS.textFaint} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 41,
            background: COLORS.panelAlt, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10,
            maxHeight: 260, overflowY: 'auto', boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
          }}>
            {options.map((o) => (
              <div
                key={o.key} onClick={() => { onSelect(o.value); setOpen(false); }}
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {render(o.value)}
              </div>
            ))}
            {options.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12, color: COLORS.textFaint }}>Nothing yet</div>}
          </div>
        </>
      )}
    </div>
  );
}
