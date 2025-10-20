import React, { useEffect, useMemo, useState } from 'react'

const CONFIG = {
  timezone: 'America/Santiago',
  business: { name: 'Repisas Don Maxi', notifyPhone: '+56944510560' },
  logoUrl: '/logo.png',
  endpoints: {
    availability: '/.netlify/functions/get-availability',
    createEvent: '/.netlify/functions/create_event',
  }
}

// ---------- Utils ----------
function parseLocalDate(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(y,(m??1)-1,d??1) }
function prettyDate(date){ return new Intl.DateTimeFormat('es-CL',{dateStyle:'full'}).format(date) }
function encode(data){ return new URLSearchParams(data).toString() }

// Próximos 4 domingos
function nextFourSundays(){
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sundays = []
  const day = base.getDay()
  const isTodaySundayUsable = day === 0 && now.getHours() < 16
  const daysToNextSunday = (7 - day) % 7 || 7
  const firstSunday = isTodaySundayUsable ? base : new Date(base.getTime() + daysToNextSunday*86400000)
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  for(let i=0;i<4;i++){
    const d = new Date(firstSunday.getTime() + i*7*86400000)
    sundays.push(toISO(d))
  }
  return sundays
}

// Slots de 30 min entre 09:00 y 17:00
function daySlots30m(){
  const out = []
  let h = 9, m = 0
  while (h < 17 || (h === 17 && m === 0)){
    out.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
    m += 30
    if (m >= 60){ h += 1; m = 0 }
  }
  return out
}

export default function App(){
  const [dates, setDates] = useState([])
  const [selectedDateISO,setSelectedDateISO]=useState('')
  const [selectedSlot,setSelectedSlot]=useState('')
  const [availability, setAvailability] = useState(null) // null = aún no cargado
  const [loadingAvail, setLoadingAvail] = useState(false)
  const [availError, setAvailError] = useState('')

  const [form,setForm]=useState({nombre:'',apellido:'',email:'',celular:'',direccion:'',comentarios:''})
  const [submitting,setSubmitting]=useState(false)
  const [toast,setToast]=useState({ type:'', msg:'' })

  useEffect(() => { setDates(nextFourSundays()) }, [])
  const baseSlots = useMemo(() => daySlots30m(), [])
  const selectedDate = useMemo(()=>selectedDateISO?parseLocalDate(selectedDateISO):null,[selectedDateISO])

  const step = useMemo(()=> selectedDateISO ? (selectedSlot ? 3 : 2) : 1, [selectedDateISO, selectedSlot])
  useEffect(()=>{
    const el = document.getElementById('progress-bar')
    if(!el) return
    el.style.width = step === 1 ? '33%' : step === 2 ? '66%' : '100%'
  },[step])

  const canSubmit = Boolean(
    selectedDateISO && selectedSlot &&
    form.nombre.trim() && form.apellido.trim() &&
    /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
    form.celular.trim() && form.direccion.trim()
  )

  // ----------- DISPONIBILIDAD -----------
  useEffect(() => {
    if (!selectedDateISO) return
    const controller = new AbortController()
    setLoadingAvail(true)
    setAvailError('')
    setAvailability(null)
    setSelectedSlot('')

    const params = new URLSearchParams({
      date: selectedDateISO,
      tz: CONFIG.timezone,
      mode: 'created-only',
      slots: baseSlots.join(',')
    })

    const url = `${CONFIG.endpoints.availability}?${params.toString()}&v=${Date.now()}`
    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data?.ok && data.availability) {
          setAvailability(data.availability)
        } else {
          setAvailError('No se pudo cargar la disponibilidad.')
          setAvailability({})
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setAvailError('Error al obtener la disponibilidad.')
          setAvailability({})
        }
      })
      .finally(() => setLoadingAvail(false))

    return () => controller.abort()
  }, [selectedDateISO, baseSlots])

  // ----------- ENVÍO DE FORMULARIO -----------
  async function handleSubmit(e){
    e.preventDefault()
    if(!canSubmit || submitting || loadingAvail) return
    setSubmitting(true)
    setToast({ type:'', msg:'' })

    try{
      // Revalida el slot antes de enviar
      const checkParams = new URLSearchParams({
        date: selectedDateISO, tz: CONFIG.timezone, mode: 'created-only', slots: selectedSlot
      })
      const check = await fetch(`${CONFIG.endpoints.availability}?${checkParams}&v=${Date.now()}`, { cache:'no-store' })
      const j = await check.json()
      if (!j?.ok || j.availability?.[selectedSlot] !== true) {
        throw new Error('El horario seleccionado ya no está disponible.')
      }

      // 1) Google Calendar
      const r2 = await fetch(CONFIG.endpoints.createEvent,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          nombre:form.nombre, apellido:form.apellido, email:form.email, celular:form.celular, direccion:form.direccion,
          fechaISO:selectedDateISO, horaHHmm:selectedSlot, tz:CONFIG.timezone, note:form.comentarios
        })
      })
      if(!r2.ok){
        const detail = await r2.text().catch(()=> '')
        throw new Error('No se pudo crear el evento en Calendar. '+detail)
      }

      // 2) Netlify Forms (solo si Calendar fue OK)
      const payload = {
        'form-name':'agendador','bot-field':'',
        nombre:form.nombre,apellido:form.apellido,email:form.email,celular:form.celular,
        direccion:form.direccion,comentarios:form.comentarios,
        fecha:selectedDateISO,hora:selectedSlot,tz:CONFIG.timezone
      }
      await fetch('/',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:encode(payload)
      }).catch(()=> console.warn('Netlify Forms falló, pero Calendar fue OK'))

      // 3) Redirección
      const qs = new URLSearchParams({ date: selectedDateISO, time: selectedSlot, email: form.email })
      const confirmUrl = `${window.location.origin}/confirm.html?${qs.toString()}`
      window.location.replace(confirmUrl)
      setToast({ type:'ok', msg:'¡Agendado! Redirigiendo…' })
    }catch(err){
      console.error(err)
      setToast({ type:'err', msg: err.message || 'Ocurrió un error al agendar.' })
    }finally{ setSubmitting(false) }
  }

  return (
    <div role="application" aria-label="Agendador de visitas">
      {/* FECHAS */}
      <section aria-labelledby="tit-fechas">
        <h2 id="tit-fechas" className="section-title">📅 Próximos domingos</h2>
        <div className="dates" role="listbox" aria-label="Seleccione una fecha">
          {dates.map((date)=> {
            const d = parseLocalDate(date)
            const label = new Intl.DateTimeFormat('es-CL',{ weekday:'long', day:'2-digit', month:'short' }).format(d)
            const active = selectedDateISO===date
            return (
              <button
                key={date}
                type="button"
                className={`date-btn ${active?'active':''}`}
                aria-pressed={active}
                onClick={()=> setSelectedDateISO(date)}
              >{label}</button>
            )
          })}
        </div>
      </section>

      {/* HORARIOS */}
      {selectedDate && (
        <section aria-labelledby="tit-horas" style={{ marginTop: 8 }}>
          <h2 id="tit-horas" className="section-title">
            ⏰ Horarios para {prettyDate(selectedDate)}
            {loadingAvail ? ' — verificando…' : ''}
          </h2>

          {availError && (
            <p className="note" role="alert" style={{ color:'#b91c1c' }}>
              {availError}
            </p>
          )}

          <div
            className="slots"
            role="listbox"
            aria-label="Seleccione un horario"
            aria-busy={loadingAvail ? 'true' : 'false'}
            style={loadingAvail ? { opacity:.6, pointerEvents:'none', cursor:'progress' } : {}}
          >
            {baseSlots.map(slot=>{
              const isFree = availability?.[slot] === true
              const active = selectedSlot===slot
              const disabled = loadingAvail || !isFree || !!availError
              return (
                <button
                  key={slot}
                  type="button"
                  className={`slot ${active?'active':''}`}
                  aria-pressed={active}
                  aria-disabled={disabled}
                  disabled={disabled}
                  onClick={()=> !disabled && setSelectedSlot(slot)}
                  title={loadingAvail ? 'Verificando…' : (isFree ? 'Disponible' : 'No disponible')}
                >
                  {slot}
                </button>
              )
            })}
          </div>

          {selectedSlot && !loadingAvail && (
            <p className="note" aria-live="polite" style={{ marginTop: 8 }}>
              Seleccionaste <strong>{prettyDate(selectedDate)}</strong> a las <strong>{selectedSlot}</strong>.
            </p>
          )}
        </section>
      )}

      {/* FORMULARIO */}
      {selectedSlot && !loadingAvail && (
        <section aria-labelledby="tit-datos" style={{ marginTop: 10 }}>
          <h2 id="tit-datos" className="section-title">🧾 Tus datos</h2>
          <form onSubmit={handleSubmit} noValidate>
            <div className="grid">
              <div><label>Nombre</label><input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} required /></div>
              <div><label>Apellido</label><input value={form.apellido} onChange={e=>setForm({...form,apellido:e.target.value})} required /></div>
              <div><label>Correo</label><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required /></div>
              <div><label>Celular</label><input type="tel" value={form.celular} onChange={e=>setForm({...form,celular:e.target.value})} required /></div>
              <div><label>Dirección</label><input value={form.direccion} onChange={e=>setForm({...form,direccion:e.target.value})} required /></div>
              <div><label>Comentarios</label><input value={form.comentarios} onChange={e=>setForm({...form,comentarios:e.target.value})} placeholder="Opcional" /></div>
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                className="btn"
                type="submit"
                disabled={!canSubmit || submitting || loadingAvail}
                aria-busy={submitting ? 'true' : 'false'}
              >
                {submitting ? 'Agendando…' : 'Agendar visita (15 min)'}
              </button>
              <p className="note">
                Al agendar recibirás una invitación directamente en tu correo.
                Por favor asegúrate de haberlo escrito correctamente.
              </p>
            </div>

            {toast.type==='ok' && (<div className="toast ok" role="status">✅ {toast.msg}</div>)}
            {toast.type==='err' && (<div className="toast err" role="alert">❌ {toast.msg}</div>)}
          </form>
        </section>
      )}

      <footer style={{ textAlign:'center', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
        Zona horaria: {CONFIG.timezone}
      </footer>
    </div>
  )
}
