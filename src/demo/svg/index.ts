// src/demo/svg/index.ts — svg board demos (`?script=svg-…`): the prompt's two examples and the
// experiment's four recorded answers, each streamed as the model's raw beats through the server's own
// filter (server/svgBeats.ts), so the gallery shows exactly what a live answer would draw. Page
// pointing is dropped (they were written for other documents); the backdrop is the examples deck.
import { SvgBeatFilter } from '../../../server/svgBeats';
import { SVG_EXAMPLES } from '../../../server/prompt/svgExamples';
import { toBeats } from '../../svgboard/convert';
import { SVG_EXPERIMENT } from './experiment';
import { SVG_ENGINE_DEMOS } from './engine';

const PAGE_TAG = /\{\{(?:highlight|underline|circle|box|scroll|arrow|line)\s+p=\d+[^}]*\}\}\s?/g;

/** A raw beat-format answer as the client receives it (wire tags), page pointing removed. */
export function wireOf(raw: string): string {
  const f = new SvgBeatFilter(() => 0);
  return (f.push(raw) + f.end()).replace(PAGE_TAG, '').trim();
}

type SvgDemo = { src: string; page: number; question: string; script: string };
const demo = (question: string, raw: string): SvgDemo => ({ src: '/fixtures/examples.pdf', page: 1, question, script: wireOf(raw) });

function example(word: string): SvgDemo {
  const ex = SVG_EXAMPLES.find((e) => e.script.includes(`<g id="${word}"`));
  if (!ex) throw new Error(`no svg example with a group ${word}`);
  return demo(ex.question, ex.script);
}

export const SVG_DEMOS: Record<string, SvgDemo> = {
  'svg-ferry': example('river'),
  'svg-dough': example('yeast'),
  // The exact-data engine: computed curves, crossings and readouts, constants tweened.
  ...Object.fromEntries(Object.entries(SVG_ENGINE_DEMOS).map(([k, v]) => [`svg-${k}`, demo(v.question, v.raw)])),
  ...Object.fromEntries(Object.entries(SVG_EXPERIMENT).map(([k, v]) => [`svg-${k}`, demo(v.question, toBeats(v.svg, v.narration))])),
};
