// netlify/functions/create_event.mjs
import { google } from 'googleapis';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function buildLocal(dateStr, timeHHmm) {
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m] = timeHHmm.split(':').map(Number);
  return new Date(Y, M - 1, D, h, m, 0, 0);
}
function fmtLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
function overlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      nombre, apellido, email, celular, direccion,
      fechaISO, horaHHmm, tz = 'America/Santiago',
      note = ''
    } = JSON.parse(event.body || '{}');

    if (!fechaISO || !horaHHmm) throw new Error('Faltan parámetros de fecha/hora');
    if (!email) throw new Error('Falta email del cliente');

    const duration = Number(process.env.DEFAULT_EVENT_DURATION_MIN || 15);
    const start = buildLocal(fechaISO, horaHHmm);
    const end   = new Date(start.getTime() + duration * 60000);
    const slotKey = `${fechaISO}T${horaHHmm}`;
    const calendarId = process.env.CALENDAR_ID;

    // --- Auth ---
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // --- 1) Chequeo atómico por slot_key (mismo día) ---
    const dayStartISO = new Date(new Date(start).setHours(0,0,0,0)).toISOString();
    const dayEndISO   = new Date(new Date(start).setHours(23,59,59,999)).toISOString();

    const sameSlot = await calendar.events.list({
      calendarId,
      timeMin: dayStartISO,
      timeMax: dayEndISO,
      singleEvents: true,
      maxResults: 50,
      sharedExtendedProperty: `slot_key=${slotKey}`
    });
    if ((sameSlot.data.items || []).length > 0) {
      return {
        statusCode: 409, headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'SLOT_TAKEN', message: 'Ese horario ya fue tomado. Elige otra hora.' })
      };
    }

    // --- 2) Defensa por solapamiento (freebusy) ---
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStartISO,
        timeMax: dayEndISO,
        timeZone: tz,
        items: [{ id: calendarId }]
      }
    });
    const busy = fb.data.calendars?.[calendarId]?.busy || [];
    const hasConflict = busy.some(({ start: bS, end: bE }) => overlap(start, end, new Date(bS), new Date(bE)));
    if (hasConflict) {
      return {
        statusCode: 409, headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'SLOT_TAKEN', message: 'Ese horario ya fue tomado. Elige otra hora.' })
      };
    }

    // --- 3) Crear evento ---
    const summary = `Visita — ${nombre} ${apellido} (Repisas Don Maxi)`;
    const description = `Cliente: ${nombre} ${apellido}
Email: ${email}
Celular: ${celular}
Dirección: ${direccion}

Notas:
${note || '(sin notas)'}

Slot: ${fechaISO} ${horaHHmm} (${duration}min)`;

    // Solo el cliente como asistente (el mail al dueño lo enviará Netlify Forms)
    const attendees = [{ email }];

    const response = await calendar.events.insert({
      calendarId,
      sendUpdates: 'all',
      requestBody: {
        summary,
        description,
        start: { dateTime: fmtLocal(start), timeZone: tz },
        end:   { dateTime: fmtLocal(end),   timeZone: tz },
        attendees,
        reminders: { useDefault: true },
        extendedProperties: {
          shared: {
            slot_key: slotKey,
            created_by: 'agendador-netlify'
          }
        }
      }
    });

    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ ok: true, link: response.data.htmlLink, slotKey })
    };

  } catch (err) {
    console.error('Calendar error:', err.response?.data || err);
    return {
      statusCode: 500, headers: corsHeaders,
      body: JSON.stringify({ error: 'Error al crear evento', detail: err.response?.data || String(err) })
    };
  }
}
