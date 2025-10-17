import { google } from 'googleapis'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Construye un Date local a partir de YYYY-MM-DD y HH:mm (sin Z) */
function buildLocal(dateStr, timeHHmm) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const [h, m] = timeHHmm.split(':').map(Number)
  return new Date(Y, M - 1, D, h, m, 0, 0) // Date en TZ local del runtime
}

/** Formatea Date a 'YYYY-MM-DDTHH:mm:00' (sin zona, para usar con timeZone) */
function formatLocalRFC3339(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

/** Chequeo de superposición simple */
function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const {
      nombre, apellido, email, celular, direccion,
      fechaISO, horaHHmm, tz = 'America/Santiago',
      note = ''
    } = JSON.parse(event.body || '{}')

    if (!fechaISO || !horaHHmm) throw new Error('Faltan parámetros de fecha/hora')
    if (!email) throw new Error('Falta email del cliente')

    // Duración fija 15 min (configurable por env)
    const duration = Number(process.env.DEFAULT_EVENT_DURATION_MIN || 15)

    // Hora local (NO usar toISOString para enviar a Calendar)
    const start = buildLocal(fechaISO, horaHHmm)
    const end = new Date(start.getTime() + duration * 60000)

    // OAuth2
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client })
    const calendarId = process.env.CALENDAR_ID

    // --- FreeBusy: consultamos una ventana amplia del mismo día ---
    const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(start); dayEnd.setHours(23, 59, 59, 999)

    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),     // aquí sí puede ser ISO/UTC
        timeMax: dayEnd.toISOString(),
        timeZone: tz,
        items: [{ id: calendarId }]
      }
    })

    const busy = freebusy.data.calendars?.[calendarId]?.busy || []
    const hasConflict = busy.some(({ start: bS, end: bE }) =>
      overlap(start, end, new Date(bS), new Date(bE))
    )
    if (hasConflict) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'SLOT_TAKEN', message: 'Ese horario ya fue tomado. Elige otra hora.' })
      }
    }

    // --- Evento ---
    const summary = `Visita — ${nombre} ${apellido} (Repisas Don Maxi)`
    const description = `Cliente: ${nombre} ${apellido}
Email: ${email}
Celular: ${celular}
Dirección: ${direccion}

Notas:
${note || '(sin notas)'}

Slot: ${fechaISO} ${horaHHmm} (${duration}min)`

    const notifyEmail = process.env.NOTIFY_EMAIL // p.ej. repisas@donmaxi.cl
    const attendees = [{ email }]
    if (notifyEmail) attendees.push({ email: notifyEmail })

    const requestBody = {
      summary,
      description,
      start: { dateTime: formatLocalRFC3339(start), timeZone: tz }, // 👈 clave: sin Z + timeZone
      end:   { dateTime: formatLocalRFC3339(end),   timeZone: tz }, // 👈 clave
      attendees,
      reminders: { useDefault: true },
      extendedProperties: {
        shared: { slot_key: `${fechaISO}T${horaHHmm}`, created_by: 'agendador-netlify' }
      }
    }

    const response = await calendar.events.insert({
      calendarId,
      sendUpdates: 'all',
      requestBody
    })

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, link: response.data.htmlLink })
    }
  } catch (err) {
    console.error('Calendar error:', err.response?.data || err)
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error al crear evento', detail: err.response?.data || String(err) })
    }
  }
}
