import { google } from 'googleapis'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function parseDate(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(y,(m??1)-1,d??1) }
function toDateTime(baseDate, hhmm){
  const [h,m] = hhmm.split(':').map(Number)
  const dt = new Date(baseDate)
  dt.setHours(h||0, m||0, 0, 0)
  return dt
}
function overlap(aStart, aEnd, bStart, bEnd){ return aStart < bEnd && bStart < aEnd }

export async function handler(event){
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: corsHeaders }

  try{
    const url = new URL(event.rawUrl)
    const date = url.searchParams.get('date') // YYYY-MM-DD
    // duración de la visita fijada a 15 min
    const duration = Number(process.env.DEFAULT_EVENT_DURATION_MIN || 15)
    const tz = url.searchParams.get('tz') || 'America/Santiago'
    const slots = (url.searchParams.get('slots') || '').split(',').filter(Boolean) // HH:mm,...

    if(!date || slots.length===0){
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error:'Parámetros inválidos' }) }
    }

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client })

    // Día completo
    const day = parseDate(date)
    const dayStart = new Date(day); dayStart.setHours(0,0,0,0)
    const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999)

    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: tz,
        items: [{ id: process.env.CALENDAR_ID }]
      }
    })

    const busy = freebusy.data.calendars?.[process.env.CALENDAR_ID]?.busy || []
    const busyWindows = busy.map(({start,end}) => ({ start:new Date(start), end:new Date(end) }))

    const result = {}
    for (const hhmm of slots){
      const s = toDateTime(day, hhmm)
      const e = new Date(s.getTime() + duration*60000)
      const isBusy = busyWindows.some(b => overlap(s,e,b.start,b.end))
      result[hhmm] = !isBusy
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok:true, date, availability: result }) }
  }catch(err){
    console.error('availability error:', err.response?.data || err)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok:false, error:'AVAIL_ERROR', detail: err.response?.data || String(err) }) }
  }
}
