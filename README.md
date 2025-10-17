# Agendador — Repisas Don Maxi

Agenda visitas en los **próximos 4 domingos**, bloques de **30 min (09:00–16:00)**.  
La visita dura **15 min**. Se verifica disponibilidad real con Google Calendar (freebusy).

## Requisitos
- Node 18+
- Cuenta Netlify
- Credenciales Google Calendar (OAuth2 con refresh token)

## Configuración
1. `npm i`
2. Configura variables de entorno en Netlify:
   - GOOGLE_CLIENT_ID
   - GOOGLE_CLIENT_SECRET
   - GOOGLE_REFRESH_TOKEN
   - CALENDAR_ID
   - DEFAULT_EVENT_DURATION_MIN=15
   - NOTIFY_EMAIL=repisas@donmaxi.cl
3. Sube `logo.png` y `og-cover.png` a `/public`.

## Desarrollo
