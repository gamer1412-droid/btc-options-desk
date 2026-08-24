// Vercel Serverless Function — proxies Groq API calls (free tier)
//
// WHY THIS EXISTS: your Groq API key must stay server-side, never
// shipped to the browser bundle.
//
// SETUP: In Vercel dashboard → Project Settings → Environment Variables:
//   GROQ_API_KEY = your Groq API key from console.groq.com
//
// Frontend calls: POST /api/analyze  { prompt: "..." }

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing GROQ_API_KEY env var" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing 'prompt' in request body" });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
                model: "llama3-70b-8192", // Groq's fastest model, free tier
        max_tokens: 1200,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
