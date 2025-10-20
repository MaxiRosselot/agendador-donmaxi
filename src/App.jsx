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
  const [availability, setAvailability] = useState({})
  const [loadingAvail, setLoadingAvail] = useState(false)

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

  // Cargar disponibilidad al elegir fecha
  useEffect(() => {
    if (!selectedDateISO) return
    setLoadingAvail(true)
    setAvailability({})
    setSelectedSlot('')
    const params = new URLSearchParams({
      date: selectedDateISO,
      tz: CONFIG.timezone,
      mode: 'created-only',
      slots: baseSlots.join(',')
    })
    fetch(`${CONFIG.endpoints.availability}?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data?.ok && data.availability) setAvailability(data.availability)
        else setAvailability({})
      })
      .catch(() => setAvailability({}))
      .finally(() => setLoadingAvail(false))
  }, [selectedDateISO, baseSlots])

  // Submit: 1) Calendar OK -> 2) Netlify Forms (para notificación por email)
  async function handleSubmit(e){
    e.preventDefault()
    if(!canSubmit || submitting || loadingAvail) return
    setSubmitting(true)
    setToast({ type:'', msg:'' })

    try{
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
      await r2.json()

      // 2) Netlify Forms (se envía DESPUÉS para que la notificación solo salga si Calendar fue OK)
      const payload = {
        'form-name':'agendador','bot-field':'',
        nombre:form.nombre,apellido:form.apellido,email:form.email,celular:form.celular,direccion:form.direccion,comentarios:form.comentarios,
        fecha:selectedDateISO,hora:selectedSlot,tz:CONFIG.timezone
      }
      // Este POST dispara la notificación por email configurada en Netlify Forms.
      const r1 = await fetch('/',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:encode(payload)
      })
      if(!r1.ok){
        // No rompemos el flujo si falla la notificación; dejamos agendado igualmente
        console.warn('Netlify Forms falló, pero Calendar fue OK')
      }

      // 3) Redirección a confirmación
      const qs = new URLSearchParams({ date: selectedDateISO, time: selectedSlot, email: form.email })
      const confirmUrl = `${window.location.origin}/confirm.html?${qs.toString()}`
      window.location.replace(confirmUrl)

      setToast({ type:'ok', msg:'¡Agendado! Redirigiendo…' })
    }catch(err){
      console.error(err)
      setToast({ type:'err', msg:'Ocurrió un error al agendar. Intenta nuevamente.' })
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
                onClick={()=>{ setSelectedDateISO(date) }}
              >{label}</button>
            )
          })}
        </div>
      </section>

      {/* HORARIOS */}
      {selectedDate && (
        <section aria-labelledby="tit-horas" style={{ marginTop: 8 }}>
          <h2 id="tit-horas" className="section-title">
            ⏰ Horarios para {prettyDate(selectedDate)}{loadingAvail ? ' — verificando…' : ''}
          </h2>

          <div
            className="slots"
            role="listbox"
            aria-label="Seleccione un horario"
            aria-busy={loadingAvail ? 'true' : 'false'}
            style={loadingAvail ? { opacity:.6, pointerEvents:'none', cursor:'progress' } : {}}
          >
            {baseSlots.map(slot=>{
              const isFree = availability[slot] !== false
              const active = selectedSlot===slot
              const disabled = loadingAvail || !isFree
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
                  style={loadingAvail ? { cursor:'progress' } : {}}
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
              <div>
                <label htmlFor="f-nombre">Nombre</label>
                <input id="f-nombre" value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})} autoComplete="given-name" required />
              </div>
              <div>
                <label htmlFor="f-apellido">Apellido</label>
                <input id="f-apellido" value={form.apellido} onChange={e=>setForm({...form,apellido:e.target.value})} autoComplete="family-name" required />
              </div>
              <div>
                <label htmlFor="f-email">Correo</label>
                <input id="f-email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} autoComplete="email" inputMode="email" required />
              </div>
              <div>
                <label htmlFor="f-cel">Celular</label>
                <input id="f-cel" type="tel" value={form.celular} onChange={e=>setForm({...form,celular:e.target.value})} autoComplete="tel" inputMode="tel" placeholder="+56 9 xxxx xxxx" required />
              </div>
              <div>
                <label htmlFor="f-dir">Dirección</label>
                <input id="f-dir" value={form.direccion} onChange={e=>setForm({...form,direccion:e.target.value})} autoComplete="street-address" required />
              </div>
              <div>
                <label htmlFor="f-notes">Comentarios</label>
                <input id="f-notes" value={form.comentarios} onChange={e=>setForm({...form,comentarios:e.target.value})} placeholder="Opcional" />
              </div>
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
                Por favor asegúrate de haberlo escrito correctamente antes de confirmar.
              </p>
            </div>

            {toast.type==='ok' && (<div className="toast ok" role="status" aria-live="polite" style={{ display:'block' }}>✅ {toast.msg}</div>)}
            {toast.type==='err' && (<div className="toast err" role="alert" aria-live="assertive" style={{ display:'block' }}>❌ {toast.msg}</div>)}
          </form>
        </section>
      )}

      <footer style={{ textAlign:'center', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
        Zona horaria: {CONFIG.timezone}
      </footer>
    </div>
  )
}
