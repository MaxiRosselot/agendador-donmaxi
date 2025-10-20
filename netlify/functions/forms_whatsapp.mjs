// netlify/functions/forms_whatsapp.mjs
// Dispara un WhatsApp por Twilio cuando Netlify Forms recibe un envío del form "agendador".
// Usa Messaging Service (recomendado) con un sender de WhatsApp ya asociado.

const OK  = (b) => ({ statusCode: 200, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(b) });
const BAD = (s,m) => ({ statusCode: s,   headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return BAD(405, 'Method not allowed');

  // --- Seguridad simple por query param (?secret=...)
  const secret = (event.queryStringParameters || {}).secret;
  if (!secret || secret !== process.env.WEBHOOK_SECRET) return BAD(401, 'Unauthorized');

  // --- ENV requeridas
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID, // <- usaremos SIEMPRE el service
    TWILIO_TO_WHATSAPP            // p.ej. whatsapp:+56944510560
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_MESSAGING_SERVICE_SID || !TWILIO_TO_WHATSAPP) {
    console.error('ENV CHECK', {
      hasSid: !!TWILIO_ACCOUNT_SID,
      hasTok: !!TWILIO_AUTH_TOKEN,
      hasSvc: !!TWILIO_MESSAGING_SERVICE_SID,
      hasTo:  !!TWILIO_TO_WHATSAPP
    });
    return BAD(500, 'Missing Twilio env vars');
  }

  // --- Parse del payload de Netlify Forms
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return BAD(400, 'Invalid JSON'); }

  const payload  = body.payload || body;
  const formName = payload.form_name || payload.formName || '';
  if (formName !== 'agendador') {
    console.log('IGNORED_FORM', { formName });
    return OK({ ok:true, ignored:true });
  }

  const d = payload.data || {};
  const nombre     = (d.nombre || '').trim();
  const apellido   = (d.apellido || '').trim();
  const email      = (d.email || '').trim();
  const celular    = (d.celular || '').trim();
  const direccion  = (d.direccion || '').trim();
  const comentarios= (d.comentarios || '').trim();
  const fecha      = (d.fecha || '').trim();
  const hora       = (d.hora || '').trim();
  const tz         = (d.tz || 'America/Santiago').trim();

  // --- Mensaje (simple y claro)
  const lines = [
    'Nueva *visita agendada* ✅',
    '',
    `*Cliente:* ${[nombre, apellido].filter(Boolean).join(' ') || '—'}`,
    `*Email:* ${email || 's/e'}`,
    `*Celular:* ${celular || 's/c'}`,
    `*Dirección:* ${direccion || 's/d'}`,
    comentarios ? `*Comentarios:* ${comentarios}` : null,
    '',
    `*Fecha:* ${fecha || '—'} a las *${hora || '—'}* (${tz})`,
    '',
    '— Calendai.cl · Webhook Netlify'
  ].filter(Boolean);

  const bodyText = lines.join('\n');

  // --- Envío a Twilio (Messages API) usando Messaging Service
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const params = new URLSearchParams({
    To: TWILIO_TO_WHATSAPP,               // ej. whatsapp:+56944510560
    Body: bodyText,
    MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID // ej. MGxxxxxxxxxxxxxxxx
  });

  console.log('WA_SEND', {
    to: TWILIO_TO_WHATSAPP,
    service: TWILIO_MESSAGING_SERVICE_SID,
    preview: bodyText.slice(0, 100) + (bodyText.length > 100 ? '…' : '')
  });

  const r = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const txt = await r.text().catch(()=> '');
  if (!r.ok) {
    console.error('TWILIO_ERROR', { status: r.status, body: txt });
    return BAD(502, 'Twilio send failed');
  }

  let tw = {};
  try { tw = JSON.parse(txt); } catch {}
  console.log('TWILIO_OK', { sid: tw.sid, status: tw.status });

  return OK({ ok:true, sid: tw.sid || null });
};
