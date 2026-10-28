// scripts/corpus/sources.ts — the hard evaluation corpus: openly licensed documents downloaded into
// .petu/corpus/ (gitignored; never committed, never copied into the repo tree). This file holds only
// ids, file names, titles, source URLs and licences — never document content.
// Downloaded 2026-10-28 after a HEAD size check (≤ 200 MB each), over https, verified as %PDF-.
import { join } from 'node:path';

export type CorpusKind = 'book' | 'paper' | 'notes';
export type CorpusDoc = {
  id: string;
  /** File name in the corpus directory, without .pdf. */
  file: string;
  title: string;
  kind: CorpusKind;
  /** Where it was downloaded from (several for a document merged from parts). */
  urls: string[];
  licence: string;
  note?: string;
};

const OSX = 'https://assets.openstax.org/oscms-prodcms/media/documents';
/** OpenStax's CMS API (`/apps/cms/api/v2/pages/?type=books.Book&fields=license_name`) reports this licence for all four books. */
const OSX_LICENCE = 'CC BY-NC-SA 4.0 (as reported by the OpenStax CMS API, 2026-10-28)';
const ARXIV = 'arXiv.org perpetual, non-exclusive licence to distribute (arxiv.org/licenses/nonexclusive-distrib/1.0)';
const OCW = 'https://ocw.mit.edu/courses/18-075-advanced-calculus-for-engineers-fall-2004';

export const CORPUS: CorpusDoc[] = [
  { id: 'ost-physics', file: 'openstax-university-physics-volume-1', title: 'University Physics Volume 1 (OpenStax)', kind: 'book', urls: [`${OSX}/university-physics-volume-1_-_WEB.pdf`], licence: OSX_LICENCE },
  { id: 'ost-econ', file: 'openstax-principles-economics-3e', title: 'Principles of Economics 3e (OpenStax)', kind: 'book', urls: [`${OSX}/principles-economics-3e_-_WEB.pdf`], licence: OSX_LICENCE },
  { id: 'ost-stats', file: 'openstax-introductory-statistics-2e', title: 'Introductory Statistics 2e (OpenStax)', kind: 'book', urls: [`${OSX}/introductory-statistics-2e_-_WEB.pdf`], licence: OSX_LICENCE },
  { id: 'ost-calc', file: 'openstax-calculus-volume-1', title: 'Calculus Volume 1 (OpenStax)', kind: 'book', urls: [`${OSX}/calculus-volume-1_-_WEB.pdf`], licence: OSX_LICENCE },
  { id: 'ax-attention', file: 'arxiv-1706.03762', title: 'Attention Is All You Need (Vaswani et al., arXiv:1706.03762)', kind: 'paper', urls: ['https://arxiv.org/pdf/1706.03762'], licence: ARXIV, note: 'ML; single column, tables and architecture figures' },
  { id: 'ax-resnet', file: 'arxiv-1512.03385', title: 'Deep Residual Learning for Image Recognition (He et al., arXiv:1512.03385)', kind: 'paper', urls: ['https://arxiv.org/pdf/1512.03385'], licence: ARXIV, note: 'ML/vision; two-column, figure- and table-heavy' },
  { id: 'ax-conformal', file: 'arxiv-2107.07511', title: 'A Gentle Introduction to Conformal Prediction (Angelopoulos & Bates, arXiv:2107.07511)', kind: 'paper', urls: ['https://arxiv.org/pdf/2107.07511'], licence: ARXIV, note: 'statistics (cs.LG / stat.ME); figures, algorithms' },
  { id: 'ax-ligo', file: 'arxiv-1602.03837', title: 'Observation of Gravitational Waves from a Binary Black Hole Merger (LIGO/Virgo, arXiv:1602.03837)', kind: 'paper', urls: ['https://arxiv.org/pdf/1602.03837'], licence: 'CC BY 4.0', note: 'physics; two-column APS, figure-heavy, long author list' },
  { id: 'ax-kallisto', file: 'arxiv-1505.02710', title: 'Near-optimal RNA-Seq quantification (Bray et al., arXiv:1505.02710)', kind: 'paper', urls: ['https://arxiv.org/pdf/1505.02710'], licence: ARXIV, note: 'bioinformatics (q-bio.QM)' },
  { id: 'ax-ricci', file: 'arxiv-math-0211159', title: 'The entropy formula for the Ricci flow and its geometric applications (Perelman, arXiv:math/0211159)', kind: 'paper', urls: ['https://arxiv.org/pdf/math/0211159'], licence: 'arXiv.org licence assumed for 1991–2003 submissions (arxiv.org/licenses/assumed-1991-2003)', note: 'proof-heavy maths' },
  {
    id: 'ocw-18075', file: 'ocw-18075-notes', title: 'MIT 18.075 Advanced Calculus for Engineers (Fall 2004): handwritten student notes, lectures 1, 4, 5, 19', kind: 'notes',
    urls: ['9b52c68d8360aadac7a311eba26525e0_lecture1', '9be5fb2d6499bb50f767da36a06616ec_lecture4', 'a21d133905c4f78747b6b29d0e1d172d_lecture5', '7cb0608d9a7c9ae5e3889a09e1b419fb_lecture19'].map((f) => `${OCW}/${f}.pdf`),
    licence: 'CC BY-NC-SA 4.0 (MIT OpenCourseWare)',
    note: 'scanned handwriting, no text layer; the four lecture PDFs merged in order with pdf-lib (originals kept in parts/)',
  },
];

/** Where the corpus lives: PETU_CORPUS_DIR or <root>/.petu/corpus. */
export const corpusDir = (root = process.cwd()): string => process.env.PETU_CORPUS_DIR ?? join(root, '.petu/corpus');
export const corpusPath = (d: CorpusDoc, root = process.cwd()): string => join(corpusDir(root), `${d.file}.pdf`);
export const corpusDoc = (id: string): CorpusDoc | undefined => CORPUS.find((d) => d.id === id);

/** What could not be fetched, and why (reported in the manifest). */
export const SKIPPED = [
  { title: 'Chemistry 2e (OpenStax)', url: `${OSX}/chemistry-2e_-_WEB.pdf`, why: 'HEAD content-length 217,794,376 bytes > 200 MB cap; the same-size Chemistry: Atoms First 2e (218,252,485 bytes) also over' },
];
