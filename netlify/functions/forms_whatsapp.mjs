// netlify/functions/forms_whatsapp.mjs
// Recibe el POST del Webhook de Netlify Forms y envía un WhatsApp por Twilio.

const OK = (b) => ({ statusCode: 200, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(b) });
const BAD = (s, m) => ({ statusCode: s, headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return BAD(405, 'Method not allowed');

  // 1) Verificación de secreto (query ?secret=...)
  const secret = (event.queryStringParameters || {}).secret;
  if (!secret || secret !== process.env.WEBHOOK_SECRET) return BAD(401, 'Unauthorized');

  // 2) Variables Twilio
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_WHATSAPP, // p.ej. "whatsapp:+14155238886" (sandbox) o tu número habilitado
    TWILIO_TO_WHATSAPP,   // p.ej. "whatsapp:+56944510560" (tu número destino)
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_WHATSAPP || !TWILIO_TO_WHATSAPP) {
    return BAD(500, 'Missing Twilio env vars');
  }

  // 3) Parse del body del webhook de Netlify Forms (JSON)
  //    Netlify envía algo como: { payload: { data: {...campos}, form_name: "...", ... } }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return BAD(400, 'Invalid JSON'); }

  const payload = body.payload || body; // por si tuvieras variaciones
  const formName = payload.form_name || payload.formName || '';
  if (formName !== 'agendador') {
    // Ignora otros formularios para evitar spam
    return OK({ ok:true, ignored:true });
  }

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

  // 4) Construcción del mensaje de WhatsApp
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
    '— Enviado por el Webhook de Netlify Forms',
  ].filter(Boolean);

  const bodyText = lines.join('\n');

  // 5) Llamada a Twilio API
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const form = new URLSearchParams({
    From: TWILIO_FROM_WHATSAPP,
    To:   TWILIO_TO_WHATSAPP,
    Body: bodyText,
  });

  const r = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!r.ok) {
    const errTxt = await r.text().catch(()=> r.statusText);
    console.error('Twilio error', errTxt);
    return BAD(502, 'Twilio send failed');
  }

  const twResp = await r.json().catch(()=> ({}));
  return OK({ ok:true, sid: twResp.sid || null });
};
