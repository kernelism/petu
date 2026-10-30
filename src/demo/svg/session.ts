// src/demo/svg/session.ts — `?script=svg-session`: one simulated session on the svg board, built to
// exercise what follow mode must keep in view (gallery scene `svg-session`; tests/svgboard/session.test.ts).
// - the first answer draws a board taller than the view (1500 units), so its later groups land below it;
// - an aside mid-answer opens its own small board in the inset;
// - a follow-up continues the first board (`BOARD extend`, grown to 2100 units) below what was drawn;
// - a second follow-up starts a fresh board under everything.
// Raw model format (plan + beats), streamed through the server's filter as a live answer would be.
// Invented numbers on compound growth; no document wording (the backdrop is the examples deck).

const g = (id: string, body: string) => `<g id="${id}">\n${body}\n</g>`;
const bar = (y: number, w: number, label: string, value: string, fill = '#bbb') =>
  `<rect x="200" y="${y}" width="${w}" height="44" fill="${fill}" stroke="#222" stroke-width="2"/>\n` +
  `<text x="180" y="${y + 30}" font-size="24" text-anchor="end" fill="#222">${label}</text>\n` +
  `<text x="${210 + w}" y="${y + 30}" font-size="24" fill="#222">${value}</text>`;

export const SESSION_Q = {
  main: 'Why does a savings balance grow faster the longer it sits?',
  aside: 'what counts as interest?',
  follow: 'what happens after forty years?',
  fresh: 'and if I add a little every year?',
};

const MAIN = `<plan>
Carrying case: 1000 at 10% a year. Year 1 +100, year 10 balance 2594 (+259), year 20 balance 6727 (+673). Rule of 72: doubles every ~7 years.
BOARD viewBox="0 0 1000 1500"
groups: start the first year; ten year ten; twenty year twenty; curve the balance over time; rule doubling time
</plan>
The balance grows faster because each year's interest is paid on everything already there, including last year's interest. Start with a thousand at ten percent: the first year adds a hundred.
${g('start', `<text x="60" y="70" font-size="28" fill="#222">year 1</text>\n${bar(110, 110, '1000', '+100')}`)}
By year ten the same ten percent is paid on 2594, so the year adds 259, not 100.
${g('ten', `<text x="60" y="320" font-size="28" fill="#222">year 10</text>\n${bar(360, 285, '2594', '+259')}`)}
By year twenty the balance is 6727 and one year adds 673: the rate never changed, only what it is paid on.
${g('twenty', `<text x="60" y="570" font-size="28" fill="#222">year 20</text>\n${bar(610, 600, '6727', '+673', '#999')}`)}
Plot the balance over the years and the curve bends upward: every step is ten percent of a taller bar.
${g('curve', `<line x1="120" y1="1260" x2="900" y2="1260" stroke="#222" stroke-width="2"/>\n<line x1="120" y1="1260" x2="120" y2="820" stroke="#222" stroke-width="2"/>\n<polyline points="120,1240 250,1222 380,1196 510,1156 640,1094 770,996 900,840" fill="none" stroke="#7c3aed" stroke-width="3"/>\n<text x="510" y="1300" font-size="24" text-anchor="middle" fill="#888">years 0 to 20</text>\n<text x="140" y="850" font-size="24" fill="#888">balance</text>`)}
So the balance doubles on a fixed clock: at ten percent, about every seven years.
${g('rule', `<text x="500" y="1400" font-size="30" text-anchor="middle" fill="#7c3aed">doubles about every 72 ÷ 10 ≈ 7 years</text>`)}
`;

const ASIDE = `<plan>
Interest: the price of lending, a share of the balance per year.
BOARD viewBox="0 0 1000 360"
groups: share the yearly share
</plan>
Interest is what the bank pays you for using your money: a fixed share of the balance each year.
${g('share', `<rect x="100" y="60" width="800" height="60" fill="#ddd" stroke="#222" stroke-width="2"/>\n<rect x="100" y="60" width="80" height="60" fill="#7c3aed"/>\n<text x="500" y="180" font-size="26" text-anchor="middle" fill="#222">10% of the balance, paid every year</text>`)}
`;

const FOLLOW = `<plan>
Continue the board below: year 40 balance 45259, one year adds 4526.
BOARD extend viewBox="0 0 1000 2100"
groups: forty year forty; gap the yearly gain compared
</plan>
After forty years the balance is about 45 thousand, and one year adds 4526, more than four times the whole first deposit.
${g('forty', `<text x="60" y="1560" font-size="28" fill="#222">year 40</text>\n${bar(1600, 700, '45259', '+4526', '#7c3aed')}`)}
That is the gap that keeps widening: the yearly gain itself grows ten percent a year.
${g('gap', `<text x="320" y="1800" font-size="26" text-anchor="middle" fill="#222">year 1: +100</text>\n<text x="680" y="1800" font-size="26" text-anchor="middle" fill="#222">year 40: +4526</text>\n<line x1="200" y1="1840" x2="800" y2="1840" stroke="#888" stroke-width="2"/>\n<text x="500" y="1900" font-size="24" text-anchor="middle" fill="#888">the gain grows as fast as the balance</text>`)}
`;

const FRESH = `<plan>
Adding 100 a year: each deposit starts its own snowball; after 20 years 6727 + 5727 = 12454.
BOARD viewBox="0 0 1000 1900"
groups: deposits one bar per deposit, oldest grown most (a tall column); total the sum
</plan>
Every deposit starts its own small snowball, so adding a hundred a year stacks a new one each year, and the oldest have grown the most.
${g('deposits', `<rect x="200" y="80" width="605" height="60" fill="#bbb" stroke="#222" stroke-width="2"/>\n<text x="180" y="120" font-size="26" text-anchor="end" fill="#222">deposit 1</text>\n<text x="820" y="120" font-size="26" fill="#222">673 after 20 y</text>\n<rect x="200" y="330" width="413" height="60" fill="#bbb" stroke="#222" stroke-width="2"/>\n<text x="180" y="370" font-size="26" text-anchor="end" fill="#222">deposit 2</text>\n<text x="628" y="370" font-size="26" fill="#222">459 after 16 y</text>\n<rect x="200" y="580" width="282" height="60" fill="#bbb" stroke="#222" stroke-width="2"/>\n<text x="180" y="620" font-size="26" text-anchor="end" fill="#222">deposit 3</text>\n<text x="497" y="620" font-size="26" fill="#222">314 after 12 y</text>\n<rect x="200" y="830" width="192" height="60" fill="#bbb" stroke="#222" stroke-width="2"/>\n<text x="180" y="870" font-size="26" text-anchor="end" fill="#222">deposit 4</text>\n<text x="407" y="870" font-size="26" fill="#222">214 after 8 y</text>\n<rect x="200" y="1080" width="131" height="60" fill="#bbb" stroke="#222" stroke-width="2"/>\n<text x="180" y="1120" font-size="26" text-anchor="end" fill="#222">deposit 5</text>\n<text x="346" y="1120" font-size="26" fill="#222">146 after 4 y</text>\n<rect x="200" y="1330" width="99" height="60" fill="#bbb" stroke="#222" stroke-width="2"/>\n<text x="180" y="1370" font-size="26" text-anchor="end" fill="#222">deposit 6</text>\n<text x="314" y="1370" font-size="26" fill="#222">110 after 1 y</text>`)}
After twenty years the deposits add 5727 to the 6727, about 12 thousand in all.
${g('total', `<text x="500" y="1640" font-size="30" text-anchor="middle" fill="#7c3aed">6727 + 5727 = 12454</text>`)}
`;

export const SESSION_RAW = { main: MAIN, aside: ASIDE, follow: FOLLOW, fresh: FRESH };
