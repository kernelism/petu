// src/ui/RouteChip.tsx
import { useEffect, useRef } from 'react';
import { ArrowRight, CornerUpLeft } from 'lucide-react';
import { useFollowBack } from './FollowPill';
import { glideOnMove } from './glide';
import { useTips } from './Tip';
import './ui.css';

/**
 * A journey's route, at the top of the slide column (spec "Flow across the document"): while the
 * tutor travels, "p9 → p2 · The Law of Demand"; once it has left the page the answer started on, a
 * persistent "Back to p9" (until the view is back there or the next answer starts).
 *
 * The row holds one way back at a time. While the student has taken over the view mid-answer
 * (FollowPill), it is "Back to answer"; otherwise "Back to pN".
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

/** Which way back the row offers: the answer (follow paused) wins over the page the answer started on. */
export function backControl(follow: boolean, backTo: number | null): { kind: 'answer' } | { kind: 'page'; page: number } | null {
  if (follow) return { kind: 'answer' };
  return backTo != null ? { kind: 'page', page: backTo } : null;
}

export function RouteChip({ route, backTo, onBack, x }: Props) {
  const follow = useFollowBack();
  const tips = useTips();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => (row.current ? glideOnMove(row.current) : undefined), []);
  const back = backControl(follow.visible, backTo);
  const visible = !!route || !!back;
  return (
    <>
      <div ref={row} className={`route${visible ? ' is-visible' : ''}`} style={x != null ? { left: x } : undefined} aria-hidden={!visible}>
        {route && (
          <span className="route-trip" key={`${route.from}-${route.to}`} role="status">
            <span className="route-pages">
              p{route.from}
              <ArrowRight className="route-arrow" size={12} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">to</span>
              p{route.to}
            </span>
            {(route.back || route.label) && <span className="route-label">{route.back ? 'where we started' : route.label}</span>}
          </span>
        )}
        {back?.kind === 'answer' && (
          <button
            type="button"
            className="route-back follow-pill"
            key="answer"
            onClick={follow.onResume}
            tabIndex={visible ? 0 : -1}
            {...tips.props('Follow the answer again')}
            aria-label={undefined}
          >
            <CornerUpLeft size={14} strokeWidth={2} aria-hidden="true" />
            Back to answer
          </button>
        )}
        {back?.kind === 'page' && (
          <button
            type="button"
            className="route-back"
            key="page"
            onClick={onBack}
            tabIndex={visible ? 0 : -1}
            {...tips.props(`Page ${back.page}, where the answer started`)}
            aria-label={undefined}
          >
            <CornerUpLeft size={14} strokeWidth={2} aria-hidden="true" />
            Back to p{back.page}
          </button>
        )}
      </div>
      {/* Outside the row: the row is transformed, which would anchor a fixed tip to it. */}
      {tips.tip}
    </>
  );
}
