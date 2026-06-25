import dotenv from 'dotenv';
import { statusLabel, diffBillState } from '../statusChange.js';
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_FROM = process.env.ALERT_FROM || 'Food+ Alerts <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://foodplus.purplemaia.org';

// Food+ brand palette (from app globals.css, HSL → hex).
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
    'You are receiving this because you follow these bills in the Food+ bill tracker.',
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
 * Build the full branded HTML body of a per-user bill-update digest.
 * Table-based layout with all-inline CSS for email-client compatibility.
 * @param {Array<{ bill_number: string, bill_title: string|null, old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null }>} changes
 * @returns {string}
 */
export function buildBillUpdateHtml(changes) {
  const count = changes?.length ?? 0;
  const cards = (changes ?? []).map(billCard).join('');

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
            <td style="background-color:${COLOR.teal};border-radius:12px 12px 0 0;padding:24px 28px;">
              <div style="color:${COLOR.white};font-size:22px;font-weight:700;letter-spacing:-0.3px;">Bill Tracker</div>
              <div style="color:${COLOR.tealSoft};font-size:14px;margin-top:4px;">Updates on bills you follow</div>
            </td>
          </tr>
          <!-- Content card -->
          <tr>
            <td style="background-color:${COLOR.white};border:1px solid ${COLOR.border};border-top:none;border-radius:0 0 12px 12px;padding:24px 24px 28px;">
              <p style="margin:0 0 18px;font-size:15px;color:${COLOR.text};">
                ${count === 1 ? 'A bill you follow' : `${count} bills you follow`} changed status:
              </p>
              ${cards}
              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
                <tr>
                  <td style="border-radius:8px;background-color:${COLOR.teal};">
                    <a href="${escapeHtml(APP_URL)}" target="_blank"
                       style="display:inline-block;padding:12px 24px;color:${COLOR.white};font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                      View in Bill Tracker
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
                You are receiving this because you follow these bills in the Food+ bill tracker.
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
    subject: `Food+ Bill Tracker: ${lines.length} update${lines.length === 1 ? '' : 's'} on bills you follow`,
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
