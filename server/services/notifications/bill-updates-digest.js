import dotenv from 'dotenv';
import { statusLabel, diffBillState } from '../statusChange.js';
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_FROM = process.env.ALERT_FROM || ' Alerts <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://foodplus.purplemaia.org';

//  brand palette (from app globals.css, HSL → hex).
const COLOR = {
  cream: '#FAF8F5',
  white: '#FFFFFF',
  teal: '#1F5C5E',
  tealSoft: '#DCE8E8',
  text: '#2D3436',
  muted: '#6C757D',
  border: '#E5E0D8',
  coral: '#C97474',
  olive: '#A8B660',
};

/**
 * Build the plain-text body of a per-user bill-update digest.
 * @param {string[]} lines - one describeChange() line per changed bill
 * @returns {string}
 */
export function buildBillUpdateBody(lines) {
  return [
    'Updates on bills you follow:',
    '',
    ...lines.map(l => `- ${l}`),
    '',
    'You are receiving this because you follow these bills in the  bill tracker.',
  ].join('\n');
}

/**
 * Escape user/bill-derived text for safe inclusion in HTML.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline-styled status badge. `variant` selects the brand color scheme.
 * @param {string} label
 * @param {'old'|'new'|'dead'|'alive'} variant
 * @returns {string}
 */
function statusPill(label, variant) {
  const schemes = {
    old: { bg: COLOR.tealSoft, fg: COLOR.text },
    new: { bg: COLOR.teal, fg: COLOR.white },
    dead: { bg: COLOR.coral, fg: COLOR.white },
    alive: { bg: COLOR.olive, fg: COLOR.text },
  };
  const { bg, fg } = schemes[variant] ?? schemes.old;
  return (
    `<span style="display:inline-block;padding:4px 12px;border-radius:999px;` +
    `background-color:${bg};color:${fg};font-size:13px;font-weight:600;` +
    `line-height:1.4;white-space:nowrap;">${escapeHtml(label)}</span>`
  );
}

/**
 * Build the status row (pills + arrow) for one change, mirroring describeChange logic.
 * @param {{ old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null }} change
 * @returns {string}
 */
function statusRow(change) {
  const { statusChanged, deadChanged } = diffBillState({
    oldStatus: change.old_status,
    newStatus: change.new_status,
    oldDead: change.old_dead,
    newDead: change.new_dead,
  });
  const pills = [];
  if (statusChanged) {
    pills.push(statusPill(statusLabel(change.old_status), 'old'));
    pills.push(
      `<span style="color:${COLOR.muted};font-size:15px;font-weight:700;` +
      `padding:0 4px;vertical-align:middle;">&rarr;</span>`,
    );
    pills.push(statusPill(statusLabel(change.new_status), 'new'));
  }
  if (deadChanged) {
    pills.push(
      Boolean(change.new_dead)
        ? statusPill('DEAD', 'dead')
        : statusPill('Revived · ALIVE', 'alive'),
    );
  }
  return `<div style="margin-top:8px;line-height:2;">${pills.join(' ')}</div>`;
}

/**
 * One branded per-bill card.
 * @param {{ bill_number: string, bill_title: string|null }} change
 * @returns {string}
 */
function billCard(change) {
  const title = change.bill_title
    ? `<div style="color:${COLOR.muted};font-size:14px;margin-top:2px;">${escapeHtml(change.bill_title)}</div>`
    : '';
  return (
    `<div style="border:1px solid ${COLOR.border};border-radius:8px;` +
    `padding:16px 18px;margin-bottom:12px;background-color:${COLOR.white};">` +
    `<div style="color:${COLOR.text};font-size:16px;font-weight:700;">${escapeHtml(change.bill_number)}</div>` +
    title +
    statusRow(change) +
    `</div>`
  );
}

/**
 * Shared branded email shell — header bar + white content card + CTA + footer.
 * Table-based layout with all-inline CSS for email-client compatibility.
 * @param {{ accent: string, title: string, subtitle: string, intro: string, cardsHtml: string, ctaLabel: string }} opts
 * @returns {string}
 */
function renderEmailShell({ accent, title, subtitle, intro, cardsHtml, ctaLabel }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bill Tracker</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.cream};font-family:Arial,Helvetica,sans-serif;color:${COLOR.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR.cream};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background-color:${accent};border-radius:12px 12px 0 0;padding:24px 28px;">
              <div style="color:${COLOR.white};font-size:22px;font-weight:700;letter-spacing:-0.3px;">${escapeHtml(title)}</div>
              <div style="color:${COLOR.white};opacity:0.85;font-size:14px;margin-top:4px;">${escapeHtml(subtitle)}</div>
            </td>
          </tr>
          <!-- Content card -->
          <tr>
            <td style="background-color:${COLOR.white};border:1px solid ${COLOR.border};border-top:none;border-radius:0 0 12px 12px;padding:24px 24px 28px;">
              <p style="margin:0 0 18px;font-size:15px;color:${COLOR.text};">
                ${escapeHtml(intro)}
              </p>
              ${cardsHtml}
              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
                <tr>
                  <td style="border-radius:8px;background-color:${accent};">
                    <a href="${escapeHtml(APP_URL)}" target="_blank"
                       style="display:inline-block;padding:12px 24px;color:${COLOR.white};font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                      ${escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:18px 24px;">
              <p style="margin:0;font-size:12px;color:${COLOR.muted};line-height:1.5;">
                You are receiving this because you follow these bills in the Bill Tracker.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build the full branded HTML body of a per-user bill-update digest.
 * @param {Array<{ bill_number: string, bill_title: string|null, old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null }>} changes
 * @returns {string}
 */
export function buildBillUpdateHtml(changes) {
  const count = changes?.length ?? 0;
  return renderEmailShell({
    accent: COLOR.teal,
    title: ' Bill Tracker',
    subtitle: 'Updates on bills you follow',
    intro: `${count === 1 ? 'A bill you follow' : `${count} bills you follow`} changed status:`,
    cardsHtml: (changes ?? []).map(billCard).join(''),
    ctaLabel: 'View in  Bill Tracker',
  });
}

// --- Deadline-warning emails (coral accent) ---------------------------------

/**
 * Build the plain-text body of a deadline-warning digest.
 * @param {Array<{ bill_number: string, bill_title: string|null, deadline_name: string, deadline_date: string, days_left: number }>} items
 * @param {{ urgent?: boolean }} [opts]
 * @returns {string}
 */
export function buildDeadlineWarningBody(items, { urgent = false } = {}) {
  const header = urgent
    ? 'URGENT — bills you follow are about to miss a deadline:'
    : 'Bills you follow are approaching a deadline:';
  return [
    header,
    '',
    ...(items ?? []).map(
      (i) =>
        `- ${i.bill_number}${i.bill_title ? ` (${i.bill_title})` : ''}: ` +
        `${i.deadline_name} on ${i.deadline_date} — ${i.days_left} day${i.days_left === 1 ? '' : 's'} left`,
    ),
    '',
    'You are receiving this because you follow these bills in the  bill tracker.',
  ].join('\n');
}

/**
 * One coral deadline-warning card: bill number, title, current status, deadline line.
 * @param {{ bill_number: string, bill_title: string|null, current_status: string|null, deadline_name: string, deadline_date: string, days_left: number }} item
 * @returns {string}
 */
function deadlineCard(item) {
  const title = item.bill_title
    ? `<div style="color:${COLOR.muted};font-size:14px;margin-top:2px;">${escapeHtml(item.bill_title)}</div>`
    : '';
  const statusPart = item.current_status
    ? `<div style="margin-top:8px;line-height:2;">${statusPill(statusLabel(item.current_status), 'old')}</div>`
    : '';
  const dayWord = item.days_left === 1 ? 'day' : 'days';
  return (
    `<div style="border:1px solid ${COLOR.border};border-left:4px solid ${COLOR.coral};border-radius:8px;` +
    `padding:16px 18px;margin-bottom:12px;background-color:${COLOR.white};">` +
    `<div style="color:${COLOR.text};font-size:16px;font-weight:700;">${escapeHtml(item.bill_number)}</div>` +
    title +
    statusPart +
    `<div style="margin-top:8px;font-size:14px;font-weight:600;color:${COLOR.coral};">` +
    `Deadline: ${escapeHtml(item.deadline_name)} on ${escapeHtml(item.deadline_date)} — ${item.days_left} ${dayWord} left` +
    `</div>` +
    `</div>`
  );
}

/**
 * Build the full branded HTML body of a per-user deadline-warning digest (coral accent).
 * @param {Array<{ bill_number: string, bill_title: string|null, current_status: string|null, deadline_name: string, deadline_date: string, days_left: number }>} items
 * @param {{ urgent?: boolean }} [opts]
 * @returns {string}
 */
export function buildDeadlineWarningHtml(items, { urgent = false } = {}) {
  const count = items?.length ?? 0;
  return renderEmailShell({
    accent: COLOR.coral,
    title: urgent ? 'URGENT: Deadline approaching' : 'Deadline approaching',
    subtitle: 'Bills you follow are at risk',
    intro:
      `${count === 1 ? 'A bill you follow is' : `${count} bills you follow are`} ` +
      `approaching a legislative deadline and may die if they don't advance in time:`,
    cardsHtml: (items ?? []).map(deadlineCard).join(''),
    ctaLabel: 'View in  Bill Tracker',
  });
}

/**
 * Send a bill-update digest email to a single user via Resend.
 * Fire-and-forget safe — catches its own errors so it never crashes the caller.
 * NOTE: recipient is the user's own email, NOT ALERT_EMAIL (which is for cron failures only).
 * @param {string} toEmail
 * @param {string[]} lines - describeChange() lines for this user's changed bills (text fallback)
 * @param {Array<object>} [changes] - structured change records for the branded HTML body
 */
export async function sendBillUpdateEmail(toEmail, lines, changes) {
  if (!RESEND_API_KEY) {
    console.error('[NOTIFY] RESEND_API_KEY not set — skipping bill update email');
    return;
  }
  if (!toEmail || !lines?.length) {
    return;
  }

  const payload = {
    from: ALERT_FROM,
    to: [toEmail],
    subject: ` Bill Tracker: ${lines.length} update${lines.length === 1 ? '' : 's'} on bills you follow`,
    text: buildBillUpdateBody(lines),
  };
  if (changes?.length) {
    payload.html = buildBillUpdateHtml(changes);
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[NOTIFY] Resend API error (${response.status}) for ${toEmail}: ${errorText}`);
    } else {
      console.log(`[NOTIFY] Bill update email sent to ${toEmail} (${lines.length} changes)`);
    }
  } catch (error) {
    console.error(`[NOTIFY] Failed to send bill update email to ${toEmail}:`, error.message);
  }
}

/**
 * Send a deadline-warning digest email to a single user via Resend.
 * Fire-and-forget safe — catches its own errors so it never crashes the caller.
 * @param {string} toEmail
 * @param {Array<{ bill_number: string, bill_title: string|null, current_status: string|null, deadline_name: string, deadline_date: string, days_left: number }>} items
 * @param {{ urgent?: boolean }} [opts] urgent = the 3-day tier (any item within 3 days)
 */
export async function sendDeadlineWarningEmail(toEmail, items, { urgent = false } = {}) {
  if (!RESEND_API_KEY) {
    console.error('[NOTIFY] RESEND_API_KEY not set — skipping deadline warning email');
    return;
  }
  if (!toEmail || !items?.length) {
    return;
  }

  const count = items.length;
  const subject =
    `${urgent ? 'URGENT — ' : ''} Bill Tracker: deadline approaching for ` +
    `${count} bill${count === 1 ? '' : 's'} you follow`;

  const payload = {
    from: ALERT_FROM,
    to: [toEmail],
    subject,
    text: buildDeadlineWarningBody(items, { urgent }),
    html: buildDeadlineWarningHtml(items, { urgent }),
  };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[NOTIFY] Resend API error (${response.status}) for ${toEmail}: ${errorText}`);
    } else {
      console.log(`[NOTIFY] Deadline warning email sent to ${toEmail} (${count} bills, urgent=${urgent})`);
    }
  } catch (error) {
    console.error(`[NOTIFY] Failed to send deadline warning email to ${toEmail}:`, error.message);
  }
}
