import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const SEGMENT_ID = process.env.RESEND_DIWASS_SEGMENT_ID;

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

  if (!process.env.RESEND_API_KEY || !SEGMENT_ID) {
    console.error('Missing Resend environment variables');
    return res.status(500).json({ error: 'Email service is not configured' });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = String(req.body?.role ?? '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  if (!allowedRoles.has(role)) {
    return res.status(400).json({ error: 'Please select a valid role' });
  }

  try {
    const { error: createError } = await resend.contacts.create({
      email,
      unsubscribed: false,
      properties: { role },
      segments: [{ id: SEGMENT_ID }],
    });

    if (createError) {
      if (createError.statusCode !== 409) {
        console.error('Contact create failed', createError);
        return res.status(502).json({ error: 'Unable to register the email' });
      }

      const { error: updateError } = await resend.contacts.update({
        email,
        properties: { role },
      });

      if (updateError) {
        console.error('Contact update failed', updateError);
        return res.status(502).json({ error: 'Unable to update the contact' });
      }

      const { error: segmentError } = await resend.contacts.segments.add({
        email,
        segmentId: SEGMENT_ID,
      });

      if (segmentError && segmentError.statusCode !== 409) {
        console.error('Segment assignment failed', segmentError);
        return res.status(502).json({ error: 'Unable to assign the contact' });
      }
    }

    const { error: eventError } = await resend.events.send({
      event: 'diwass.checklist.requested',
      email,
      payload: { role },
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
