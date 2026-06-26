/**
 * Frontend client for the classifier test/debug harness API.
 * Mirrors the fetch-wrapper style of src/services/scraper.ts.
 */

export interface FixtureSummary {
  id: string;
  label: string;
  billNumber: string;
  beforeExpected: string | null;
  afterExpected: string | null;
}

export interface ClassifyDebug {
  context: string | null;
  rawOutput: string | null;
  mapped?: string;
  priorStatus: string | null;
  guardApplied: boolean;
  finalStatus: string | null;
  note: string | null;
}

export interface StepResult {
  fixtureId: string;
  billId: string;
  debug: ClassifyDebug;
  classified: string | null;
  expected: string;
  match: boolean;
  oldStatus?: string | null;
  emailResult?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.details || err.error || `Request to ${url} failed`);
  }
  return response.json();
}

export const getFixtures = async (): Promise<FixtureSummary[]> => {
  const response = await fetch('/api/classifier-test/fixtures');
  if (!response.ok) throw new Error('Failed to load fixtures');
  const { fixtures } = await response.json();
  return fixtures;
};

export const seedBefore = (fixtureId: string): Promise<StepResult> =>
  postJson('/api/classifier-test/seed-before', { fixtureId });

export const injectAfter = (fixtureId: string, email: string): Promise<StepResult> =>
  postJson('/api/classifier-test/inject-after', { fixtureId, email });

export interface DeadlineWarnResult {
  fixtureId: string;
  billId: string;
  today: string;
  nextDeadlineName: string | null;
  nextDeadlineDate: string | null;
  daysLeft: number | null;
  tier: '7' | '3' | null;
  dead: boolean;
  deadlinePassed: boolean;
  emailResult: string;
}

export const deadlineWarn = (
  fixtureId: string,
  email: string,
  today?: string,
): Promise<DeadlineWarnResult> =>
  postJson('/api/classifier-test/deadline-warn', { fixtureId, email, today: today || undefined });

export const resetHarness = (fixtureId?: string): Promise<{ deleted: number }> =>
  postJson('/api/classifier-test/reset', { fixtureId });
