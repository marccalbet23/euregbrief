import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const MARKETING_TOPIC_ID = 'cda7264f-9726-4325-b737-9dfa24459fed';
const CONSENT_VERSION = '2026-09-22-v1';

const allowedRoles = new Set([
  'Waste operator / recycler',
  'Waste broker / trader',
  'Carrier / logistics',
  'Consultant / compliance',
  'Software provider',
  'Other',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('Missing Resend API key');
    return res.status(500).json({ error: 'Email service is not configured' });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = String(req.body?.role ?? '').trim();
  const marketingConsent = req.body?.marketingConsent === true;
  const consentAt = new Date().toISOString();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (!allowedRoles.has(role)) {
    return res.status(400).json({ error: 'Please select a valid role' });
  }

  const baseProperties = {
    role,
    lead_source: 'website_diwass_checklist',
  };

  const consentProperties = marketingConsent
    ? {
        marketing_consent: 'yes',
        marketing_consent_at: consentAt,
        consent_version: CONSENT_VERSION,
      }
    : {};

  try {
    const { error: createError } = await resend.contacts.create({
      email,
      unsubscribed: false,
      properties: {
        ...baseProperties,
        ...(marketingConsent
          ? consentProperties
          : {
              marketing_consent: 'no',
              marketing_consent_at: '',
              consent_version: '',
            }),
      },
      topics: [{
        id: MARKETING_TOPIC_ID,
        subscription: marketingConsent ? 'opt_in' : 'opt_out',
      }],
    });

    if (createError) {
      if (createError.statusCode !== 409) {
        console.error('Contact create failed', createError);
        return res.status(502).json({ error: 'Unable to register the email' });
      }

      const { error: updateError } = await resend.contacts.update({
        email,
        properties: {
          ...baseProperties,
          ...(marketingConsent ? consentProperties : {}),
        },
      });

      if (updateError) {
        console.error('Contact update failed', updateError);
        return res.status(502).json({ error: 'Unable to update the contact' });
      }

      if (marketingConsent) {
        const { error: topicError } = await resend.contacts.topics.update({
          email,
          topics: [{ id: MARKETING_TOPIC_ID, subscription: 'opt_in' }],
        });

        if (topicError) {
          console.error('Topic opt-in failed', topicError);
          return res.status(502).json({ error: 'Unable to save email preferences' });
        }
      }
    }

    const { error: eventError } = await resend.events.send({
      event: 'diwass.checklist.requested',
      email,
      payload: {
        role,
        marketingConsent,
        consentAt,
        consentVersion: CONSENT_VERSION,
      },
    });

    if (eventError) {
      console.error('Automation event failed', eventError);
      return res.status(502).json({ error: 'Unable to send the checklist' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}
