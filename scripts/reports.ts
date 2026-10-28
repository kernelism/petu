// scripts/reports.ts — the Report button's saves (.petu/reports/, server/report.ts).
//   npm run reports             recent reports, one line each: id, time, doc:page, question, skips, note
//   npm run reports -- <id>     a compact digest of one report (a unique prefix or `last` works)
//   npm run reports -- <id> --json   the raw report.json
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { digest, listReports, readReport, reportIds, reportsDir } from '../server/report.ts';

const root = process.cwd();
const args = process.argv.slice(2);
const want = args.find((a) => !a.startsWith('--'));
if (!want) {
  const lines = listReports(root, Number(args.find((a) => a.startsWith('--n='))?.slice(4)) || 20);
  console.log(lines.length ? lines.join('\n') : 'No reports yet (top bar flag or Shift+R in the dev app).');
} else {
  const ids = reportIds(root);
  const match = want === 'last' ? ids.slice(0, 1) : ids.filter((id) => id === want || id.startsWith(want));
  if (match.length !== 1) {
    console.error(match.length ? `"${want}" matches ${match.length} reports:\n${match.join('\n')}` : `No report "${want}" in .petu/reports/.`);
    process.exit(1);
  }
  const id = match[0];
  const r = readReport(root, id);
  if (!r) { console.error(`Can't read ${id}/report.json.`); process.exit(1); }
  const dir = join(reportsDir(root), id);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else console.log(digest({ ...r, id }, existsSync(join(dir, 'screenshot.png')), dir));
}
