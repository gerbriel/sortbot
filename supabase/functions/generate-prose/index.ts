// Supabase Edge Function: generate-prose
// ----------------------------------------
// Writes the SELLING PARAGRAPH for a listing using an open Llama model on
// Cloudflare Workers AI. Hybrid architecture: the model writes ONLY the short
// prose paragraph — the client's rule-based template engine keeps owning the
// description skeleton (title, measurement lines, org format, hashtags,
// disclaimers), so a model mistake can never corrupt a measurement or price.
//
// SECRETS (set via `supabase secrets set`):
//   CF_ACCOUNT_ID  Cloudflare account id
//   CF_API_TOKEN   API token with Workers AI permission
// Missing secrets → 503; the client falls back silently to today's output.
//
// INPUT (POST JSON):
//   { fields: Record<string, string>, style?: string }
//   fields = only the facts the model may use (brand, type, color, size, era,
//   material, condition, keywords…). style = the workspace's tone notes.
//
// OUTPUT: { prose: string } — one paragraph, ~40-80 words. The CLIENT
// validates again (length, banned phrases, no numbers absent from the fields)
// before accepting; anything invalid is discarded in favor of the fallback.
//
// AUTH: verify_jwt ON (default) — only signed-in app users can invoke.

const CF_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You write one short selling paragraph for a vintage clothing resale listing.

HARD RULES:
- Use ONLY the facts provided. Never invent measurements, sizes, years, prices, or numbers of any kind. If a number is not in the facts, it must not be in your paragraph.
- One paragraph, 40 to 80 words. No headings, no lists, no hashtags, no emojis, no quotation marks around the paragraph.
- Do not mention shipping, price, returns, or condition disclaimers — the listing template covers those.
- Do not repeat the exact title. Write natural, confident resale copy that makes someone want the piece.
- Never use the words: AI, generated, algorithm.
- If a style note is provided, follow its voice.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const accountId = Deno.env.get("CF_ACCOUNT_ID");
  const apiToken = Deno.env.get("CF_API_TOKEN");
  if (!accountId || !apiToken) {
    return json({ error: "Workers AI secrets not configured (CF_ACCOUNT_ID / CF_API_TOKEN)." }, 503);
  }

  const fields: Record<string, string> = {};
  let style = "";
  try {
    const body = await req.json();
    if (body && typeof body.fields === "object" && body.fields) {
      for (const [k, v] of Object.entries(body.fields)) {
        const val = String(v ?? "").trim();
        if (val) fields[String(k).slice(0, 40)] = val.slice(0, 300);
      }
    }
    style = String(body?.style ?? "").slice(0, 500);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (Object.keys(fields).length === 0) {
    return json({ error: "No fields provided." }, 400);
  }

  const factLines = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const userPrompt =
    `FACTS ABOUT THE ITEM:\n${factLines}\n` +
    (style ? `\nSTYLE NOTE (workspace voice): ${style}\n` : "") +
    `\nWrite the selling paragraph now.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 220,
          temperature: 0.7,
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text();
      return json({ error: `Workers AI ${resp.status}`, detail: text.slice(0, 400) }, 502);
    }
    const payload = await resp.json();
    const raw: string = payload?.result?.response ?? "";
    // Light server-side cleanup: collapse to one paragraph, strip wrapping quotes
    const prose = raw
      .replace(/\s*\n+\s*/g, " ")
      .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
      .trim();
    if (!prose) return json({ error: "Empty model response." }, 502);
    return json({ prose });
  } catch (err) {
    return json({ error: "Model call failed", detail: String(err) }, 502);
  }
});
