// scripts/gallery/sheet.ts — the contact sheet: changed shots first (baseline | current | diff side
// by side), then every shot grouped by scene. Static HTML next to the run's shots.
import type { Manifest } from './run.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (r?: number) => (r == null ? '' : `${(r * 100).toFixed(3)}%`);

export function renderSheet(m: Manifest, base: Manifest | null): string {
  const rowOf = new Map(m.rows.map((r) => [r.name, r]));
  const baseFile = new Map((base?.shots ?? []).map((s) => [s.name, `../${base!.id}/${s.file}`]));
  const flagged = m.rows.filter((r) => r.status !== 'same' && r.status !== 'new');
  const changedHtml = flagged.map((r) => {
    const cur = m.shots.find((s) => s.name === r.name);
    const cell = (label: string, src?: string) => `<figure><figcaption>${label}</figcaption>${src ? `<a href="${esc(src)}"><img loading="lazy" src="${esc(src)}"></a>` : '<div class="none">—</div>'}</figure>`;
    return `<section class="cmp"><h3><span class="st ${r.status}">${r.status}</span> ${esc(r.name)} <small>${r.pixels ?? ''} px ${pct(r.ratio)}${r.error ? ` ${esc(r.error)}` : ''}</small></h3>
<div class="trio">${cell('baseline', baseFile.get(r.name))}${cell('current', cur?.file)}${cell('diff', r.status === 'changed' ? `diff/${r.name}.png` : undefined)}</div></section>`;
  }).join('\n');
  const scenes = [...new Set(m.shots.map((s) => s.scene))];
  const grid = scenes.map((sc) => `<h2>${esc(sc)}</h2><div class="grid">${m.shots.filter((s) => s.scene === sc).map((s) => {
    const st = rowOf.get(s.name)?.status ?? 'new';
    return `<figure class="${st}"><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}"></a><figcaption><span class="st ${st}">${st}</span> ${esc(`${s.moment} · ${s.browser} · ${s.size}`)}</figcaption></figure>`;
  }).join('')}</div>`).join('\n');
  const head = m.isBaseline ? 'baseline run' : base ? `vs baseline <code>${esc(base.id)}</code> (${esc(base.commit)})` : 'no baseline';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gallery ${esc(m.id)}</title><style>
:root{--bg:#f6f5f2;--fg:#1d1d1f;--mut:#6b6b70;--card:#fff;--line:#e2e0da;--bad:#c62828;--ok:#2e7d32;--new:#1565c0}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececee;--mut:#9a9aa0;--card:#202023;--line:#333338}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:1600px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}h3{font-size:14px;margin:0 0 8px;font-weight:600}
small,.meta{color:var(--mut)}code{font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px}
figure.changed,figure.missing,figure.error{border-color:var(--bad)}
img{width:100%;display:block;border-radius:4px}figcaption{font-size:12px;padding:4px 2px 0}
.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.cmp{margin:0 0 20px}.cmp figcaption{padding:0 2px 4px}
.none{color:var(--mut);padding:40px;text-align:center}
.st{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}.st.changed,.st.missing,.st.error{color:var(--bad)}.st.same{color:var(--ok)}.st.new{color:var(--new)}
@media (max-width:700px){.trio{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Gallery ${esc(m.id)}</h1>
<p class="meta">${esc(m.commit)} · ${m.shots.length} shots · ${(m.ms / 1000).toFixed(1)}s · ${head}${m.skipped.length ? ` · skipped: ${esc(m.skipped.join(', '))}` : ''}</p>
${m.errors.length ? `<pre>${esc(m.errors.join('\n'))}</pre>` : ''}
${flagged.length ? `<h2>Changed (${flagged.length})</h2>${changedHtml}` : base ? '<p>No changes beyond tolerance.</p>' : ''}
${grid}
</main></body></html>`;
}
