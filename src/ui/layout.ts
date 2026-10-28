/**
 * Window layout while the board is open: the PDF column on the left, the board on the right, and
 * where the dock (caption + ask bar) sits. One source of truth for CSS (custom properties set on
 * :root) and for the viewer's column glide.
 */

/** Right gutter and the gap between the columns. */
export const GUTTER = 24;
/** The PDF column's left edge while the board is open: its pages (32px inset) stay 16px+ clear of the canvas toolbar (16 + 44). */
export const STAGE_LEFT = 48;
/** The board panel starts under the top bar. */
export const BOARD_TOP = 72;
/** Room kept free under the board for the dock: question echo, two caption lines, the ask bar. */
export const DOCK_RESERVE = 176;
/** Board header height and the sheet's padding inside the panel. */
export const BOARD_HEAD = 40;
export const BOARD_PAD = 16;
/** The widest PDF column worth having: the viewer's max page width (860) plus its side margins (64). */
export const PDF_COL_MAX = 924;
/** Share of the room the board takes when the PDF column can't reach its max width anyway. */
export const BOARD_SHARE = 0.5;
export const BOARD_MIN = 380;
/** Board sheet aspect (1000 × 700 board space). */
const ASPECT = 10 / 7;
/** The dock is this wide at most, and keeps 16px from its column's edges. */
export const DOCK_MAX = 560;

export type BoardGeometry = {
  /** Board panel width (CSS px). */
  boardW: number;
  /** The board sheet's width inside the panel. Its height is sheetW × 0.7. */
  sheetW: number;
  /** The PDF column's width while the board is open. */
  stageW: number;
};

/**
 * Sizes the board for a `W × H` window. The board takes whatever the PDF column leaves once it
 * reaches its max width (never less than BOARD_SHARE of the room), but never more than the sheet
 * can fill at the available height, so the panel has no empty band beside or under the sheet.
 */
export function boardGeometry(W: number, H: number): BoardGeometry {
  const room = W - STAGE_LEFT - GUTTER * 2;
  const sheetMaxW = Math.max(0, (H - BOARD_TOP - DOCK_RESERVE - BOARD_HEAD - BOARD_PAD) * ASPECT);
  const panelMaxW = sheetMaxW + BOARD_PAD * 2;
  const want = Math.max(room - PDF_COL_MAX, room * BOARD_SHARE);
  const boardW = Math.round(Math.max(BOARD_MIN, Math.min(panelMaxW, want)));
  const sheetW = Math.round(Math.max(0, Math.min(boardW - BOARD_PAD * 2, sheetMaxW)));
  return { boardW, sheetW, stageW: room - boardW };
}

export type Column = 'pdf' | 'board';

/** Where the dock sits: centered under the active column (the whole window when the board is closed). */
export function dockPlacement(W: number, H: number, boardOpen: boolean, column: Column): { x: number; w: number } {
  if (!boardOpen) return { x: W / 2, w: Math.min(DOCK_MAX, W - 32) };
  const g = boardGeometry(W, H);
  const colW = column === 'board' ? g.boardW : g.stageW;
  const x = column === 'board' ? W - GUTTER - g.boardW / 2 : STAGE_LEFT + g.stageW / 2;
  return { x, w: Math.min(DOCK_MAX, colW - 32) };
}
