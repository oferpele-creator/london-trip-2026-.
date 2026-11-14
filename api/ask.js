// Vercel serverless function: POST /api/ask  { question, context }
// The Claude API key stays on the server: set ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables.
// Optional: CLAUDE_MODEL (default "claude-sonnet-5-5"; "claude-haiku-5-5" is cheaper and faster).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const question = String(body?.question || "").slice(0, 1000).trim();
  const context = body?.context || {};
  if (!question) return res.status(400).json({ error: "Empty question" });

  const ctx = JSON.stringify(context).slice(0, 20000);
  const lang = context.lang === "en" ? "English" : "Hebrew";
  const system = [
    "You are a friendly, concise London travel assistant for a couple on a trip to London, 20–24 November 2026. They are staying in Finchley (N3), near Finchley Central on the Northern line.",
    `Always answer in ${lang}, in plain text without markdown headings. Keep it short and practical: 3–6 bullet points max, each with the place name, why it fits, walking/transit time, and whether it is open now.`,
    "Use the JSON context: current London time, the user's location (lat,lng) if given, today's forecast, today's plan and the trip's place list with hours and distances.",
    "Prefer places from the list; you may suggest other well-known places, but say clearly when hours or prices are not verified.",
    "If it is raining or rain is likely, favour indoor options. Never invent exact prices or opening hours.",
  ].join(" ");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: `Context JSON:\n${ctx}\n\nQuestion: ${question}` }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: j?.error?.message || `Claude API error ${r.status}` });
    const answer = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return res.status(200).json({ answer: answer || "—" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
