// netlify/functions/forms_whatsapp.mjs
// Recibe el POST del Webhook de Netlify Forms y envía un WhatsApp por Twilio usando Messaging Service.

const OK = (b) => ({ statusCode: 200, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(b) });
const BAD = (s, m) => ({ statusCode: s, headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return BAD(405, 'Method not allowed');

  // 1) Seguridad
  const secret = (event.queryStringParameters || {}).secret;
  if (!secret || secret !== process.env.WEBHOOK_SECRET) return BAD(401, 'Unauthorized');

  // 2) Variables de entorno necesarias
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID, // <- usa este
    TWILIO_TO_WHATSAPP            // <- destino (debe tener whatsapp:+)
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_MESSAGING_SERVICE_SID || !TWILIO_TO_WHATSAPP) {
    console.error('ENV CHECK', {
      hasSid: !!TWILIO_ACCOUNT_SID,
      hasTok: !!TWILIO_AUTH_TOKEN,
      hasSvc: !!TWILIO_MESSAGING_SERVICE_SID,
      hasTo: !!TWILIO_TO_WHATSAPP
    });
    return BAD(500, 'Missing Twilio env vars');
  }

  // 3) Parse del body del webhook
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return BAD(400, 'Invalid JSON'); }

  const payload = body.payload || body;
  const formName = payload.form_name || payload.formName || '';
  if (formName !== 'agendador') return OK({ ok:true, ignored:true });

  const data = payload.data || {};
  const nombre    = data.nombre    || '';
  const apellido  = data.apellido  || '';
  const email     = data.email     || '';
  const celular   = data.celular   || '';
  const direccion = data.direccion || '';
  const fecha     = data.fecha     || '';
  const hora      = data.hora      || '';
  const tz        = data.tz        || 'America/Santiago';
  const comentarios = data.comentarios || '';

  // 4) Mensaje
  const lines = [
    'Nueva *visita agendada* ✅',
    '',
    `*Cliente:* ${nombre} ${apellido}`,
    `*Email:* ${email || 's/e'}`,
    `*Celular:* ${celular || 's/c'}`,
    `*Dirección:* ${direccion || 's/d'}`,
    comentarios ? `*Comentarios:* ${comentarios}` : null,
    '',
    `*Fecha:* ${fecha || '—'} a las *${hora || '—'}* (${tz})`,
    '',
    '— Calendai.cl · Notificación automática'
  ].filter(Boolean);

  const bodyText = lines.join('\n');

  // 5) Envío a Twilio
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const params = new URLSearchParams({
    MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
    To: TWILIO_TO_WHATSAPP, // Debe ser whatsapp:+569....
    Body: bodyText
  });

  console.log('WA_SEND', {
    to: TWILIO_TO_WHATSAPP,
    service: TWILIO_MESSAGING_SERVICE_SID,
    preview: bodyText.slice(0,100) + (bodyText.length>100?'…':'')
  });

  const r = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
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
