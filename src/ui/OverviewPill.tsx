// src/ui/OverviewPill.tsx
import { useSyncExternalStore } from 'react';
import { overviewHub, overviewPct } from '../pdf/overview';
import './ui.css';

/**
 * Bottom right while the lane's overview zoom is not 100% (spec §3 rule 6, mockup f15):
 * "Overview │ 50% │ Z to return". A click returns to 100%. Reads the live viewer's zoom from the hub.
 */
export function OverviewPill() {
  const z = useSyncExternalStore(overviewHub.subscribe, overviewHub.get, overviewHub.get);
  const visible = z !== 1;
  return (
    <button
      type="button"
      className={`overview-pill${visible ? ' is-visible' : ''}`}
      onClick={() => overviewHub.set(1)}
      aria-hidden={!visible}
      aria-label={`Overview at ${overviewPct(z)}: return to 100%`}
      tabIndex={visible ? 0 : -1}
    >
      <span className="overview-pill-name">Overview</span>
      <span className="overview-pill-pct">{overviewPct(z)}</span>
      <span className="overview-pill-hint">Z to return</span>
    </button>
  );
}
