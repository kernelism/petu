import { useRef } from 'react';
import { FolderOpen, Settings } from 'lucide-react';
import { ReportButton, type Capture } from './ReportButton';
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
};

export function TopBar({ fileName, page, numPages, pageTick, onOpenSettings, onOpenFile, report }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="topbar">
      <span className="topbar-name" title={fileName}>{fileName}</span>
      <span className="topbar-divider" aria-hidden="true" />
      <span className="topbar-page" aria-label={`Page ${page} of ${numPages}`}>
        {/* Keyed by the tick so the emphasis replays on every agent page change. */}
        <span key={pageTick} className={pageTick ? 'topbar-num is-tick' : 'topbar-num'}>{page}</span>
        <span className="topbar-of">/</span>{numPages}
      </span>
      {report && <ReportButton capture={report} />}
      <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="Settings" title="Settings" data-settings-anchor="">
        <Settings size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => inputRef.current?.click()}
        aria-label="Open another PDF…"
        title="Open another PDF…"
      >
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
  );
}
