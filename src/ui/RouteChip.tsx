// src/ui/RouteChip.tsx
import { CornerUpLeft } from 'lucide-react';
import './ui.css';

/**
 * A journey's route, at the top of the slide column (spec "Flow across the document"): while the
 * tutor travels, "p9 → p2 · The Law of Demand"; once it has left the page the answer started on, a
 * persistent "Back to p9" (until the view is back there or the next answer starts).
 */
export type Route = { from: number; to: number; label?: string; back: boolean };

type Props = {
  route: Route | null;
  /** The page the answer started on, when the view has travelled away from it; null hides the control. */
  backTo: number | null;
  onBack(): void;
  /** Centre x (the slide column's). */
  x?: number;
};

export function RouteChip({ route, backTo, onBack, x }: Props) {
  const visible = !!route || backTo != null;
  return (
    <div className={`route${visible ? ' is-visible' : ''}`} style={x != null ? { left: x } : undefined} aria-hidden={!visible}>
      {route && (
        <span className="route-trip" key={`${route.from}-${route.to}`} role="status">
          <span className="route-pages">p{route.from} <span className="route-arrow" aria-label="to">→</span> p{route.to}</span>
          {(route.back || route.label) && <span className="route-label">{route.back ? 'where we started' : route.label}</span>}
        </span>
      )}
      {backTo != null && (
        <button type="button" className="route-back" onClick={onBack} tabIndex={visible ? 0 : -1} title={`Back to page ${backTo}, where the answer started`}>
          <CornerUpLeft size={14} strokeWidth={2} aria-hidden="true" />
          Back to p{backTo}
        </button>
      )}
    </div>
  );
}
