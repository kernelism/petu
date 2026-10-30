import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Settings } from 'lucide-react';
import { ReportButton, type Capture } from './ReportButton';
import { glideDock } from './glide';
import { isGoToPageKey, parsePage, scrollToPageSlot } from './pageNav';
import { useTips, type TipProps } from './Tip';
import './ui.css';

type Props = {
  fileName: string;
  page: number;
  numPages: number;
  /** Bumped when the agent moves to a page: the page number gets a short emphasis tick. */
  pageTick: number;
  onOpenSettings(): void;
  /** Opens another PDF in place of this one (nothing is closed until a file is picked). */
  onOpenFile(f: File): void;
  /** The Report control (flag; Shift+R): captures the app's state for a bug report. */
  report?: Capture;
  /**
   * The student asked for page n (the page field, or G). App passes the viewer's
   * `goToPage(n, { reason: 'student' })`; without it the page's slot is scrolled into the band.
   */
  onGoToPage?(n: number): void;
};

/**
 * The page indicator is a field: click it (or press G), type a page, Enter goes there; Esc or
 * leaving the field puts the current page back.
 */
function PageField({ page, numPages, pageTick, onGo, tip }: { page: number; numPages: number; pageTick: number; onGo(n: number): void; tip: TipProps }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft != null;

  // The agent moved to a page: the number lifts once, briefly (not while the student is typing).
  useEffect(() => {
    const el = ref.current;
    if (!pageTick || !el || editing) return;
    el.classList.remove('is-tick');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-tick');
  }, [pageTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isGoToPageKey(e)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const digits = String(numPages).length;
  const go = () => {
    const n = draft == null ? null : parsePage(draft, numPages);
    setDraft(null);
    ref.current?.blur();
    if (n != null && n !== page) onGo(n);
  };
  return (
    <label className="topbar-page">
      <input
        ref={ref}
        {...tip}
        className="topbar-num"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={`Page ${page} of ${numPages}. Type a page and press Enter to go there.`}
        aria-keyshortcuts="G"
        value={draft ?? String(page)}
        style={{ width: `calc(${Math.max(digits, String(draft ?? page).length)}ch + 12px)` }}
        onFocus={(e) => { tip.onFocus(e); setDraft(String(page)); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\dpP\s]/g, '').slice(0, 7))}
        onBlur={() => { tip.onBlur(); setDraft(null); }}
        onAnimationEnd={(e) => e.currentTarget.classList.remove('is-tick')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); e.currentTarget.blur(); }
        }}
      />
      <span className="topbar-of" aria-hidden="true">/ {numPages}</span>
    </label>
  );
}

export function TopBar({ fileName, page, numPages, pageTick, onOpenSettings, onOpenFile, report, onGoToPage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tips = useTips();
  // The dock (App's) glides as a transform when the slide column moves (glide.ts).
  useEffect(() => glideDock(), []);
  return (
    <>
      <div className="topbar">
        <span className="topbar-name" title={fileName}>{fileName}</span>
        <span className="topbar-divider" aria-hidden="true" />
        <PageField page={page} numPages={numPages} pageTick={pageTick} onGo={onGoToPage ?? scrollToPageSlot} tip={tips.props('Go to page', 'G')} />
        {report && <ReportButton capture={report} tipProps={tips.props} />}
        <button type="button" className="icon-btn" onClick={onOpenSettings} data-settings-anchor="" {...tips.props('Settings')}>
          <Settings size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" onClick={() => inputRef.current?.click()} {...tips.props('Open PDF')}>
          <FolderOpen size={18} strokeWidth={1.75} />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onOpenFile(f); }}
        />
      </div>
      {/* Outside the bar: its backdrop filter would anchor a fixed tip to it. */}
      {tips.tip}
    </>
  );
}
