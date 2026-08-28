/**
 * Sim Week contact-flag store — a small JSON file the operator writes (via
 * scripts/sim/flag.js) and the runner reads. Mirrors the existing
 * scripts/.seed-e2e-snapshot.json convention (gitignored, repo-local).
 *
 * Shape: { "SIM-03": { "action": "contact", "flaggedAt": "<iso>" }, ... }
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/services/sim -> repo root -> scripts/.sim-pending.json
export const FLAG_FILE = resolve(__dirname, '../../../scripts/.sim-pending.json');

/** Read all flags; returns {} if the file is absent or unparseable. */
export async function readFlags() {
  try {
    const raw = await readFile(FLAG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Overwrite the whole flag file. */
export async function writeFlags(flags) {
  await writeFile(FLAG_FILE, JSON.stringify(flags, null, 2) + '\n', 'utf8');
}

/** Set a contact flag for a sim id. */
export async function setContactFlag(simId, whenIso) {
  const flags = await readFlags();
  flags[simId] = { action: 'contact', flaggedAt: whenIso };
  await writeFlags(flags);
  return flags;
}

/** Remove a sim id's flag. */
export async function clearFlag(simId) {
  const flags = await readFlags();
  delete flags[simId];
  await writeFlags(flags);
  return flags;
}
