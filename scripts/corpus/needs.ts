// scripts/corpus/needs.ts — pages a question's answer needs besides the visible page, for the offline
// context benchmark (ctxBench.ts). As page numbers, or labels resolved through the document's own label
// index (`find`). The first eight are the q3 writer's own hand-back notes (design §1.5); the rest were
// added by judgement from the question text (a figure, table, example or section it names that the
// answer must read, or the place the question asks for). Page numbers only, never PDF content.
export const NEEDS: Record<string, (number | string)[]> = {
  // q3 writer's notes
  'ost-physics:748': [749, 'figure 15.26'], 'ost-econ:128': [129], 'ost-stats:477': ['section 9.2'],
  'ax-conformal:6': ['appendix d'], 'ax-conformal:15': [14], 'ax-ricci:9': [8, 'eq 3.4'], 'ax-kallisto:3': [11],
  // by judgement
  'ost-physics:531': ['example 11.1'],
  'ost-econ:386': ['table 15.5'],
  'ost-econ:677': [692],
  'ost-physics:291': [282],
  'ost-econ:216': ['figure 8.7'],
  'ost-stats:202': ['figure 3.3'],
  'ost-stats:383': ['example 7.5', 'figure 7.3'],
  'ost-stats:650': ['table 12.6'],
  'ost-calc:179': ['figure 2.40'],
  'ost-calc:420': ['figure 4.79'],
  'ost-calc:485': ['example 5.19'],
  'ax-attention:6': [7, 'table 1'],
  'ax-resnet:6': ['figure 5'],
  'szeliski:538': ['table 8.2'],
};
