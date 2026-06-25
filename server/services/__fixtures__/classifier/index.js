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
 * @returns {Array<{ id: string, label: string, billNumber: string, beforeExpected: string, afterExpected: string }>}
 */
export function listFixtures() {
  return [...FIXTURES.values()].map(f => ({
    id: f.id,
    label: f.label,
    billNumber: f.billNumber,
    beforeExpected: f.before?.expected ?? null,
    afterExpected: f.after?.expected ?? null,
  }));
}

/**
 * Full fixture by id, or undefined if unknown.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getFixture(id) {
  return FIXTURES.get(id);
}
