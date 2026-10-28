import { useEffect, useState } from 'react';
import './ui.css';

/** Shows "Page n" briefly at top-center on every new event (`seq`), even for the same page. */
export function PagePill({ page, seq }: { page: number | null; seq: number }) {
  const [shown, setShown] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (page == null) return;
    setShown(page);
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1200);
    return () => window.clearTimeout(t);
  }, [seq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`pagepill${visible ? ' is-visible' : ''}`} aria-live="polite" role="status">
      {shown != null ? `Page ${shown}` : null}
    </div>
  );
}
