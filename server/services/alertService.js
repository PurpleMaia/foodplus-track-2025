import dotenv from 'dotenv';
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'jaden.kapali@purplemaia.org';
const ALERT_FROM = process.env.ALERT_FROM || 'Food+ Alerts <onboarding@resend.dev>';

/**
 * Send an alert email via Resend API.
 * Fire-and-forget safe — catches its own errors so it never crashes the caller.
 */
export async function sendAlertEmail(subject, body) {
  if (!RESEND_API_KEY) {
    console.error('[ALERT] RESEND_API_KEY not set — skipping email alert');
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [ALERT_EMAIL],
        subject: `[Food+ Cron] ${subject}`,
        text: body,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ALERT] Resend API error (${response.status}): ${errorText}`);
    } else {
      console.log(`[ALERT] Alert email sent: ${subject}`);
    }
  } catch (error) {
    console.error('[ALERT] Failed to send alert email:', error.message);
  }
}

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
 * Send a bill-update digest email to a single user via Resend.
 * Fire-and-forget safe — catches its own errors so it never crashes the caller.
 * NOTE: recipient is the user's own email, NOT ALERT_EMAIL (which is for cron failures only).
 * @param {string} toEmail
 * @param {string[]} lines - describeChange() lines for this user's changed bills
 */
export async function sendBillUpdateEmail(toEmail, lines) {
  if (!RESEND_API_KEY) {
    console.error('[NOTIFY] RESEND_API_KEY not set — skipping bill update email');
    return;
  }
  if (!toEmail || lines.length === 0) {
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to: [toEmail],
        subject: `Food+ Bill Tracker: ${lines.length} update${lines.length === 1 ? '' : 's'} on bills you follow`,
        text: buildBillUpdateBody(lines),
      }),
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
