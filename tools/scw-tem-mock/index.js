// Dev-only mock of the Scaleway Transactional Email (TEM) HTTP API.
//
// Exposes the same surface the api targets in production
//   POST /transactional-email/v1alpha1/regions/:region/emails
// and forwards each accepted payload to the local maildev SMTP server so the
// outgoing mail is visible in the maildev UI. Any X-Auth-Token is accepted.

const express = require('express');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.PORT || 7700);
const MAILDEV_HOST = process.env.MAILDEV_HOST || 'maildev';
const MAILDEV_SMTP_PORT = Number(process.env.MAILDEV_SMTP_PORT || 1025);

const transporter = nodemailer.createTransport({
  host: MAILDEV_HOST,
  port: MAILDEV_SMTP_PORT,
  secure: false,
  ignoreTLS: true,
});

const app = express();
app.use(express.json({ limit: '5mb' }));

app.post(
  '/transactional-email/v1alpha1/regions/:region/emails',
  async (req, res) => {
    const { from, to, subject, text, html } = req.body || {};

    if (!from || !Array.isArray(to) || to.length === 0) {
      return res
        .status(400)
        .json({ message: 'invalid payload', type: 'invalid_arguments' });
    }

    try {
      const messageId = `mock-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

      await transporter.sendMail({
        from: from.name ? `${from.name} <${from.email}>` : from.email,
        to: to.map((recipient) => recipient.email).join(', '),
        subject,
        text,
        html,
      });

      return res.status(200).json({
        emails: to.map(() => ({
          id: messageId,
          message_id: messageId,
          status: 'sending',
        })),
      });
    } catch (error) {
      console.error('scw-tem-mock forward to maildev failed', error);
      return res
        .status(502)
        .json({ message: String(error), type: 'transient_error' });
    }
  }
);

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(
    `scw-tem-mock listening on :${PORT}, forwarding to ${MAILDEV_HOST}:${MAILDEV_SMTP_PORT}`
  );
});
