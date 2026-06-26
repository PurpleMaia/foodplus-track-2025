import React, { useEffect, useState } from 'react';
import { Play, Send, RotateCcw, CheckCircle2, XCircle, RefreshCw, AlarmClock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getFixtures,
  seedBefore,
  injectAfter,
  deadlineWarn,
  resetHarness,
  FixtureSummary,
  StepResult,
  DeadlineWarnResult,
} from '../services/classifierTest';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Return YYYY-MM-DD for `days` before the given YYYY-MM-DD date. */
const daysBefore = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
};

const StepResultCard: React.FC<{ title: string; result: StepResult }> = ({ title, result }) => {
  const { debug } = result;
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800">{title}</h4>
        {result.match ? (
          <span className="inline-flex items-center text-green-700 bg-green-100 px-2 py-1 rounded text-sm font-medium">
            <CheckCircle2 className="w-4 h-4 mr-1" /> Match
          </span>
        ) : (
          <span className="inline-flex items-center text-red-700 bg-red-100 px-2 py-1 rounded text-sm font-medium">
            <XCircle className="w-4 h-4 mr-1" /> Mismatch
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
        <dt className="text-gray-500">Expected</dt>
        <dd className="font-mono text-gray-900">{result.expected}</dd>
        <dt className="text-gray-500">Classified (final)</dt>
        <dd className="font-mono text-gray-900">{result.classified ?? '—'}</dd>
        {typeof result.oldStatus !== 'undefined' && (
          <>
            <dt className="text-gray-500">Status change</dt>
            <dd className="font-mono text-gray-900">{(result.oldStatus ?? 'null')} → {result.classified ?? 'null'}</dd>
          </>
        )}
        <dt className="text-gray-500">Raw model output</dt>
        <dd className="font-mono text-gray-900 break-all">{debug.rawOutput ?? '—'}</dd>
        <dt className="text-gray-500">Mapped enum</dt>
        <dd className="font-mono text-gray-900">{debug.mapped ?? '—'}</dd>
        <dt className="text-gray-500">Prior status (guard baseline)</dt>
        <dd className="font-mono text-gray-900">{debug.priorStatus ?? 'null'}</dd>
        <dt className="text-gray-500">Forward-progression guard</dt>
        <dd className="font-mono text-gray-900">{debug.guardApplied ? 'APPLIED (blocked regression)' : 'not applied'}</dd>
        {result.emailResult && (
          <>
            <dt className="text-gray-500">Notification email</dt>
            <dd className="font-mono text-gray-900 break-all">{result.emailResult}</dd>
          </>
        )}
        {debug.note && (
          <>
            <dt className="text-gray-500">Note</dt>
            <dd className="text-amber-700">{debug.note}</dd>
          </>
        )}
      </dl>

      <details className="text-sm">
        <summary className="cursor-pointer text-blue-600 hover:text-blue-800">View LLM context sent</summary>
        <pre className="mt-2 p-3 bg-white border border-gray-200 rounded text-xs overflow-x-auto whitespace-pre-wrap">
          {debug.context ?? '(no context)'}
        </pre>
      </details>
    </div>
  );
};

const ClassifierTestPanel: React.FC = () => {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [fixtureId, setFixtureId] = useState('');
  const [email, setEmail] = useState('');

  const [beforeResult, setBeforeResult] = useState<StepResult | null>(null);
  const [afterResult, setAfterResult] = useState<StepResult | null>(null);
  const [deadlineResult, setDeadlineResult] = useState<DeadlineWarnResult | null>(null);
  const [warnDate, setWarnDate] = useState('');

  const [loadingBefore, setLoadingBefore] = useState(false);
  const [loadingAfter, setLoadingAfter] = useState(false);
  const [loadingDeadline, setLoadingDeadline] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    getFixtures()
      .then((f) => {
        setFixtures(f);
        if (f.length > 0) setFixtureId(f[0].id);
      })
      .catch((e) => toast.error(e.message || 'Failed to load fixtures'));
  }, []);

  const selected = fixtures.find((f) => f.id === fixtureId);
  const emailValid = EMAIL_RE.test(email);

  const clearResults = () => {
    setBeforeResult(null);
    setAfterResult(null);
    setDeadlineResult(null);
  };

  const handleBefore = async () => {
    if (!fixtureId) return;
    setLoadingBefore(true);
    setAfterResult(null);
    try {
      const result = await seedBefore(fixtureId);
      setBeforeResult(result);
      toast[result.match ? 'success' : 'error'](
        `Before: classified "${result.classified}" (expected "${result.expected}")`
      );
    } catch (e) {
      toast.error((e as Error).message || 'Before step failed');
    } finally {
      setLoadingBefore(false);
    }
  };

  const handleAfter = async () => {
    if (!fixtureId || !emailValid) return;
    setLoadingAfter(true);
    try {
      const result = await injectAfter(fixtureId, email);
      setAfterResult(result);
      toast[result.match ? 'success' : 'error'](
        `After: classified "${result.classified}" (expected "${result.expected}") — email ${result.emailResult}`
      );
    } catch (e) {
      toast.error((e as Error).message || 'After step failed');
    } finally {
      setLoadingAfter(false);
    }
  };

  // Run the deadline-warning path. `dateOverride` lets the quick-set buttons run for a
  // specific simulated date without waiting for the warnDate state update to flush.
  const handleDeadlineWarn = async (dateOverride?: string) => {
    if (!fixtureId || !emailValid) return;
    const effectiveDate = dateOverride ?? warnDate;
    setLoadingDeadline(true);
    try {
      const result = await deadlineWarn(fixtureId, email, effectiveDate);
      setDeadlineResult(result);
      if (result.deadlinePassed) {
        toast.error(
          `Deadline passed — ${result.nextDeadlineName} was ${result.nextDeadlineDate}. ` +
          `Bill marked DEAD. ${result.emailResult}`
        );
      } else if (result.tier) {
        toast.success(
          `Deadline warning (${result.tier === '3' ? 'URGENT' : 'heads-up'}): ` +
          `${result.nextDeadlineName} in ${result.daysLeft}d — ${result.emailResult}`
        );
      } else if (result.nextDeadlineDate) {
        toast(
          `No email sent — next deadline "${result.nextDeadlineName}" is ${result.daysLeft}d out ` +
          `(${result.nextDeadlineDate}). Use a quick-set button to trigger a tier.`
        );
      } else {
        toast(`No warning fired — ${result.emailResult}`);
      }
    } catch (e) {
      toast.error((e as Error).message || 'Deadline warning failed');
    } finally {
      setLoadingDeadline(false);
    }
  };

  // Quick-set: target N days before the known deadline, set the date input, and re-run.
  const runForDaysBefore = (days: number) => {
    if (!deadlineResult?.nextDeadlineDate) return;
    const date = daysBefore(deadlineResult.nextDeadlineDate, days);
    setWarnDate(date);
    void handleDeadlineWarn(date);
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const { deleted } = await resetHarness(fixtureId || undefined);
      clearResults();
      toast.success(`Reset complete — deleted ${deleted} harness bill(s)`);
    } catch (e) {
      toast.error((e as Error).message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Classifier Test / Debug</h2>
        <p className="text-sm text-gray-600 mt-1">
          Run a deterministic before → after experiment against the AI bill-status classifier using a
          known fixture, then fire the change-notification email. Operates only on a throwaway test bill.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fixture</label>
            <select
              value={fixtureId}
              onChange={(e) => {
                setFixtureId(e.target.value);
                clearResults();
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {fixtures.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            {selected && (
              <p className="mt-1 text-sm text-gray-500">
                {selected.billNumber}: expects{' '}
                <span className="font-mono">{selected.beforeExpected}</span> →{' '}
                <span className="font-mono">{selected.afterExpected}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notification email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">Where the "After" / deadline-warning emails are sent.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Simulated "today" (deadline test)
            </label>
            <input
              type="date"
              value={warnDate}
              onChange={(e) => setWarnDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Leave blank and click "Preview Next Deadline" to see the bill's upcoming deadline, then use
              the quick-set buttons in the result to send a 7-day or 3-day warning. Or set a date manually.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {/* Step 1 */}
          <button
            onClick={handleBefore}
            disabled={!fixtureId || loadingBefore}
            className="flex items-center justify-center px-4 py-2 rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
          >
            {loadingBefore ? (
              <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Running…</>
            ) : (
              <><Play className="w-5 h-5 mr-2" /> 1. Run Before</>
            )}
          </button>

          {/* Step 2 — revealed only after step 1 succeeds */}
          {beforeResult && (
            <button
              onClick={handleAfter}
              disabled={!emailValid || loadingAfter}
              title={!emailValid ? 'Enter a valid email first' : ''}
              className="flex items-center justify-center px-4 py-2 rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-green-300"
            >
              {loadingAfter ? (
                <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Running…</>
              ) : (
                <><Send className="w-5 h-5 mr-2" /> 2. Inject Update + Notify</>
              )}
            </button>
          )}

          {/* Deadline warning — revealed only after step 1 succeeds.
              With a blank date this previews the bill's next deadline; with a date set
              (or via the quick-set buttons in the result card) it sends the warning email. */}
          {beforeResult && (
            <button
              onClick={() => handleDeadlineWarn()}
              disabled={!emailValid || loadingDeadline}
              title={!emailValid ? 'Enter a valid email first' : ''}
              className="flex items-center justify-center px-4 py-2 rounded-md shadow-sm text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-500 disabled:bg-rose-300"
            >
              {loadingDeadline ? (
                <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Running…</>
              ) : (
                <><AlarmClock className="w-5 h-5 mr-2" /> {warnDate ? 'Test Deadline Warning' : 'Preview Next Deadline'}</>
              )}
            </button>
          )}

          {/* Reset */}
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center justify-center px-4 py-2 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 disabled:opacity-50"
          >
            <RotateCcw className="w-5 h-5 mr-2" /> Reset
          </button>
        </div>
      </div>

      {(beforeResult || afterResult || deadlineResult) && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold text-gray-800">Results</h3>
          {beforeResult && <StepResultCard title="Before" result={beforeResult} />}
          {afterResult && <StepResultCard title="After (+ notification)" result={afterResult} />}
          {deadlineResult && (
            <div className="border border-rose-200 rounded-lg p-4 bg-rose-50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-800">Deadline Warning</h4>
                <span
                  className={
                    'inline-flex items-center px-2 py-1 rounded text-sm font-medium ' +
                    (deadlineResult.deadlinePassed
                      ? 'text-white bg-rose-600'
                      : deadlineResult.tier === '3'
                        ? 'text-red-700 bg-red-100'
                        : deadlineResult.tier === '7'
                          ? 'text-amber-700 bg-amber-100'
                          : 'text-gray-600 bg-gray-100')
                  }
                >
                  {deadlineResult.deadlinePassed
                    ? 'DEAD (deadline passed)'
                    : deadlineResult.tier === '3'
                      ? 'URGENT (3-day)'
                      : deadlineResult.tier === '7'
                        ? 'Heads-up (7-day)'
                        : 'No warning'}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500">Simulated today</dt>
                <dd className="font-mono text-gray-900">{deadlineResult.today}</dd>
                <dt className="text-gray-500">Next deadline</dt>
                <dd className="font-mono text-gray-900">{deadlineResult.nextDeadlineName ?? '—'}</dd>
                <dt className="text-gray-500">Deadline date</dt>
                <dd className="font-mono text-gray-900">{deadlineResult.nextDeadlineDate ?? '—'}</dd>
                <dt className="text-gray-500">Days left</dt>
                <dd className="font-mono text-gray-900">{deadlineResult.daysLeft ?? '—'}</dd>
                <dt className="text-gray-500">Email</dt>
                <dd className="font-mono text-gray-900 break-all">{deadlineResult.emailResult}</dd>
              </dl>

              {deadlineResult.nextDeadlineDate && (
                <div className="mt-4 pt-3 border-t border-rose-200">
                  <p className="text-sm text-gray-600 mb-2">
                    Quick-test a tier against{' '}
                    <span className="font-mono">{deadlineResult.nextDeadlineName}</span>{' '}
                    (<span className="font-mono">{deadlineResult.nextDeadlineDate}</span>):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => runForDaysBefore(7)}
                      disabled={loadingDeadline || !emailValid}
                      className="px-3 py-1.5 rounded-md text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-50"
                    >
                      Send 7-day heads-up
                    </button>
                    <button
                      onClick={() => runForDaysBefore(3)}
                      disabled={loadingDeadline || !emailValid}
                      className="px-3 py-1.5 rounded-md text-sm font-medium text-red-800 bg-red-100 hover:bg-red-200 disabled:opacity-50"
                    >
                      Send 3-day URGENT
                    </button>
                    <button
                      onClick={() => runForDaysBefore(10)}
                      disabled={loadingDeadline || !emailValid}
                      className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                      title="10 days out — outside the window, should send nothing"
                    >
                      Test outside window
                    </button>
                    <button
                      onClick={() => runForDaysBefore(-3)}
                      disabled={loadingDeadline || !emailValid}
                      className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
                      title="3 days after the deadline — bill marked DEAD, sends a DEAD digest (no urgent warning)"
                    >
                      Test past deadline (DEAD)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClassifierTestPanel;
