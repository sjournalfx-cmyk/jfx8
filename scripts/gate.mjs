#!/usr/bin/env node
/**
 * Quality gate. Nothing ships unless every step passes.
 *   npm run gate        -> full gate (run before every push / deploy)
 *   npm run gate:fast   -> types + feature guard + unit tests (pre-push hook)
 *
 * Writes a machine-readable result to reports/gate.json so agents can cite it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const fast = process.argv.includes('--fast');
const run = (cmd) => spawnSync(cmd, { shell: true, stdio: 'inherit', env: process.env });

// esbuild syntax check for every serverless function (AGENTS.md §2)
const apiFiles = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) walk(p);
  else if (/\.(ts|mjs|js)$/.test(f) && !/\.test\./.test(f)) apiFiles.push(p);
});
walk('api');

const steps = [
  ['feature guard (specs/features.json)', 'npx vitest run test/featureGuard.test.ts'],
  ['typecheck (tsc --noEmit)', 'npx tsc --noEmit'],
  ['api syntax (esbuild)', `npx esbuild ${apiFiles.map((f) => JSON.stringify(f)).join(' ')} --log-level=error --outdir=/tmp/jfx-gate-api --entry-names=[dir]/[name]-[hash] --platform=node --format=esm`],
  ['unit tests (vitest run)', 'npx vitest run'],
];
if (!fast) steps.push(['production build (vite build)', 'npm run build']);

const results = [];
let failed = false;
for (const [name, cmd] of steps) {
  console.log(`\n▶ ${name}`);
  const t = Date.now();
  const r = run(cmd);
  const ok = r.status === 0;
  results.push({ step: name, ok, seconds: Math.round((Date.now() - t) / 1000) });
  if (!ok) { failed = true; console.error(`✖ ${name} FAILED`); break; }
  console.log(`✔ ${name}`);
}

mkdirSync('reports', { recursive: true });
writeFileSync('reports/gate.json', JSON.stringify({ at: new Date().toISOString(), fast, passed: !failed, results }, null, 2));
console.log(failed ? '\nGATE FAILED — do not commit/push/deploy.' : '\nGATE PASSED');
process.exit(failed ? 1 : 0);
