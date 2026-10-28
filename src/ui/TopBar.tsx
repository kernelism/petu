import { Settings, X } from 'lucide-react';
import './ui.css';

export function TopBar({ fileName, page, numPages, onOpenSettings, onClose }: {
  fileName: string; page: number; numPages: number; onOpenSettings(): void; onClose(): void;
}) {
  return (
    <div className="topbar">
      <span className="topbar-name" title={fileName}>{fileName}</span>
      <span className="topbar-divider" aria-hidden="true" />
      <span className="topbar-page" aria-label={`Page ${page} of ${numPages}`}>
        {page} <span className="topbar-of">/</span> {numPages}
      </span>
      <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="Settings" data-settings-anchor="">
        <Settings size={18} strokeWidth={1.75} />
      </button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close document">
        <X size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}
