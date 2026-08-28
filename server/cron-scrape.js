/* Exclusive file function for cron job to call (same logic as main() in scrapingService.js) */
import { startScraping } from './services/scrapingService.js';
import { sendAlertEmail } from './services/notifications/cron-alerts.js';
import { sendStatusChangeNotifications } from './services/notificationService.js';
import { checkApproachingDeadlines, checkTestimonyDeadlines, sendDeadlineWarnings } from './services/notifications/deadline-warnings.js';
import { runSimDay } from './services/sim/simRunner.js';
import { fetchLivingNonSim, fetchLivingNonSimWithStatus } from './services/sim/simDeadlineFetchers.js';

async function cronScrape() {
    const currentYear = new Date().getFullYear();
    console.log(`Starting cron job, scraping for year ${currentYear}...`);

    const houseURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;
    const senateURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=sb&title=Senate%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;

    const errors = [];

    // Scrape House bills URL
    console.log('[MAIN] Scraping House bills...');
    const houseResult = await startScraping(houseURL);
    console.log(`[MAIN] Finished scraping House bills in ${houseResult.durationMin} minutes.`);

    if (!houseResult.totalBills) {
      errors.push(`House bills: 0 bills scraped from ${houseURL}`);
    }

    // Scrape Senate bills URL
    console.log('[MAIN] Scraping Senate bills...');
    const senateResult = await startScraping(senateURL);
    console.log(`[MAIN] Finished scraping Senate bills in ${senateResult.durationMin} minutes.`);

    if (!senateResult.totalBills) {
      errors.push(`Senate bills: 0 bills scraped from ${senateURL}`);
    }

    // Collect all individual failures across both chambers
    const allIndividualFailures = [];
    for (const [label, result] of [['House', houseResult], ['Senate', senateResult]]) {
      if (result?.individualFailCount > 0) {
        errors.push(`${label}: ${result.individualFailCount}/${result.totalIndividual} individual bill scrapes failed`);
        for (const f of (result.individualFailures || [])) {
          allIndividualFailures.push({ ...f, chamber: label });
        }
      }
    }

    // Send cron job alert email if there were any errors or individual failures
    if (errors.length > 0) {
      const body = [
        `Cron job completed at ${new Date().toISOString()} with issues:`,
        '',
        ...errors.map(e => `- ${e}`),
        '',
        `Year: ${currentYear}`,
        `House bills scraped: ${houseResult.totalBills ?? 0}`,
        `Senate bills scraped: ${senateResult.totalBills ?? 0}`,
      ];

      if (allIndividualFailures.length > 0) {
        body.push('', '--- Individual Bill Failures ---', '');
        for (const f of allIndividualFailures) {
          body.push(`  [${f.chamber}] Bill ID ${f.billId}: ${f.reason}`);
        }
      }

      await sendAlertEmail('Scraping completed with failures', body.join('\n'));
    }

    // Notify followers of any bill status / dead changes detected this run.
    // Merge changes collected across both chambers. Wrapped so a notification
    // failure never fails the scrape.
    // Sim Week: if today is within the Sept 14–18 sim window, advance the fake
    // bills through their scenarios and fold their changes into the digest.
    // Wrapped and isolated (sentinel test://sim-week/ bills) so it never affects
    // the real scrape. No-op outside the window. See docs/…/sim-week-design.md.
    let simChanges = [];
    try {
      const today = new Date().toISOString().split('T')[0];
      const sim = await runSimDay(today);
      simChanges = sim.statusChanges;
      if (sim.simDay > 0) {
        console.log(`[MAIN] Sim Week day ${sim.simDay}: ${simChanges.length} change(s) across ${sim.summary.length} sim bill(s).`);
      }
    } catch (simErr) {
      console.error('[MAIN] Sim Week advance failed (ignored):', simErr);
    }

    try {
      const allChanges = [
        ...(houseResult?.statusChanges || []),
        ...(senateResult?.statusChanges || []),
        ...simChanges,
      ];
      const { usersNotified, changesSent } = await sendStatusChangeNotifications(allChanges);
      console.log(`[MAIN] Notifications: ${usersNotified} user(s), ${changesSent} change(s)`);
    } catch (notifyErr) {
      console.error('[MAIN] Notification dispatch failed:', notifyErr);
      await sendAlertEmail('Bill notification dispatch failed', [
        `The follower notification step failed at ${new Date().toISOString()}.`,
        '',
        `Error: ${notifyErr?.message || notifyErr}`,
        '',
        notifyErr?.stack || 'No stack trace available',
      ].join('\n'));
    }

    // Warn followers of bills approaching a legislative deadline (7-day heads-up,
    // 3-day urgent). Runs on the fresh bill_status data this scrape just persisted.
    // Wrapped so a failure never fails the scrape.
    try {
      const today = new Date().toISOString().split('T')[0];
      // Two sources feed the same warning email: approaching legislative deadlines
      // (7-day / 3-day tiers) and testimony windows closing (hearing within ~24h).
      // Exclude sim bills from the real deadline scan: the real session
      // deadlines all predate the sim window, so sim bills would otherwise read
      // as "missed deadline". (See docs/…/sim-week-design.md §5a.)
      const [deadlineWarnings, testimonyWarnings] = await Promise.all([
        checkApproachingDeadlines(today, { fetchBills: fetchLivingNonSim }),
        checkTestimonyDeadlines(today, { fetchBills: fetchLivingNonSimWithStatus }),
      ]);
      const warnings = [...deadlineWarnings, ...testimonyWarnings];
      const { usersNotified } = await sendDeadlineWarnings(warnings);
      console.log(`[MAIN] Deadline warnings: ${usersNotified} user(s), ${warnings.length} bill(s) (${testimonyWarnings.length} testimony-closing)`);
    } catch (deadlineErr) {
      console.error('[MAIN] Deadline warning dispatch failed:', deadlineErr);
      await sendAlertEmail('Deadline warning dispatch failed', [
        `The deadline warning step failed at ${new Date().toISOString()}.`,
        '',
        `Error: ${deadlineErr?.message || deadlineErr}`,
        '',
        deadlineErr?.stack || 'No stack trace available',
      ].join('\n'));
    }
}

cronScrape().catch(async (error) => {
  console.error('Error during cron job scraping:', error);

  await sendAlertEmail('Cron job CRASHED', [
    `The daily scrape cron job crashed at ${new Date().toISOString()}.`,
    '',
    `Error: ${error?.message || error}`,
    '',
    `Stack trace:`,
    error?.stack || 'No stack trace available',
  ].join('\n'));

  process.exit(1);
});

