import dotenv from 'dotenv';
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'data@purplemaia.org';
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