import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load every *.json fixture in this directory, keyed by its `id`.
 * @returns {Map<string, object>}
 */
function loadFixtures() {
  const map = new Map();
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, file), 'utf-8');
      const fixture = JSON.parse(raw);
      if (fixture?.id) map.set(fixture.id, fixture);
    } catch (err) {
      console.error(`[CLASSIFIER-TEST] Failed to load fixture ${file}:`, err?.message || err);
    }
  }
  return map;
}

const FIXTURES = loadFixtures();

/**
 * Summaries for the frontend dropdown — id, label, and the expected enum for each step.
 * `label` is derived for display (bill number + title + transition); fixtures store a real
 * `billTitle` rather than a descriptive label.
 * @returns {Array<{ id: string, label: string, billNumber: string, billTitle: string, beforeExpected: string, afterExpected: string }>}
 */
export function listFixtures() {
  return [...FIXTURES.values()].map(f => {
    const beforeExpected = f.before?.expected ?? null;
    const afterExpected = f.after?.expected ?? null;
    const titlePart = f.billTitle ? ` · ${f.billTitle}` : '';
    return {
      id: f.id,
      label: `${f.billNumber}${titlePart} (${beforeExpected} → ${afterExpected})`,
      billNumber: f.billNumber,
      billTitle: f.billTitle ?? null,
      beforeExpected,
      afterExpected,
    };
  });
}

/**
 * Full fixture by id, or undefined if unknown.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getFixture(id) {
  return FIXTURES.get(id);
}
