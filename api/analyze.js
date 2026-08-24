// Vercel Serverless Function — proxies AI API calls (Groq / Anthropic)
//
// SETUP: In Vercel dashboard → Project Settings → Environment Variables:
//   GROQ_API_KEY = your Groq API key from https://console.groq.com/keys
//   (Optional) ANTHROPIC_API_KEY = your Claude key from https://console.anthropic.com

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const groqApiKey = process.env.GROQ_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!groqApiKey && !anthropicApiKey) {
    return res.status(500).json({
      error: { message: "กรุณาตั้งค่า GROQ_API_KEY (หรือ ANTHROPIC_API_KEY) ใน Vercel Environment Variables" },
    });
  }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: { message: "Missing 'prompt' in request body" } });

  // 1. If Anthropic Claude API Key is provided, use Claude
  if (anthropicApiKey && !groqApiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1200,
          temperature: 0.7,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({
          error: { message: data?.error?.message || "Anthropic API error" },
        });
      }

      const text = data.content?.[0]?.text ?? "";
      return res.status(200).json({ text });
    } catch (err) {
      return res.status(500).json({ error: { message: `Claude API error: ${err.message}` } });
    }
  }

  // 2. Otherwise use Groq (Fast & Free)
  // Active models on Groq: llama-3.3-70b-versatile (primary), llama-3.1-8b-instant (fast fallback)
  const primaryModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const fallbackModel = "llama-3.1-8b-instant";

  const callGroq = async (modelName) => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 1200,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  };

  try {
    let result = await callGroq(primaryModel);

    // If primary model fails due to model deprecation or rate limit, retry with fallback model
    if (!result.ok && result.status !== 401 && primaryModel !== fallbackModel) {
      result = await callGroq(fallbackModel);
    }

    if (!result.ok) {
      const errMsg = result.data?.error?.message || JSON.stringify(result.data);
      return res.status(result.status).json({
        error: { message: `Groq API error (${result.status}): ${errMsg}` },
      });
    }

    const text = result.data.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: { message: `Server error: ${err.message}` } });
  }
}

