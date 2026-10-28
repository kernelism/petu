import { memo, useCallback, useRef, type ReactNode } from 'react';

/** Imperative handles a slot hands to the viewer. The canvas itself is owned by the viewer, not React. */
export type SlotHandle = {
  el: HTMLDivElement;
  canvasHost: HTMLDivElement;
  highlight: SVGGElement;
  agent: SVGGElement;
};

type Props = {
  page: number;
  top: number;
  width: number;
  height: number;
  /** Page-space height (1000 * h / w). */
  spaceH: number;
  register(page: number, handle: SlotHandle | null): void;
  renderOverlay?(page: number, spaceH: number): ReactNode;
};

/**
 * One page: always mounted, absolutely positioned, a white sheet until the viewer swaps a rendered
 * canvas into `canvasHost`. Layers, bottom to top: canvas, highlights, overlay slot, agent ink.
 */
function PageSlotImpl({ page, top, width, height, spaceH, register, renderOverlay }: Props) {
  const parts = useRef<Partial<SlotHandle>>({});
  const tryRegister = () => {
    const p = parts.current;
    if (p.el && p.canvasHost && p.highlight && p.agent) register(page, p as SlotHandle);
  };
  // Callback refs: register once every piece is attached, unregister when the root detaches.
  const elRef = useCallback((n: HTMLDivElement | null) => {
    parts.current.el = n ?? undefined;
    if (n) tryRegister(); else register(page, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, register]);
  const hostRef = useCallback((n: HTMLDivElement | null) => { parts.current.canvasHost = n ?? undefined; if (n) tryRegister(); }, // eslint-disable-line react-hooks/exhaustive-deps
    [page, register]);
  const hlRef = useCallback((n: SVGGElement | null) => { parts.current.highlight = n ?? undefined; if (n) tryRegister(); }, // eslint-disable-line react-hooks/exhaustive-deps
    [page, register]);
  const agRef = useCallback((n: SVGGElement | null) => { parts.current.agent = n ?? undefined; if (n) tryRegister(); }, // eslint-disable-line react-hooks/exhaustive-deps
    [page, register]);

  const viewBox = `0 0 1000 ${spaceH}`;
  return (
    <div
      ref={elRef}
      className="pv-page"
      data-page={page}
      style={{ top, width, height, marginLeft: -width / 2 }}
    >
      <div ref={hostRef} className="pv-canvas-host" />
      <svg className="pv-layer pv-highlight" viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
        <g ref={hlRef} />
      </svg>
      {renderOverlay && <div className="pv-overlay">{renderOverlay(page, spaceH)}</div>}
      <svg className="pv-layer pv-agent" viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
        <g ref={agRef} />
      </svg>
    </div>
  );
}

export const PageSlot = memo(PageSlotImpl);
export default PageSlot;
