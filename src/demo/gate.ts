// src/demo/gate.ts — `?script=gate`: the live commit gate's demo (design 2026-10-29 §8), no API call.
// Four beats on the synthetic econ deck (public/fixtures/econ.pdf, p2: the demand line). Beat 3
// (stage-2 unit index 2) names a point Z that nothing on the board carries (checkNamed): under `&gate=live` the
// gate drops it (no words, no ink: gallery scene `gate@end`); with `&gatefail=2:skip&repair=fake`
// the fake repair's replacement below plays instead (`gate-repair@end`). Beats 1, 2 and 4 must pass:
// every number they say comes from the board ({{val}}), every pointing word has its ink. Each beat is
// one sentence that opens on a tag, so sentence mode and beat mode give the same unit indices.
import type { Demo } from './demoScript';

export const GATE_SCRIPT: Demo & { src: string; page?: number; repairs: Record<number, string> } = {
  src: '/fixtures/econ.pdf',
  page: 2,
  question: 'Why does the demand line fall at a steady rate?',
  script:
    `{{scroll p=2}} Demand slopes down at a steady rate: {{highlight p=2 "Qd = 60 – 5P"}} every cut in the price adds the same number of units, wherever you start on the line. ` +
    `{{sketch id=m near=p2}} Draw it {{const a=60 b=5}} from the slide's own formula: {{plot on=m id=d fn="a-b*x" domain=0,12 xlabel="price" ylabel="quantity" "demand"}} quantity is highest when the good is free and falls to nothing at the top price. ` +
    `{{emph id=d}} Notice point Z on the line, where its two halves meet: the slope there is the same as it is everywhere else along it. ` +
    `{{find id=M of=d x=6}} Halfway along, {{point on=m at=M "M"}} buyers still take {{val id=M fmt=0}} units: the same steady step got them there from either end.`,
  /** The fake repair's replacement for unit 2 (`&repair=fake`): the same point, said with ink that exists. */
  repairs: {
    2: `{{emph id=d}} Follow the line from the top price down to free: it never bends, so each step in price buys the same step in quantity.`,
  },
};
