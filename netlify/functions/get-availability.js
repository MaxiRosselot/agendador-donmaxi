import { google } from 'googleapis'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

/**
 * Convierte un "wall time" en una zona IANA (tz) al instante UTC correcto.
 * Evita dependencias externas usando Intl.DateTimeFormat.
 * @returns {Date} -> instante en UTC que representa ese local time en tz
 */
function zonedWallTimeToUTC(dateStr, timeHHmm, tz) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const [h, m]    = timeHHmm.split(':').map(Number)

  // 1) Primer "guess": ese wall time pero asumido como UTC
  const guessUTC = Date.UTC(Y, (M || 1) - 1, D || 1, h || 0, m || 0, 0, 0)

  // 2) Formateamos ese instante "guess" como wall time en tz
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(guessUTC)).map(p => [p.type, p.value]))

  // 3) El wall time derivado del guess expresado en UTC:
  //    Esto nos permite calcular el offset real (incluye DST).
  const wallFromGuessUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  )

  // 4) Offset = guessUTC - wallFromGuessUTC
  const offsetMs = guessUTC - wallFromGuessUTC

  // 5) Instante real = wall como UTC + offset
  const realUTC = Date.UTC(Y, (M || 1) - 1, D || 1, h || 0, m || 0, 0) + offsetMs
  return new Date(realUTC)
}

function toDayBoundsUTC(dateStr, tz) {
  const startUTC = zonedWallTimeToUTC(dateStr, '00:00', tz)
  const endUTC   = zonedWallTimeToUTC(dateStr, '23:59', tz)
  endUTC.setSeconds(59, 999)
  return { startUTC, endUTC }
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders }
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const url   = new URL(event.rawUrl)
    const date  = url.searchParams.get('date')              // YYYY-MM-DD
    const tz    = url.searchParams.get('tz') || 'America/Santiago'
    const slots = (url.searchParams.get('slots') || '').split(',').filter(Boolean) // 'HH:mm,HH:mm,...'
    const mode  = (url.searchParams.get('mode') || 'created-only') // 'created-only' | 'any-event'
    const duration = Number(process.env.DEFAULT_EVENT_DURATION_MIN || 15)

    if (!date || slots.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Parámetros inválidos' }) }
    }

    // --- Auth Google ---
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client })
    const calendarId = process.env.CALENDAR_ID

    // --- Ventana del día en UTC (alineada a tz) ---
    const { startUTC: dayStartUTC, endUTC: dayEndUTC } = toDayBoundsUTC(date, tz)

    // MODO A) Bloquear SOLO slots creados por el agendador (recomendado)
    // Usamos extendedProperties.shared.created_by=agendador-netlify y leemos slot_key exacto.
    if (mode === 'created-only') {
      const list = await calendar.events.list({
        calendarId,
        timeMin: dayStartUTC.toISOString(),
        timeMax: dayEndUTC.toISOString(),
        singleEvents: true,
        maxResults: 250,
        sharedExtendedProperty: 'created_by=agendador-netlify'
      })

      const takenKeys = new Set()
      for (const ev of (list.data.items || [])) {
        const k = ev.extendedProperties?.shared?.slot_key
        if (k) takenKeys.add(k) // 'YYYY-MM-DDTHH:mm'
      }

      const availability = {}
      for (const hhmm of slots) {
        const key = `${date}T${hhmm}`
        availability[hhmm] = !takenKeys.has(key)
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, date, tz, availability, mode }) }
    }

    // MODO B) Bloquear por CUALQUIER evento (freebusy) — por si quieres que tu agenda no se cruce con tus eventos personales
    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStartUTC.toISOString(),
        timeMax: dayEndUTC.toISOString(),
        timeZone: tz, // opcional; las ventanas igualmente llegan en UTC
        items: [{ id: calendarId }]
      }
    })

    const busy = freebusy.data.calendars?.[calendarId]?.busy || []
    const busyWindows = busy.map(({ start, end }) => ({ start: new Date(start), end: new Date(end) }))

    const availability = {}
    for (const hhmm of slots) {
      // OJO: s/e en UTC equivalente a ese wall time en tz
      const sUTC = zonedWallTimeToUTC(date, hhmm, tz)
      const eUTC = new Date(sUTC.getTime() + duration * 60000)
      const isBusy = busyWindows.some(b => overlap(sUTC, eUTC, b.start, b.end))
      availability[hhmm] = !isBusy
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, date, tz, availability, mode: 'any-event' }) }
  } catch (err) {
    console.error('availability error:', err.response?.data || err)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: 'AVAIL_ERROR', detail: err.response?.data || String(err) }) }
  }
}
