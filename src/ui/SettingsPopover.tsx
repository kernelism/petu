import { useEffect, useRef, type CSSProperties } from 'react';
import { HIGHLIGHT_COLORS, INK_COLORS, setSettings, useSettings } from '../settings/settings';
import type { InkStyle } from '../ink/agent/marks';
import './ui.css';

const STYLES: { value: InkStyle; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'hand', label: 'Hand' },
  { value: 'clean', label: 'Clean' },
];
const COLOR_NAMES: Record<string, string> = {
  '#F2600C': 'Orange', '#E5484D': 'Red', '#0A84FF': 'Blue', '#30A46C': 'Green', '#8E4EC6': 'Purple',
  '#FFD60A': 'Yellow', '#7EE787': 'Green', '#7CC4FF': 'Blue', '#FF9ECF': 'Pink',
};

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick(c: string): void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => {
        const on = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={COLOR_NAMES[c] ?? c}
            className={`swatch${on ? ' is-on' : ''}`}
            style={{ '--swatch': c } as CSSProperties}
            onClick={() => onPick(c)}
          />
        );
      })}
    </div>
  );
}

export function SettingsPopover({ open, onClose }: { open: boolean; onClose(): void }) {
  const s = useSettings();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      document.querySelector<HTMLElement>('[data-settings-anchor]')?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest('[data-settings-anchor]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="popover" ref={ref} role="dialog" aria-label="Settings" tabIndex={-1}>
      <section className="pop-row">
        <div className="pop-label" id="pop-style">Drawing style</div>
        <div className="segmented" role="radiogroup" aria-labelledby="pop-style">
          {STYLES.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={s.inkStyle === o.value}
              className={`seg${s.inkStyle === o.value ? ' is-on' : ''}`}
              onClick={() => setSettings({ inkStyle: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <section className="pop-row">
        <div className="pop-label">Ink color</div>
        <Swatches label="Ink color" colors={INK_COLORS} value={s.inkColor} onPick={(c) => setSettings({ inkColor: c })} />
      </section>

      <section className="pop-row">
        <div className="pop-label">Highlight</div>
        <Swatches label="Highlight color" colors={HIGHLIGHT_COLORS} value={s.highlightColor} onPick={(c) => setSettings({ highlightColor: c })} />
      </section>

      <section className="pop-row">
        <div className="pop-label pop-label-split">
          <label htmlFor="pop-wpm">Caption speed</label>
          <span className="pop-value">{s.wpm} wpm</span>
        </div>
        <input
          id="pop-wpm"
          className="range"
          type="range"
          min={130}
          max={220}
          step={5}
          value={s.wpm}
          style={{ '--fill': `${((s.wpm - 130) / 90) * 100}%` } as CSSProperties}
          onChange={(e) => setSettings({ wpm: Number(e.target.value) })}
        />
      </section>

      <section className="pop-row pop-row-inline">
        <label className="pop-label" htmlFor="pop-keys">Keyboard shortcuts</label>
        <button
          id="pop-keys"
          type="button"
          role="switch"
          aria-checked={s.shortcuts}
          className={`switch${s.shortcuts ? ' is-on' : ''}`}
          onClick={() => setSettings({ shortcuts: !s.shortcuts })}
        />
      </section>
    </div>
  );
}
