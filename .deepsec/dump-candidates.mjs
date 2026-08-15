import fs from 'fs';
import path from 'path';

const filesRoot = 'data/jfxbeta8.8/files';
const exclude = [
  'components/LandingPage.tsx',
  'components/PerformanceSequence.tsx',
  'components/landing-mock-data.ts',
];
const out = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (e.name.endsWith('.json')) {
      const rel = path.relative(filesRoot, p).replace(/\\/g, '/').replace(/\.json$/, '');
      if (exclude.includes(rel) || exclude.some((x) => rel.startsWith(x + '/'))) continue;
      let j;
      try {
        j = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        continue;
      }
      for (const c of j.candidates || []) {
        out.push({
          file: rel,
          slug: c.vulnSlug,
          lines: (c.lineNumbers || []).join(','),
          snip: (c.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        });
      }
    }
  }
}
walk(filesRoot);

console.log('TOTAL:', out.length);
const bySlug = {};
for (const o of out) bySlug[o.slug] = (bySlug[o.slug] || 0) + 1;
console.log(
  Object.entries(bySlug)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join('\n')
);
fs.writeFileSync('candidates.json', JSON.stringify(out, null, 1));
console.log('---written candidates.json');
