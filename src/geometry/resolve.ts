// src/geometry/resolve.ts (T0 stub; Lane R replaces this file)
import type { Pt } from '../script/types';
import type { PageRect } from './space';
export type GroundMark =
  | { kind: 'dot'; at: Pt }
  | { kind: 'line' | 'arrow'; from: Pt; to: Pt }
  | { kind: 'box' | 'image' | 'figure' | 'equation'; rect: PageRect }
  | { kind: 'text'; rect: PageRect; text: string };
export type Grounding = { mark(page: number, id: string): GroundMark | undefined };
