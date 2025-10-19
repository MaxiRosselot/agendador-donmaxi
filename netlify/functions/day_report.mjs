// netlify/functions/day_report.mjs
export const config = { path: "/api/day-report" };

const API = "https://api.netlify.com/api/v1";

// Utilidad: toma el primer campo que exista (probando varias variantes de nombre)
function pick(data, variants) {
  for (const k of variants) {
    if (data?.[k] != null && String(data[k]).trim() !== "") return String(data[k]).trim();
  }
  // intenta búsqueda case-insensitive por si acaso
  const entries = Object.entries(data || {});
  for (const [k, v] of entries) {
    if (variants.map(s => s.toLowerCase()).includes(String(k).toLowerCase())) {
      return String(v ?? "").trim();
    }
  }
  return "";
}

function normalizeTime(t) { // "9:30" -> "09:30"
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || "").trim());
  if (!m) return (t || "").trim();
  const hh = String(m[1]).padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

function isSundayISO(dateISO) {
  const [y, m, d] = (dateISO || "").split("-").map(Number);
  const js = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return js.getUTCDay() === 0; // Domingo
}

export default async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const dateISO = searchParams.get("date"); // YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || "")) {
      return new Response(JSON.stringify({ error: "Falta query ?date=YYYY-MM-DD" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const token = process.env.NETLIFY_AUTH_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    const formName = process.env.FORM_NAME || "agendador"; // <- AJUSTA AL NOMBRE REAL DEL FORM
    if (!token || !siteId) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno (NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID)." }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    // 1) Buscar el form por nombre exacto
    const formsRes = await fetch(`${API}/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!formsRes.ok) {
      const t = await formsRes.text();
      return new Response(JSON.stringify({ error: `Error obteniendo forms: ${t}` }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }
    const forms = await formsRes.json();
    const form = forms.find(f => (f.name || "").trim() === formName);
    if (!form) {
      return new Response(JSON.stringify({ error: `No encontré un form llamado "${formName}".` }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    // 2) Submissions del form
    const subsRes = await fetch(`${API}/forms/${form.id}/submissions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!subsRes.ok) {
      const t = await subsRes.text();
      return new Response(JSON.stringify({ error: `Error obteniendo submissions: ${t}` }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }
    const submissions = await subsRes.json();

    // 3) Mapear campos tolerante a mayúsculas/minúsculas
    //    Variantes a probar para cada key
    const K = {
      fecha:     ["Fecha", "fecha"],
      hora:      ["Hora", "hora"],
      nombre:    ["Nombre", "nombre"],
      apellido:  ["Apellido", "apellido"],
      direccion: ["Direccion", "dirección", "direccion", "Dirección"],
      celular:   ["Celular", "celular", "telefono", "teléfono", "Telefono", "Teléfono"],
      email:     ["Email", "email", "correo", "Correo"]
    };

    // 4) Filtrar por fecha exacta
    const sameDay = submissions
      .filter(s => pick(s.data, K.fecha) === dateISO)
      .map(s => {
        const hora = normalizeTime(pick(s.data, K.hora));
        const nombre = pick(s.data, K.nombre);
        const apellido = pick(s.data, K.apellido);
        const direccion = pick(s.data, K.direccion);
        const celular = pick(s.data, K.celular);
        const email = pick(s.data, K.email);
        return { hora, nombre, apellido, direccion, celular, email, raw: s.data || {} };
      })
      .sort((a, b) => a.hora.localeCompare(b.hora));

    const payload = {
      date: dateISO,
      isSunday: isSundayISO(dateISO),
      count: sameDay.length,
      items: sameDay
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};
