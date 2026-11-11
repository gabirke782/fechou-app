import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "https://ziubcqxmxialhmwevtiy.supabase.co";
const PUBLIC_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const ALLOWED_ORIGINS = (Deno.env.get("FECHOU_ALLOWED_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
const APP_URL = (Deno.env.get("FECHOU_APP_URL") || "").replace(/\/$/, "");
const BROWSER_EVENTS = new Set(["page_view", "app_page_view", "login", "signup", "logout"]);

const clean = (v: unknown, max = 300) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function originAllowed(origin: string) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return ALLOWED_ORIGINS.includes(u.origin) || APP_URL === u.origin ||
      (u.protocol === "https:" && (u.hostname.endsWith(".pages.dev") || u.hostname.endsWith(".workers.dev"))) ||
      (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch { return false; }
}
function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...(origin && originAllowed(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}
function reply(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return reply(req, 405, { ok: false, error: "Método não permitido." });
  if (!originAllowed(req.headers.get("origin") || "")) return reply(req, 403, { ok: false, error: "Origem não autorizada." });
  if (!SERVICE_KEY || !PUBLIC_KEY) return reply(req, 503, { ok: false, error: "Serviço de eventos indisponível." });
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 8192) return reply(req, 413, { ok: false, error: "Evento excede o tamanho permitido." });
  let raw = "";
  try { raw = await req.text(); } catch { return reply(req, 400, { ok: false, error: "Corpo inválido." }); }
  if (raw.length > 8192) return reply(req, 413, { ok: false, error: "Evento excede o tamanho permitido." });
  let body: Record<string, unknown>;
  try { body = obj(JSON.parse(raw)); } catch { return reply(req, 400, { ok: false, error: "JSON inválido." }); }

  const eventName = clean(body.event_name, 50);
  if (!BROWSER_EVENTS.has(eventName)) return reply(req, 400, { ok: false, error: "Tipo de evento não permitido." });
  const visitorId = clean(body.visitor_id, 100);
  const sessionId = clean(body.session_id, 100);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(visitorId) || !/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) {
    return reply(req, 400, { ok: false, error: "Identificador de visita ou sessão inválido." });
  }
  const eventId = clean(body.event_id, 120);
  if (eventId && !/^[A-Za-z0-9._:-]{8,120}$/.test(eventId)) return reply(req, 400, { ok: false, error: "Identificador de evento inválido." });

  const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId: string | null = null;
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply(req, 401, { ok: false, error: "Sessão inválida." });
    const authClient = createClient(URL, PUBLIC_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer " + token } }
    });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) return reply(req, 401, { ok: false, error: "Sessão não autenticada." });
    userId = data.user.id;
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countError } = await db.from("app_analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("visitor_id", visitorId).gte("occurred_at", since);
  if (countError) return reply(req, 503, { ok: false, error: "Não foi possível validar o limite de eventos." });
  if ((count || 0) >= 30) return reply(req, 429, { ok: false, error: "Limite de eventos excedido. Tente novamente em instantes." });

  const record = {
    event_name: eventName,
    visitor_id: visitorId,
    session_id: sessionId,
    user_id: userId,
    page: clean(body.page, 160) || null,
    path: clean(body.path, 500) || null,
    source: clean(body.source, 120) || null,
    device: clean(body.device, 120) || null,
    occurred_at: new Date().toISOString(),
    event_id: eventId || null
  };
  const { error } = await db.from("app_analytics_events").insert(record);
  if (error?.code === "23505" && eventId) return reply(req, 200, { ok: true, duplicate: true });
  if (error) return reply(req, 503, { ok: false, error: "Não foi possível registrar o evento." });
  return reply(req, 200, { ok: true });
});