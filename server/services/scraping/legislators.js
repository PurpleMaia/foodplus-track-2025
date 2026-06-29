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

const LEGISLATORS_URL = 'https://data.capitol.hawaii.gov/legislature/legislators.aspx';

// Cards carry "Term of Office Ended: MM/DD/YYYY" when a member's term has ended.
const TERM_ENDED_RE = /Term of Office Ended:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i;

const collapseWhitespace = (s) => (s || '').replace(/\s+/g, ' ').trim();

// "MM/DD/YYYY" -> "YYYY-MM-DD" for a Postgres date column. Returns null if unparseable.
function toIsoDate(mdY) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdY?.trim() || '');
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * Parse the legislators page HTML into an array of legislator objects.
 * Pure (no network) so it can be unit-tested against a saved fixture.
 * @param {string} html
 * @returns {{ legislators: object[], failures: { reason: string }[] }}
 */
export function parseLegislators(html) {
  const $ = cheerio.load(html);
  const legislators = [];
  const failures = [];

  $('div.legislator-list').each((_, el) => {
    const card = $(el);
    try {
      const href = card.find('#member-link').attr('href') || '';
      const memberId = (/member=(\d+)/.exec(href) || [])[1];
      if (!memberId) {
        failures.push({ reason: `No member id (href: "${href}")` });
        return;
      }

      // Name: read from h2.namecard only (ignores any title text in the <a>).
      const nameRaw = collapseWhitespace(card.find('h2.namecard').text());
      // "Last, First M. (P)" -> split on first comma.
      const commaIdx = nameRaw.indexOf(',');
      const lastName = commaIdx >= 0 ? nameRaw.slice(0, commaIdx).trim() : nameRaw;
      let remainder = commaIdx >= 0 ? nameRaw.slice(commaIdx + 1).trim() : '';
      let party = null;
      const partyMatch = /\(([DR])\)\s*$/.exec(remainder);
      if (partyMatch) {
        party = partyMatch[1];
        remainder = remainder.slice(0, partyMatch.index).trim();
      }
      const firstName = remainder;

      // District line: leading text node of div.district, e.g. "Senate District 17".
      const districtDiv = card.find('div.district');
      const districtLine = collapseWhitespace(
        districtDiv.contents().first().text()
      );
      const chamberMatch = /^(House|Senate)/i.exec(districtLine);
      const chamber = chamberMatch
        ? chamberMatch[1][0].toUpperCase() + chamberMatch[1].slice(1).toLowerCase()
        : null;
      const districtNumMatch = /District\s+(\d+)/i.exec(districtLine);
      const district = districtNumMatch ? parseInt(districtNumMatch[1], 10) : null;

      const area = collapseWhitespace(districtDiv.find('strong').first().text()) || null;

      // Contact block.
      const addressText = card.find('address').text();
      const roomMatch = /Room\s+([^\n<]+?)\s*(?:\n|$)/i.exec(addressText);
      const room = roomMatch ? roomMatch[1].trim() : null;
      // Handles both "Phone/Fax: NNN" and "Phone: NNN" (captures the Phone number).
      const phoneMatch = /Phone(?:\/Fax)?:\s*([0-9-]+)/i.exec(addressText);
      const phone = phoneMatch ? phoneMatch[1] : null;
      const mailto = card.find('address a[href^="mailto:"]').attr('href');
      const email = mailto ? mailto.replace(/^mailto:/i, '').trim() : null;

      // Out-of-office: check the card text for the term-ended verbiage.
      const termMatch = TERM_ENDED_RE.exec(card.text());
      const outOfOffice = Boolean(termMatch);
      const term_ended = termMatch ? toIsoDate(termMatch[1]) : null;

      legislators.push({
        member_id: memberId,
        last_name: lastName || null,
        first_name: firstName || null,
        party,
        chamber,
        district,
        area,
        room,
        phone,
        email,
        outOfOffice,
        term_ended,
      });
    } catch (error) {
      failures.push({ reason: error.message });
    }
  });

  return { legislators, failures };
}

/**
 * Fetch the legislators page with retry, then parse it.
 * @returns {Promise<{ legislators: object[], failures: object[] }>}
 */
export async function scrapeLegislators() {
  let lastError;

  for (let attempt = 1; attempt <= MAIN_LIST_MAX_RETRIES; attempt++) {
    try {
      console.log(`[LEGISLATORS] Scraping legislators page (attempt ${attempt}/${MAIN_LIST_MAX_RETRIES})...`);
      await delay(attempt === 1 ? 1000 : MAIN_LIST_RETRY_DELAY);

      const response = await axios.get(LEGISLATORS_URL, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html',
          Referer: 'https://data.capitol.hawaii.gov',
        },
        timeout: MAIN_LIST_TIMEOUT,
        maxRedirects: 5,
      });

      const result = parseLegislators(response.data);
      console.log(`[LEGISLATORS] Parsed ${result.legislators.length} legislators (${result.failures.length} parse failures)`);
      return result;
    } catch (error) {
      lastError = error;
      const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase().includes('timeout');
      const isNetworkError = error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' ||
        error?.response?.status === 503 || error?.response?.status === 502;

      if ((isTimeout || isNetworkError) && attempt < MAIN_LIST_MAX_RETRIES) {
        console.warn(`[LEGISLATORS] Attempt ${attempt} failed (${error.message}). Retrying in ${MAIN_LIST_RETRY_DELAY / 1000}s...`);
        continue;
      }

      console.error(`[LEGISLATORS] Failed after ${attempt} attempt(s):`, error.message);
      throw error;
    }
  }

  throw lastError;
}

/**
 * Upsert legislators by member_id, preserving history. Legislators absent from
 * the scrape (or carrying term-ended verbiage) are marked in_office = false.
 * @param {{ legislators: object[], failures?: object[] }} scraped
 * @returns {Promise<{ total: number, inserted: number, updated: number, deactivated: number, failures: object[] }>}
 */
export async function saveLegislators({ legislators, failures = [] }) {
  if (!legislators || legislators.length === 0) {
    console.log('[LEGISLATORS] No legislators to save');
    return { total: 0, inserted: 0, updated: 0, deactivated: 0, failures };
  }

  console.log(`[LEGISLATORS] Saving ${legislators.length} legislators...`);

  let inserted = 0;
  let updated = 0;
  const scrapedIds = [];

  for (const leg of legislators) {
    scrapedIds.push(leg.member_id);
    const attrs = {
      last_name: leg.last_name,
      first_name: leg.first_name,
      party: leg.party,
      chamber: leg.chamber,
      district: leg.district,
      area: leg.area,
      room: leg.room,
      phone: leg.phone,
      email: leg.email,
      in_office: !leg.outOfOffice,
      term_ended: leg.term_ended,
    };

    try {
      const existing = await db
        .selectFrom('legislators')
        .select('id')
        .where('member_id', '=', leg.member_id)
        .limit(1)
        .executeTakeFirst();

      if (existing) {
        await db
          .updateTable('legislators')
          .set({ ...attrs, updated_at: new Date() })
          .where('id', '=', existing.id)
          .execute();
        updated++;
      } else {
        await db
          .insertInto('legislators')
          .values({
            member_id: leg.member_id,
            ...attrs,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();
        inserted++;
      }
    } catch (error) {
      console.error(`[LEGISLATORS] Error saving member ${leg.member_id}:`, error.message);
      failures.push({ member_id: leg.member_id, reason: error.message });
    }
  }

  // Deactivation sweep: anyone in the DB not in this scrape is out of office.
  let deactivated = 0;
  try {
    const result = await db
      .updateTable('legislators')
      .set({ in_office: false, updated_at: new Date() })
      .where('member_id', 'not in', scrapedIds)
      .where('in_office', '=', true)
      .executeTakeFirst();
    deactivated = Number(result?.numUpdatedRows ?? 0n);
  } catch (error) {
    console.error('[LEGISLATORS] Error during deactivation sweep:', error.message);
    failures.push({ reason: `deactivation sweep: ${error.message}` });
  }

  console.log(`[LEGISLATORS] Saved: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated`);
  return { total: legislators.length, inserted, updated, deactivated, failures };
}
