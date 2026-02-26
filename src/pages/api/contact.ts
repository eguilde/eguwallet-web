import type { APIRoute } from 'astro';
import nodemailer from 'nodemailer';

export const prerender = false;

// SMTP config — points to haraka on egucluster3
// Set via docker-compose environment variables
const transporter = nodemailer.createTransport({
  host:   import.meta.env.SMTP_HOST   || '172.17.0.1',   // Docker host gateway → haraka
  port:   Number(import.meta.env.SMTP_PORT)   || 25,
  secure: false,
  ignoreTLS: true,  // haraka handles TLS on outbound; internal submission is plain
});

const CONTACT_EMAIL = import.meta.env.CONTACT_EMAIL || 'contact@eguwallet.eu';
const FROM_EMAIL    = import.meta.env.FROM_EMAIL    || 'noreply@eguwallet.eu';

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid request body' }, 400);
  }

  const { name, email, subject, message, language } = body;

  if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    return json({ success: false, message: 'Missing required fields' }, 422);
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'Invalid email address' }, 422);
  }

  // Sanitize inputs — strip HTML tags
  const clean = (s: string) => s.replace(/<[^>]*>/g, '').trim().slice(0, 2000);

  try {
    await transporter.sendMail({
      from:     `"EguWallet Contact" <${FROM_EMAIL}>`,
      to:       CONTACT_EMAIL,
      replyTo:  `"${clean(name)}" <${email}>`,
      subject:  `[EguWallet Contact] ${clean(subject)} — ${clean(name)}`,
      text: [
        `From:     ${clean(name)} <${email}>`,
        `Language: ${language || 'unknown'}`,
        `Topic:    ${clean(subject)}`,
        '',
        clean(message),
      ].join('\n'),
      html: `
        <p><strong>From:</strong> ${clean(name)} &lt;${email}&gt;</p>
        <p><strong>Language:</strong> ${language || 'unknown'}</p>
        <p><strong>Topic:</strong> ${clean(subject)}</p>
        <hr/>
        <p style="white-space:pre-wrap">${clean(message)}</p>
      `,
    });

    return json({ success: true, message: 'Message sent' });
  } catch (err) {
    console.error('[contact] SMTP error:', err);
    return json({ success: false, message: 'Failed to send message. Please email us directly.' }, 500);
  }
};

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
