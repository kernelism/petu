import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ANSWER_QUALITIES, HIGHLIGHTS, HIGHLIGHT_STYLES, SPEEDS, VOICE_OPTIONS, setSettings, useSettings, type AnswerQuality, type VoiceSetting } from '../settings/settings';
import { requestShortcuts } from './ShortcutsOverlay';
import './ui.css';

/** The narration read aloud (OpenAI's Realtime voices), or captions only. */
const VOICE_LABELS: Record<VoiceSetting, string> = { off: 'Off', marin: 'Marin', cedar: 'Cedar' };
const QUALITY_LABELS: Record<AnswerQuality, string> = { standard: 'Standard', best: 'Best' };
/**
 * Best's cost, measured: the 2026-10-30 model sweep (3 questions, SVG board p6.1; spec
 * 2026-10-30-anchored-lane-design "Model choice evidence") cost Opus-low $0.220 / $0.201 / $0.065 per
 * answer vs the standard terra-none $0.032 / $0.039 / $0.034 (mean $0.162 vs $0.035, 4.6×); its first
 * word came about 0.5 s later (p50 2.5 s vs 2.0 s).
 */
export const BEST_HINT = 'Best: slower start, about 5× the cost.';
export const BEST_OFF_NOTE = 'Best needs PETU_ANTHROPIC_KEY in .env.';

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
  onPick(v: T): void; render(o: T, checked: boolean): { className: string; label?: string; style?: CSSProperties; children?: ReactNode; disabled?: boolean };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const at = Math.max(0, options.findIndex((o) => same(o, value)));
  const off = (i: number) => !!render(options[i], i === at).disabled;
  const onKeyDown = (e: ReactKeyboardEvent) => {
    let next = radioStep(e.key, at, options.length);
    if (next == null) return;
    e.preventDefault();
    // Skip a disabled option the way the arrow was going (Home/End land on the nearest enabled one).
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'End' ? -1 : 1;
    for (let n = 0; n < options.length && off(next); n++) next = (next + dir + options.length) % options.length;
    if (off(next)) return;
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
            disabled={r.disabled}
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

/**
 * `bestAvailable`: whether the server can run Answer quality "Best" (GET /api/spend `best`); without
 * it Best is shown disabled with a note. `onSpeed`: a speed pick (App re-times the playing answer);
 * by default it is only stored.
 */
export function SettingsPopover({ open, onClose, onShowShortcuts = requestShortcuts, bestAvailable = false, onSpeed = (v) => setSettings({ speed: v }), onVoice = (v) => setSettings({ voice: v }) }: {
  open: boolean; onClose(): void; onShowShortcuts?(): void; bestAvailable?: boolean; onSpeed?(v: number): void; /** A voice pick (App switches the playing answer's voice). */ onVoice?(v: VoiceSetting): void;
}) {
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
  const quality: AnswerQuality = bestAvailable ? s.quality : 'standard';

  return (
    <div className="popover" ref={ref} role="dialog" aria-labelledby="pop-title" tabIndex={-1}>
      <header className="pop-head">
        <h2 className="pop-title" id="pop-title">Settings</h2>
        <button type="button" className="icon-btn pop-close" onClick={close} aria-label="Close settings" title="Close (Esc)">
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

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
        <div className="pop-label" id="pop-speed">Speed</div>
        <RadioGroup
          labelledBy="pop-speed"
          className="segmented segmented-4"
          options={[...SPEEDS] as number[]}
          value={s.speed}
          onPick={onSpeed}
          render={(v, on) => ({ className: `seg${on ? ' is-on' : ''}`, children: `${v}×` })}
        />
      </section>

      <section className="pop-row">
        <div className="pop-label" id="pop-voice">Voice</div>
        <RadioGroup
          labelledBy="pop-voice"
          className="segmented"
          options={[...VOICE_OPTIONS]}
          value={s.voice}
          onPick={onVoice}
          render={(v, on) => ({ className: `seg${on ? ' is-on' : ''}`, children: VOICE_LABELS[v] })}
        />
      </section>

      <section className="pop-row">
        <div className="pop-label" id="pop-quality">Answer quality</div>
        <RadioGroup
          labelledBy="pop-quality"
          className="segmented segmented-2"
          options={[...ANSWER_QUALITIES]}
          value={quality}
          onPick={(q) => setSettings({ quality: q })}
          render={(q, on) => ({ className: `seg${on ? ' is-on' : ''}`, children: QUALITY_LABELS[q], disabled: q === 'best' && !bestAvailable })}
        />
        <p className="pop-note">{bestAvailable ? BEST_HINT : BEST_OFF_NOTE}</p>
      </section>

      <section className="pop-row">
        <div className="pop-label" id="pop-predict">Predict a step</div>
        <RadioGroup
          labelledBy="pop-predict"
          className="segmented segmented-2"
          options={['off', 'on'] as const}
          value={s.predict ? 'on' : 'off'}
          onPick={(v) => setSettings({ predict: v === 'on' })}
          render={(v, on) => ({ className: `seg${on ? ' is-on' : ''}`, children: v === 'on' ? 'Ask me' : 'Off' })}
        />
        <p className="pop-note">After two worked steps, the answer pauses once and asks you for the next one.</p>
      </section>

      <button type="button" className="btn-quiet pop-show-keys" onClick={() => { onClose(); onShowShortcuts(); }}>
        Keyboard shortcuts <kbd className="keycap">?</kbd>
      </button>
    </div>
  );
}
