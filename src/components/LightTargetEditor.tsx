// src/components/LightTargetEditor.tsx — shared by Light Scenes
// (src/pages/LightScenesPage.tsx) and Light Reactions
// (src/pages/LightReactionsPage.tsx): the per-device (or "all") on/
// brightness/color/random/transition editor, and the "same for all vs set
// each device separately" mode switcher. See electron/types.ts's own
// LightScene/LightReaction comment for why these two pages share this one
// target shape but have otherwise different lifecycles.
import { Select, NumberInput, ColorInput, Toggle, COLORS } from './ui';

export function emptyTarget(): LightPresetStepTarget {
  return { on: true, brightness: 100, color: '00ff9d' };
}

export function TargetFields({ value, onChange }: { value: LightPresetStepTarget; onChange: (v: LightPresetStepTarget) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <Select value={value.on === undefined ? '' : String(value.on)} onChange={(v) => onChange({ ...value, on: v === '' ? undefined : v === 'true' })}
        options={[{ value: '', label: 'Power: leave as-is' }, { value: 'true', label: 'Power: On' }, { value: 'false', label: 'Power: Off' }]} style={{ width: 160 }} />
      <Toggle checked={value.brightness !== undefined} onChange={(v) => onChange({ ...value, brightness: v ? 100 : undefined })} label="Brightness" />
      {value.brightness !== undefined && (
        <NumberInput value={value.brightness} min={0} max={100} onChange={(v) => onChange({ ...value, brightness: v })} style={{ width: 70 }} />
      )}
      <Toggle checked={value.color !== undefined || !!value.random} onChange={(v) => onChange(v ? { ...value, color: value.color ?? '00ff9d' } : { ...value, color: undefined, random: undefined })} label="Color" />
      {(value.color !== undefined || value.random) && (
        <>
          <Toggle checked={!!value.random} onChange={(v) => onChange({ ...value, random: v, color: v ? undefined : (value.color ?? '00ff9d') })} label="Random each time" />
          {!value.random && <ColorInput value={value.color ?? '00ff9d'} bare onChange={(v) => onChange({ ...value, color: v })} />}
        </>
      )}
      {/* transitionMs — real on WLED (`tt`) and Hue (`transitiontime`); Govee
          ignores it entirely (no such parameter in its LAN protocol). Direct
          feedback: "I do not see a transition field" (comparing against
          Lumia's own Scenes tab). */}
      <Toggle checked={value.transitionMs !== undefined} onChange={(v) => onChange({ ...value, transitionMs: v ? 1000 : undefined })} label="Smooth transition" />
      {value.transitionMs !== undefined && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <NumberInput value={Math.round(value.transitionMs / 100) / 10} min={0.1} step={0.1}
            onChange={(v) => onChange({ ...value, transitionMs: Math.max(0, Math.round(v * 1000)) })} style={{ width: 70 }} />
          <span style={{ fontSize: 12, color: COLORS.textDim }}>seconds (WLED/Hue only)</span>
        </span>
      )}
    </div>
  );
}

// Color preview chips (2026-10-18) — direct request: "a small square of
// color for preview of light scenes and reactions so users have an idea
// what each does without looking too hard... easily lets us see what colors
// we have setup or what kind of reactions (police lights etc)." A Reaction's
// steps already carry real sequencing (step 1 red, step 2 blue IS "police
// lights" as data) — one chip per step, in order, makes that readable at a
// glance without opening the editor. `random`/`off`/unset-color targets each
// get their own distinct swatch rather than silently falling back to a
// plain color, since "this step randomizes" or "this step turns it off" is
// exactly the kind of thing a glance should be able to tell apart too.
export function targetSwatchStyle(t: LightPresetStepTarget | undefined): import('react').CSSProperties {
  if (!t) return { background: COLORS.border };
  if (t.random) return { background: 'conic-gradient(from 0deg, #ff3b3b, #ffd23b, #3bff6a, #3bb7ff, #a23bff, #ff3b3b)' };
  if (t.on === false) return { background: 'repeating-linear-gradient(45deg, #2a2a30 0, #2a2a30 3px, #17171b 3px, #17171b 6px)' };
  if (t.color) return { background: `#${t.color}` };
  return { background: COLORS.border };
}

function swatchTitle(t: LightPresetStepTarget | undefined): string {
  if (!t) return 'Not set';
  if (t.random) return 'Random color';
  if (t.on === false) return 'Off';
  if (t.color) return `#${t.color}`;
  return 'No color set';
}

export function ColorChips({ targets, size = 14 }: { targets: (LightPresetStepTarget | undefined)[]; size?: number }) {
  if (targets.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
      {targets.map((t, i) => (
        <span key={i} title={swatchTitle(t)}
          style={{ width: size, height: size, borderRadius: 4, border: `1px solid ${COLORS.border}`, flexShrink: 0, ...targetSwatchStyle(t) }} />
      ))}
    </div>
  );
}

export function modeBtn(active: boolean): import('react').CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: active ? COLORS.accentDim : 'transparent', border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
    color: active ? COLORS.text : COLORS.textDim,
  };
}

/** The shared "same for all devices" vs "set each device separately" editor
 *  for a target-map — used directly by a Scene (one target-map total) and
 *  by each step of a Reaction (one target-map per step). */
export function TargetMapEditor({ targets, devices, onChange }: {
  targets: Record<string, LightPresetStepTarget>;
  devices: LightDeviceConfig[];
  onChange: (targets: Record<string, LightPresetStepTarget>) => void;
}) {
  const isAll = 'all' in targets;

  const setMode = (allMode: boolean) => {
    if (allMode) {
      const seed = Object.values(targets)[0] ?? emptyTarget();
      onChange({ all: seed });
    } else {
      const seed = targets.all ?? emptyTarget();
      onChange(Object.fromEntries(devices.map((d) => [d.id, targets[d.id] ?? seed])));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setMode(true)} style={modeBtn(isAll)}>Same for all devices</button>
        <button onClick={() => setMode(false)} style={modeBtn(!isAll)} disabled={devices.length === 0} title={devices.length === 0 ? 'Add a device first (Devices page)' : undefined}>
          Set each device separately
        </button>
      </div>
      {isAll ? (
        <TargetFields value={targets.all ?? emptyTarget()} onChange={(v) => onChange({ all: v })} />
      ) : devices.length === 0 ? (
        <span style={{ fontSize: 12, color: COLORS.textFaint }}>No devices added yet — see the Devices page.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {devices.map((d) => {
            const included = d.id in targets;
            return (
              <div key={d.id}>
                <Toggle
                  checked={included}
                  onChange={(checked) => {
                    const next = { ...targets };
                    if (checked) next[d.id] = emptyTarget(); else delete next[d.id];
                    onChange(next);
                  }}
                  label={d.name}
                />
                {included && (
                  <div style={{ marginTop: 6, marginLeft: 46 }}>
                    <TargetFields value={targets[d.id]} onChange={(v) => onChange({ ...targets, [d.id]: v })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
