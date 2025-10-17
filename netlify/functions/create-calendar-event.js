import { google } from 'googleapis'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function toISO(dateStr, timeHHmm){
  return new Date(`${dateStr}T${timeHHmm}:00`)
}
function overlap(aStart, aEnd, bStart, bEnd){ return aStart < bEnd && bStart < aEnd }

export async function handler(event){
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: corsHeaders }
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }

  try{
    const {
      nombre, apellido, email, celular, direccion,
      fechaISO, horaHHmm, tz = 'America/Santiago',
      note = ''
    } = JSON.parse(event.body || '{}')

    if(!fechaISO || !horaHHmm) throw new Error('Faltan parámetros de fecha/hora')

    // Duración fija 15 min
    const duration = Number(process.env.DEFAULT_EVENT_DURATION_MIN || 15)
    const start = toISO(fechaISO, horaHHmm)
    const end = new Date(start.getTime() + duration * 60000)

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client })

    // Verificar conflictos día completo
    const dayStart = new Date(start); dayStart.setHours(0,0,0,0)
    const dayEnd = new Date(start); dayEnd.setHours(23,59,59,999)

    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: tz,
        items: [{ id: process.env.CALENDAR_ID }]
      }
    })

    const busy = freebusy.data.calendars?.[process.env.CALENDAR_ID]?.busy || []
    const hasConflict = busy.some(({ start: bS, end: bE }) => overlap(start, end, new Date(bS), new Date(bE)))
    if (hasConflict){
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ ok:false, error:'SLOT_TAKEN', message:'Ese horario ya fue tomado. Elige otra hora.' })
      }
    }

    // Evento
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

    const response = await calendar.events.insert({
      calendarId: process.env.CALENDAR_ID,
      sendUpdates: 'all',
      requestBody: {
        summary,
        description,
        start: { dateTime: start.toISOString(), timeZone: tz },
        end:   { dateTime: end.toISOString(),   timeZone: tz },
        attendees,
        reminders: { useDefault: true },
        extendedProperties: {
          shared: { slot_key: `${fechaISO}T${horaHHmm}`, created_by: 'agendador-netlify' }
        }
      }
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
