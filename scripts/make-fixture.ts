// Generates public/fixtures/epipolar.pdf (3 pages, 800x560 pt). ASCII only (WinAnsi standard fonts).
// Coordinates below are measured from the TOP-left; pdf-lib uses a bottom-left origin, so pdfY = H - y.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 800;
const H = 560;
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex('#1d1d1f');
const BODY = hex('#3a3a3c');
const GRAY = hex('#8e8e93');
const PANEL = hex('#f5f5f7');
const RECT = hex('#ececef');

const doc = await PDFDocument.create();
doc.setTitle('Stereo Vision - Epipolar Constraint (sample deck)');
const sans = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const serif = await doc.embedFont(StandardFonts.TimesRoman);

function newPage() {
  return doc.addPage([W, H]);
}
type P = ReturnType<typeof newPage>;

const text = (p: P, s: string, x: number, y: number, size: number, font = sans, color = INK) =>
  p.drawText(s, { x, y: H - y, size, font, color });
const footer = (p: P, n: string) => text(p, n, 740, 530, 13, sans, GRAY);
const circle = (p: P, x: number, y: number, r: number, color = INK) =>
  p.drawCircle({ x, y: H - y, size: r, color });
const quad = (p: P, pts: [number, number][]) => {
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ') + ' Z';
  // drawSvgPath treats y as downward from the given origin (top-left of the page).
  p.drawSvgPath(d, { x: 0, y: H, color: PANEL, borderColor: GRAY, borderWidth: 1.5 });
};
const heading = (p: P, s: string) => text(p, s, 40, 56, 26, bold);
const bullets = (p: P, lines: string[]) => lines.forEach((s, i) => text(p, s, 40, 100 + 30 * i, 17, sans, BODY));

// Page 1
{
  const p = newPage();
  text(p, 'Stereo Vision', 60, 250, 40, bold);
  text(p, 'CS670 - Lecture 9', 60, 290, 20, sans, GRAY);
  footer(p, '1');
}

// Page 2
{
  const p = newPage();
  heading(p, 'Correspondence Problem');
  bullets(p, [
    '- Given two views, find which pixels show the same 3D point',
    '- Naive approach: compare every pixel to every pixel, O(N^2)',
    '- Ambiguities: repeated texture, occlusion, specularities',
  ]);
  for (const x of [40, 430]) p.drawRectangle({ x, y: H - 200 - 230, width: 330, height: 230, color: RECT });
  footer(p, '2');
}

// Page 3
{
  const p = newPage();
  heading(p, 'Epipolar Constraint');
  bullets(p, [
    '- A point x in image 1 back-projects to a ray in 3D',
    "- That ray projects to a line l' in image 2: the epipolar line",
    "- So the match x' must lie on l', and the search becomes 1-D",
  ]);
  quad(p, [[110, 215], [290, 195], [290, 325], [110, 345]]);
  quad(p, [[470, 195], [650, 215], [650, 345], [470, 325]]);
  p.drawLine({ start: { x: 190, y: H - 455 }, end: { x: 570, y: H - 455 }, thickness: 1.2, color: GRAY, dashArray: [5, 4] });
  circle(p, 190, 455, 5);
  circle(p, 570, 455, 5);
  circle(p, 232, 265, 4.5);
  text(p, 'C', 170, 482, 15);
  text(p, "C'", 560, 482, 15);
  text(p, 'x', 253, 254, 15);
  text(p, 'image 1', 120, 236, 13, sans, GRAY);
  text(p, 'image 2', 595, 236, 13, sans, GRAY);
  text(p, "x'T F x = 0", 330, 530, 22, serif);
  footer(p, '3');
}

mkdirSync('public/fixtures', { recursive: true });
writeFileSync('public/fixtures/epipolar.pdf', await doc.save());
console.log('wrote public/fixtures/epipolar.pdf');
