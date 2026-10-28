import { describe, it, expect } from 'vitest';
import { boardGeometry, dockPlacement, GUTTER, STAGE_LEFT, BOARD_TOP, BOARD_HEAD, BOARD_PAD, DOCK_RESERVE } from '../../src/ui/layout';

const panelBottom = (H: number, sheetW: number) => BOARD_TOP + BOARD_HEAD + sheetW * 0.7 + BOARD_PAD;

describe('boardGeometry', () => {
  for (const [W, H] of [[1280, 800], [1440, 900], [2560, 1440], [1920, 1080]]) {
    it(`fills the window without overlap at ${W}×${H}`, () => {
      const g = boardGeometry(W, H);
      expect(STAGE_LEFT + g.stageW + GUTTER + g.boardW + GUTTER).toBe(W);
      // pages sit 32px inside the column: 16px clear of the toolbar (16 + 44)
      expect(STAGE_LEFT + 32).toBeGreaterThanOrEqual(16 + 44 + 16);
      // the sheet fills the panel's width: no empty band beside it
      expect(g.boardW - 2 * BOARD_PAD - g.sheetW).toBeLessThanOrEqual(1);
      // and it ends above the dock
      expect(panelBottom(H, g.sheetW)).toBeLessThanOrEqual(H - DOCK_RESERVE + 1);
    });
  }
  it('gives the board what a full-width PDF column leaves on wide screens', () => {
    const g = boardGeometry(2560, 1440);
    expect(g.stageW).toBe(924);
  });
  it('splits the room when the PDF column cannot reach its max width', () => {
    const g = boardGeometry(1440, 900);
    expect(g.boardW).toBe(Math.round((1440 - 96) * 0.5));
  });
  it('never makes the panel wider than its sheet can fill at the available height', () => {
    const g = boardGeometry(3000, 700);
    expect(g.boardW).toBe(g.sheetW + 2 * BOARD_PAD);
  });
});

describe('dockPlacement', () => {
  it('centers in the window while the board is closed', () => {
    expect(dockPlacement(1440, 900, false, 'board')).toEqual({ x: 720, w: 560 });
  });
  it('follows the active column while the board is open', () => {
    const g = boardGeometry(1440, 900);
    expect(dockPlacement(1440, 900, true, 'pdf').x).toBe(STAGE_LEFT + g.stageW / 2);
    expect(dockPlacement(1440, 900, true, 'board').x).toBe(1440 - GUTTER - g.boardW / 2);
  });
  it('keeps 16px from a narrow column edge', () => {
    const g = boardGeometry(1280, 800);
    expect(dockPlacement(1280, 800, true, 'pdf').w).toBe(Math.min(560, g.stageW - 32));
  });
});
