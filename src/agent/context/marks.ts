// src/agent/context/marks.ts (T0: types only; Lane G adds the functions)
import type { Pt } from '../../script/types';
import type { PageRect } from '../../geometry/space';

/** A painted path in model coords (0–1000 both axes). `ops`: M L C R Z per point step. */
export type PaintedPath = { paint: 'stroke' | 'fill' | 'both'; ops: string; pts: Pt[] };
export type PaintedImage = { rect: PageRect };

/**
 * Figure marks: handles on the page's own drawing, so the model can point at a dot, retrace a
 * segment or box an image by id instead of guessing coordinates (set-of-marks, as text).
 */
export type FigureMark =
  | { id: string; kind: 'dot'; at: Pt; label?: string }
  | { id: string; kind: 'line' | 'arrow'; from: Pt; to: Pt; label?: string; ends?: [string?, string?] }
  | { id: string; kind: 'box' | 'image' | 'figure' | 'equation'; rect: PageRect; label?: string; n?: number };
