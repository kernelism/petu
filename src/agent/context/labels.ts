// src/agent/context/labels.ts — the caption/label index (design §2.2): `Figure 15.26`, `Table 15.5`,
// `Example 11.1`, `Theorem 1`, `Appendix D`, equation numbers `(3.4)`, section numbers from the map.
// A label is where it *starts a line* (a caption or a numbered heading, not a mention in a sentence),
// first occurrence wins. Built incrementally as the text index fills; lookups are O(1).
import type { MapEntry } from './docmap';

const KINDS = 'figure|fig\\.?|table|example|theorem|lemma|definition|proposition|corollary|algorithm|appendix|section|chapter|exercise|problem|equation|eq\\.?';
const LABEL_AT_START = new RegExp(`^(${KINDS})\\s*([a-z]?\\d+(?:\\.\\d+)*[a-z]?|[a-z])\\b`, 'i');
/** An equation number standing alone (the text layer splits it from its formula at the wide gap): `(3.4)`. */
const EQNUM_ALONE = /^\((\d+(?:\.\d+)*[a-z]?)\)$/;
/** Mentions in a question or a `find` string: "fig 15.26", "eq. (3.4)", "appendix D", "Table 1". */
const MENTION = new RegExp(`\\b(${KINDS}|eqn\\.?)\\s*\\(?([a-z]?\\d+(?:\\.\\d+)*[a-z]?|[a-z])\\)?(?![\\w.]*\\d)`, 'gi');
/** A bare equation number in a question: "(3.4)", "by (1.4)". */
const BARE_EQ = /(?:^|[\s,;])\((\d+\.\d+[a-z]?)\)/g;

export function normKind(k: string): string {
  const s = k.toLowerCase().replace(/\.$/, '');
  if (s === 'fig') return 'figure';
  if (s === 'eq' || s === 'eqn' || s === 'equation') return 'eq';
  return s;
}
const key = (kind: string, id: string) => `${normKind(kind)} ${id.toLowerCase()}`;

/** Labels that start a line of a page, and equation numbers standing alone. */
export function pageLabels(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    const m = LABEL_AT_START.exec(l);
    if (m) {
      // "Figure 3.3 A tree diagram" is a caption; "Figure 3.3 shows" is a sentence (still the figure's page, usually).
      const k = normKind(m[1]);
      // A single letter is a label only for appendices/sections ("Appendix D"), never "Table a".
      if (!/^[a-z]$/i.test(m[2]) || k === 'appendix' || k === 'section') out.push(key(m[1], m[2]));
    }
    const e = EQNUM_ALONE.exec(l);
    if (e) out.push(`eq ${e[1].toLowerCase()}`);
  }
  return out;
}

/** Labels named in free text (a question, a scout `find` string), normalised, in order, deduped. */
export function mentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION)) {
    let id = m[2].toLowerCase();
    // "figure 2a" → figure 2 (panel letters), but keep "appendix d".
    if (/^\d.*[a-z]$/.test(id)) id = id.slice(0, -1);
    const k = key(m[1], id);
    if (!out.includes(k)) out.push(k);
  }
  for (const m of text.matchAll(BARE_EQ)) { const k = `eq ${m[1].toLowerCase()}`; if (!out.includes(k)) out.push(k); }
  return out;
}

/** Section and appendix numbers from the map's titles: `5.1 Price…` → section 5.1, `Appendix D …` → appendix d, `Chapter 7 …` → chapter 7. */
export function mapLabels(es: MapEntry[]): [string, number][] {
  const out: [string, number][] = [];
  for (const e of es) {
    const t = e.title.trim();
    let m = /^(\d+(?:\.\d+)*)\.?\s+\S/.exec(t);
    if (m) { out.push([m[1].includes('.') ? `section ${m[1]}` : `chapter ${m[1]}`, e.from]); if (!m[1].includes('.')) out.push([`section ${m[1]}`, e.from]); continue; }
    m = /^(?:appendix\s+)([A-Z])\b/i.exec(t) ?? /^([A-Z])\s+\p{Lu}/u.exec(t);
    if (m) { out.push([`appendix ${m[1].toLowerCase()}`, e.from]); continue; }
    m = /^chapter\s+(\d+)\b/i.exec(t);
    if (m) out.push([`chapter ${m[1]}`, e.from], [`section ${m[1]}`, e.from]);
  }
  return out;
}

/** label → first page. Pages can be added in any order; the earliest page wins. */
export class LabelIndex {
  private at = new Map<string, number>();
  private seen = new Set<number>();
  addMap(es: MapEntry[]): void { for (const [k, p] of mapLabels(es)) this.put(k, p); }
  addPage(page: number, lines: string[]): void {
    if (this.seen.has(page)) return;
    this.seen.add(page);
    for (const k of pageLabels(lines)) this.put(k, page);
  }
  get(label: string): number | undefined { return this.at.get(label); }
  get size(): number { return this.at.size; }
  private put(k: string, p: number) { const o = this.at.get(k); if (o == null || p < o) this.at.set(k, p); }
  /** The labels a text names that resolve, in order: `[label, page]`. */
  resolve(text: string): [string, number][] {
    const out: [string, number][] = [];
    for (const k of mentions(text)) {
      let p = this.get(k);
      // "section 9.2" may only be known as a chapter-level map entry, "chapter 7" as a section.
      if (p == null && k.startsWith('section ')) p = this.get(`chapter ${k.slice(8)}`);
      if (p == null && k.startsWith('chapter ')) p = this.get(`section ${k.slice(8)}`);
      if (p != null) out.push([k, p]);
    }
    return out;
  }
}
