import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { HIGHLIGHTS, HIGHLIGHT_STYLES, INK_COLORS, VOICE_OPTIONS, setSettings, useSettings, type VoiceSetting } from '../settings/settings';
import type { InkStyle } from '../ink/agent/marks';
import { requestShortcuts } from './ShortcutsOverlay';
import './ui.css';

/** The narration read aloud (OpenAI's Realtime voices), or captions only. */
const VOICE_LABELS: Record<VoiceSetting, string> = { off: 'Off', marin: 'Marin', cedar: 'Cedar' };

const STYLES: { value: InkStyle; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'hand', label: 'Hand' },
  { value: 'clean', label: 'Clean' },
];
const INK_NAMES: Record<string, string> = {
  '#8E4EC6': 'Violet', '#F2600C': 'Orange', '#E5484D': 'Red', '#0A84FF': 'Blue', '#30A46C': 'Green',
};

/** The words per minute the narration actually plays at: the setting times the playback speed. */
export const effectiveWpm = (wpm: number, speed: number) => Math.round(wpm * speed);

/** Where an arrow key moves a radio group's selection (wrapping), or null for any other key. */
export function radioStep(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

/**
 * A radio group with one tab stop (the checked option) whose arrow keys move the selection, as
 * native radios do. `render(option, checked)` gives each option's props beyond the radio wiring.
 */
function RadioGroup<T>({ label, labelledBy, className, options, value, same = (a, b) => a === b, onPick, render }: {
  label?: string; labelledBy?: string; className: string; options: T[]; value: T; same?(a: T, b: T): boolean;
  onPick(v: T): void; render(o: T, checked: boolean): { className: string; label?: string; style?: CSSProperties; children?: ReactNode };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const at = Math.max(0, options.findIndex((o) => same(o, value)));
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const next = radioStep(e.key, at, options.length);
    if (next == null) return;
    e.preventDefault();
    onPick(options[next]);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={ref} className={className} role="radiogroup" aria-label={label} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const checked = i === at;
        const r = render(o, checked);
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={r.label}
            tabIndex={checked ? 0 : -1}
            className={r.className}
            style={r.style}
            onClick={() => onPick(o)}
          >
            {r.children}
          </button>
        );
      })}
    </div>
  );
}

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const swatch = (names: Record<string, string>) => (c: string, on: boolean) =>
  ({ className: `swatch${on ? ' is-on' : ''}`, label: names[c] ?? c, style: { '--swatch': c } as CSSProperties });

export function SettingsPopover({ open, onClose, onShowShortcuts = requestShortcuts }: { open: boolean; onClose(): void; onShowShortcuts?(): void }) {
  const s = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    onClose();
    document.querySelector<HTMLElement>('[data-settings-anchor]')?.focus();
  };

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
  const actual = effectiveWpm(s.wpm, s.speed);

  return (
    <div className="popover" ref={ref} role="dialog" aria-labelledby="pop-title" tabIndex={-1}>
      <header className="pop-head">
        <h2 className="pop-title" id="pop-title">Settings</h2>
        <button type="button" className="icon-btn pop-close" onClick={close} aria-label="Close settings" title="Close (Esc)">
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <section className="pop-row">
        <div className="pop-label" id="pop-style">Drawing style</div>
        <RadioGroup
          labelledBy="pop-style"
          className="segmented"
          options={STYLES.map((o) => o.value)}
          value={s.inkStyle}
          onPick={(v) => setSettings({ inkStyle: v })}
          render={(v, on) => ({ className: `seg${on ? ' is-on' : ''}`, children: STYLES.find((o) => o.value === v)!.label })}
        />
      </section>

      <section className="pop-row">
        <div className="pop-label" id="pop-ink">Ink color</div>
        <RadioGroup labelledBy="pop-ink" className="swatches" options={INK_COLORS} value={s.inkColor} same={sameColor}
          onPick={(c) => setSettings({ inkColor: c })} render={swatch(INK_NAMES)} />
      </section>

      <section className="pop-row">
        <div className="pop-label" id="pop-highlight">Highlight</div>
        <RadioGroup
          labelledBy="pop-highlight"
          className="segmented segmented-2"
          options={HIGHLIGHT_STYLES}
          value={s.highlight}
          onPick={(h) => setSettings({ highlight: h })}
          render={(h, on) => ({
            className: `seg${on ? ' is-on' : ''}`,
            children: <><span className="seg-wash" aria-hidden style={{ '--wash': HIGHLIGHTS[h].color, '--wash-a': HIGHLIGHTS[h].opacity } as CSSProperties} />{HIGHLIGHTS[h].label}</>,
          })}
        />
      </section>

      <section className="pop-row">
        <div className="pop-label pop-label-split">
          <label htmlFor="pop-wpm">Reading speed</label>
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
          aria-valuetext={`${s.wpm} words per minute`}
          aria-describedby={s.speed !== 1 ? 'pop-wpm-note' : undefined}
          style={{ '--fill': `${((s.wpm - 130) / 90) * 100}%` } as CSSProperties}
          onChange={(e) => setSettings({ wpm: Number(e.target.value) })}
        />
        {/* The answer's own speed control (1×, < >) multiplies this; say what they make together. */}
        {s.speed !== 1 && (
          <p className="pop-note" id="pop-wpm-note">
            Playing at {s.speed}× · {actual} wpm
          </p>
        )}
      </section>

      <section className="pop-row">
        <div className="pop-label" id="pop-voice">Voice</div>
        <RadioGroup
          labelledBy="pop-voice"
          className="segmented"
          options={[...VOICE_OPTIONS]}
          value={s.voice}
          onPick={(v) => setSettings({ voice: v })}
          render={(v, on) => ({ className: `seg${on ? ' is-on' : ''}`, children: VOICE_LABELS[v] })}
        />
      </section>

      <section className="pop-row pop-row-inline">
        <label className="pop-switch-row" htmlFor="pop-keys">
          <span className="pop-label">Keyboard shortcuts</span>
          <button
            id="pop-keys"
            type="button"
            role="switch"
            aria-checked={s.shortcuts}
            className={`switch${s.shortcuts ? ' is-on' : ''}`}
            onClick={() => setSettings({ shortcuts: !s.shortcuts })}
          />
        </label>
        <button type="button" className="btn-quiet pop-show-keys" onClick={() => { onClose(); onShowShortcuts(); }}>
          Show <kbd className="keycap">?</kbd>
        </button>
      </section>
    </div>
  );
}
