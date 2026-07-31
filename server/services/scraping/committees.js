import { db } from '../../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  getRandomUserAgent,
  delay,
  MAIN_LIST_TIMEOUT,
  MAIN_LIST_MAX_RETRIES,
  MAIN_LIST_RETRY_DELAY,
} from './config.js';

// The `www.capitol` host 403s bot traffic; `data.capitol` serves the same page
// and is what the legislators scraper already uses.
const COMMITTEES_URL = 'https://data.capitol.hawaii.gov/legislature/committees.aspx?chamber=all';

const ROLES = { chair: 'chair', vice_chair: 'vice_chair' };

const collapseWhitespace = (s) => (s || '').replace(/\s+/g, ' ').trim();

// "/legislature/memberpage.aspx?member=252&year=2026" -> "252"
const memberIdFromHref = (href) => (/member=(\d+)/.exec(href || '') || [])[1] || null;

/**
 * Parse the committees page HTML into an array of committee objects.
 * Pure (no network) so it can be unit-tested against a saved fixture.
 *
 * The page is a single ASP.NET GridView (`#MainContent_GridView1`) with NO
 * header row — every <tr> is a committee, so the first row must not be skipped.
 *
 * @param {string} html
 * @returns {{ committees: object[], failures: { reason: string }[] }}
 */
export function parseCommitteeList(html) {
  const $ = cheerio.load(html);
  const committees = [];
  const failures = [];

  const table = $('table[id*="GridView"]').first();

  table.find('tr').each((_, el) => {
    const row = $(el);
    try {
      // The acronym and name links share the `HyperLinkComm` id prefix, so the
      // name selector must exclude the `...CommAcro` one.
      const acronym = collapseWhitespace(row.find('a[id*="HyperLinkCommAcro"]').first().text());
      const name = collapseWhitespace(
        row.find('a[id*="HyperLinkComm"]').not('[id*="Acro"]').first().text()
      );

      // Skip anything that isn't a committee row (stray layout/header rows).
      if (!acronym && !name) return;
      if (!acronym) {
        failures.push({ reason: `Committee row with no acronym (name: "${name}")` });
        return;
      }

      // Chamber lives in a sibling <span> ("Senate Committee on"), NOT in the
      // name text. Names alone are ambiguous — EDN (House) and EDU (Senate) are
      // both "Education", HOU and HSG are both "Housing".
      const chamberLine = collapseWhitespace(row.find('span[id*="Label1"]').first().text());
      const chamberMatch = /^(House|Senate)/i.exec(chamberLine);
      const chamber = chamberMatch
        ? chamberMatch[1][0].toUpperCase() + chamberMatch[1].slice(1).toLowerCase()
        : null;

      // Chair / vice-chair are the photo links; the member id is the same
      // identifier stored as legislators.member_id.
      const chairMemberId = memberIdFromHref(
        row.find('a[id*="HyperLinkmemberphotos"]').first().attr('href')
      );
      const viceChairMemberId = memberIdFromHref(
        row.find('a[id*="HyperLinkVicememberphotos"]').first().attr('href')
      );

      committees.push({
        acronym,
        name: name || null,
        chamber,
        chairMemberId,
        viceChairMemberId,
      });
    } catch (error) {
      failures.push({ reason: error.message });
    }
  });

  return { committees, failures };
}

// Identity of a chair "seat": a legislator holding a role. Same legislator in a
// different role (vice_chair -> chair) is a different seat, so role is part of it.
const seatKey = (row) => `${row.legislator_id}::${row.role}`;

/**
 * Decide which chair rows to retire and which to insert for one committee.
 * Pure (no DB) so it can be unit-tested: the soft-delete history logic lives here.
 *
 * @param {{ id: string, legislator_id: string, role: string }[]} activeRows
 *   the committee's currently-active chair rows from the DB
 * @param {{ legislator_id: string, role: string }[]} scrapedPairs
 *   the chairs seen in this scrape
 * @returns {{ toRetire: string[], toInsert: { legislator_id: string, role: string }[] }}
 *   toRetire = ids of active rows no longer scraped; toInsert = scraped seats not
 *   already active. Seats present in both are left untouched (started_at survives).
 */
export function diffChairs(activeRows, scrapedPairs) {
  const activeKeys = new Set(activeRows.map(seatKey));
  const scrapedKeys = new Set(scrapedPairs.map(seatKey));

  const toRetire = activeRows
    .filter((row) => !scrapedKeys.has(seatKey(row)))
    .map((row) => row.id);

  const toInsert = scrapedPairs
    .filter((pair) => !activeKeys.has(seatKey(pair)))
    .map((pair) => ({ legislator_id: pair.legislator_id, role: pair.role }));

  return { toRetire, toInsert };
}

/**
 * Fetch the committees page with retry, then parse it.
 * @returns {Promise<{ committees: object[], failures: object[] }>}
 */
export async function scrapeCommittees() {
  let lastError;

  for (let attempt = 1; attempt <= MAIN_LIST_MAX_RETRIES; attempt++) {
    try {
      console.log(`[COMMITTEES] Scraping committees page (attempt ${attempt}/${MAIN_LIST_MAX_RETRIES})...`);
      await delay(attempt === 1 ? 1000 : MAIN_LIST_RETRY_DELAY);

      const response = await axios.get(COMMITTEES_URL, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html',
          Referer: 'https://data.capitol.hawaii.gov',
        },
        timeout: MAIN_LIST_TIMEOUT,
        maxRedirects: 5,
      });

      const result = parseCommitteeList(response.data);
      console.log(`[COMMITTEES] Parsed ${result.committees.length} committees (${result.failures.length} parse failures)`);
      return result;
    } catch (error) {
      lastError = error;
      const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase().includes('timeout');
      const isNetworkError = error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' ||
        error?.response?.status === 503 || error?.response?.status === 502;

      if ((isTimeout || isNetworkError) && attempt < MAIN_LIST_MAX_RETRIES) {
        console.warn(`[COMMITTEES] Attempt ${attempt} failed (${error.message}). Retrying in ${MAIN_LIST_RETRY_DELAY / 1000}s...`);
        continue;
      }

      console.error(`[COMMITTEES] Failed after ${attempt} attempt(s):`, error.message);
      throw error;
    }
  }

  throw lastError;
}

/**
 * Upsert committees by acronym and reconcile their chair rows via soft-delete.
 *
 * Chairs link to `legislators` by the scraped `member=NNN` id, which is exactly
 * `legislators.member_id` — no name matching. A chair whose legislator row does
 * not exist yet is reported as a failure and skipped; the committee still saves.
 * Run the legislators scrape first so the FK targets exist.
 *
 * Chair changes are reconciled, not overwritten: a chair no longer present is
 * retired (is_active=false, ended_at set) rather than deleted, and an unchanged
 * chair is left untouched so its started_at survives. `chairsChanged` counts only
 * newly-inserted chairs this run — 0 on a no-op re-run is expected, not an error.
 *
 * @param {{ committees: object[], failures?: object[] }} scraped
 * @returns {Promise<{ total, inserted, updated, deactivated, chairsChanged, chairsRetired, failures }>}
 */
export async function saveCommittees({ committees, failures = [] }) {
  if (!committees || committees.length === 0) {
    console.log('[COMMITTEES] No committees to save');
    return { total: 0, inserted: 0, updated: 0, deactivated: 0, chairsChanged: 0, chairsRetired: 0, failures };
  }

  console.log(`[COMMITTEES] Saving ${committees.length} committees...`);

  // One lookup for the whole run: member_id -> legislators.id
  const legislatorRows = await db
    .selectFrom('legislators')
    .select(['id', 'member_id'])
    .execute();
  const legislatorIdByMemberId = new Map(
    legislatorRows.map((l) => [String(l.member_id), l.id])
  );
  if (legislatorIdByMemberId.size === 0) {
    console.warn('[COMMITTEES] legislators table is empty — no chairs can be linked. Run the legislators scrape first.');
  }

  let inserted = 0;
  let updated = 0;
  let chairsChanged = 0;
  let chairsRetired = 0;
  const scrapedAcronyms = [];

  for (const committee of committees) {
    scrapedAcronyms.push(committee.acronym);

    // Isolate failures: one bad committee never fails the whole run.
    try {
      const attrs = {
        name: committee.name,
        chamber: committee.chamber,
        is_active: true,
      };

      const existing = await db
        .selectFrom('committees')
        .select('id')
        .where('acronym', '=', committee.acronym)
        .limit(1)
        .executeTakeFirst();

      let committeeId;
      if (existing) {
        await db
          .updateTable('committees')
          .set({ ...attrs, updated_at: new Date() })
          .where('id', '=', existing.id)
          .execute();
        committeeId = existing.id;
        updated++;
      } else {
        const row = await db
          .insertInto('committees')
          .values({
            acronym: committee.acronym,
            ...attrs,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        committeeId = row.id;
        inserted++;
      }

      // Resolve this committee's scraped chairs to legislator rows.
      const scrapedPairs = [];
      for (const [role, memberId] of [
        [ROLES.chair, committee.chairMemberId],
        [ROLES.vice_chair, committee.viceChairMemberId],
      ]) {
        if (!memberId) continue; // committee simply has no one in that seat
        const legislatorId = legislatorIdByMemberId.get(String(memberId));
        if (!legislatorId) {
          failures.push({
            acronym: committee.acronym,
            member_id: memberId,
            reason: `${role}: no legislators row for member_id ${memberId}`,
          });
          continue;
        }
        scrapedPairs.push({ legislator_id: legislatorId, role });
      }

      // Soft-delete diff: retire chairs no longer scraped, insert new ones, and
      // leave unchanged chairs alone so their started_at survives. Retired rows
      // stay as history (is_active=false) instead of being deleted. Scoped to
      // this committee only.
      const activeRows = await db
        .selectFrom('committee_chairs')
        .select(['id', 'legislator_id', 'role'])
        .where('committee_id', '=', committeeId)
        .where('is_active', '=', true)
        .execute();

      const { toRetire, toInsert } = diffChairs(activeRows, scrapedPairs);

      if (toRetire.length > 0) {
        await db
          .updateTable('committee_chairs')
          .set({ is_active: false, ended_at: new Date(), updated_at: new Date() })
          .where('id', 'in', toRetire)
          .execute();
        chairsRetired += toRetire.length;
      }
      if (toInsert.length > 0) {
        await db
          .insertInto('committee_chairs')
          .values(
            toInsert.map((pair) => ({
              committee_id: committeeId,
              legislator_id: pair.legislator_id,
              role: pair.role,
              is_active: true,
              started_at: new Date(),
              created_at: new Date(),
              updated_at: new Date(),
            }))
          )
          .execute();
        chairsChanged += toInsert.length;
      }
    } catch (error) {
      console.error(`[COMMITTEES] Error saving committee ${committee.acronym}:`, error.message);
      failures.push({ acronym: committee.acronym, reason: error.message });
    }
  }

  // Deactivation sweep: committees in the DB but absent from this scrape are no
  // longer active. Never deletes, so history survives (mirrors legislators).
  let deactivated = 0;
  try {
    const result = await db
      .updateTable('committees')
      .set({ is_active: false, updated_at: new Date() })
      .where('acronym', 'not in', scrapedAcronyms)
      .where('is_active', '=', true)
      .executeTakeFirst();
    deactivated = Number(result?.numUpdatedRows ?? 0n);
  } catch (error) {
    console.error('[COMMITTEES] Error during deactivation sweep:', error.message);
    failures.push({ reason: `deactivation sweep: ${error.message}` });
  }

  console.log(`[COMMITTEES] Saved: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated, ${chairsChanged} chair(s) added, ${chairsRetired} retired`);
  return {
    total: committees.length,
    inserted,
    updated,
    deactivated,
    chairsChanged,
    chairsRetired,
    failures,
  };
}
