// netlify/functions/saturday_report.mjs
export const config = { path: "/api/saturday-report" };

const API = "https://api.netlify.com/api/v1";

function toChilePretty(dateISO) {
  // sábado 19 (en español-CL)
  const d = new Date(dateISO + "T12:00:00-03:00");
  const fmt = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric" });
  // Capitalizar primera letra
  const out = fmt.format(d);
  return out.charAt(0).toLowerCase() + out.slice(1);
}

function normalizeTime(t){ // "9:30" -> "09:30" para ordenar
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if(!m) return t || "";
  const hh = String(m[1]).padStart(2,"0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

export default async (req, context) => {
  try {
    const { searchParams } = new URL(req.url);
    const dateISO = searchParams.get("date"); // formato YYYY-MM-DD (sábado)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || "")) {
      return new Response("Falta query ?date=YYYY-MM-DD", { status: 400 });
    }

    const token = process.env.NETLIFY_AUTH_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    const formName = process.env.FORM_NAME || "agendador_visitas";
    if (!token || !siteId) {
      return new Response("Faltan variables de entorno (NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID).", { status: 500 });
    }

    // 1) Buscar el form por nombre
    const formsRes = await fetch(`${API}/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!formsRes.ok) {
      const t = await formsRes.text();
      return new Response(`Error obteniendo forms: ${t}`, { status: 500 });
    }
    const forms = await formsRes.json();
    const form = forms.find(f => (f.name || "").trim() === formName);
    if (!form) {
      return new Response(`No encontré un form llamado "${formName}".`, { status: 404 });
    }

    // 2) Obtener submissions
    const subsRes = await fetch(`${API}/forms/${form.id}/submissions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!subsRes.ok) {
      const t = await subsRes.text();
      return new Response(`Error obteniendo submissions: ${t}`, { status: 500 });
    }
    const submissions = await subsRes.json();

    // 3) Filtrar por la fecha indicada (asumiendo campos: date, time, name, address, phone)
    //    Ajusta aquí los nombres si tus fields tienen otros keys.
    const sameDay = submissions.filter(s => (s.data?.date || "") === dateISO);

    // 4) Ordenar por hora
    sameDay.sort((a,b) => normalizeTime(a.data?.time).localeCompare(normalizeTime(b.data?.time)));

    // 5) Armar texto
    const header = toChilePretty(dateISO); // "sábado 19"
    const lines = [header, ""]; // línea en blanco

    for (const s of sameDay) {
      const hora = normalizeTime(s.data?.time || "");
      const nombre = (s.data?.name || "nombre apellido").trim();
      const direccion = (s.data?.address || "direccion").trim();
      const celular = (s.data?.phone || "celular").trim();

      lines.push(
        `${hora}`,
        `${nombre}`,
        `${direccion}`,
        `${celular}`,
        "" // línea en blanco entre bloques
      );
    }

    const body = lines.join("\n").trimEnd() || `${header}\n\n(No hay visitas registradas para esta fecha)`;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });

  } catch (err) {
    return new Response(`Error: ${err?.message || err}`, { status: 500 });
  }
};
