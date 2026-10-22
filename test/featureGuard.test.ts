/**
 * Feature guard — fails the moment an agent (or a human) removes a shipped feature.
 *
 * The contract lives in specs/features.json. If this test fails:
 *   - You deleted/renamed something users rely on. Put it back, OR
 *   - The owner explicitly approved the removal in this session: update
 *     specs/features.json in the SAME commit and say so in the commit message.
 * Never "fix" this test by loosening it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const spec = JSON.parse(read('specs/features.json')) as {
  views: { id: string; label: string; component: string }[];
  files: string[];
  exports: Record<string, string[]>;
  dataServiceMethods: string[];
};

describe('feature contract (specs/features.json)', () => {
  const app = read('App.tsx');
  const sidebar = read('components/Sidebar.tsx');

  describe.each(spec.views)('view "$id" ($label)', ({ id, component }) => {
    it('component file exists', () => {
      expect(existsSync(resolve(root, component)), `${component} is missing`).toBe(true);
    });
    it('is rendered by App.tsx', () => {
      expect(app.includes(`currentView === '${id}'`), `App.tsx no longer renders view '${id}'`).toBe(true);
    });
    it('is reachable from the Sidebar', () => {
      expect(new RegExp(`id:\\s*'${id}'`).test(sidebar), `Sidebar no longer links to '${id}'`).toBe(true);
    });
  });

  it.each(spec.files)('file %s still exists', (p) => {
    expect(existsSync(resolve(root, p)), `${p} was deleted`).toBe(true);
  });

  describe.each(Object.entries(spec.exports))('%s', (file, names) => {
    const src = existsSync(resolve(root, file)) ? read(file) : '';
    it.each(names)('still exports %s', (name) => {
      const re = new RegExp(`export\\s+(const|function|async function|class|interface|type|let)\\s+${name}\\b`);
      expect(re.test(src), `${file} no longer exports ${name}`).toBe(true);
    });
  });

  it.each(spec.dataServiceMethods)('dataService still has %s()', (m) => {
    const src = read('services/dataService.ts');
    const body = src.slice(src.indexOf('export const dataService'));
    expect(new RegExp(`\\n\\s+(async\\s+)?${m}\\s*[:(]`).test(body), `dataService.${m} was removed`).toBe(true);
  });
});
