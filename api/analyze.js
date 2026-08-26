// Vercel Serverless Function — proxies AI API calls (Groq / Anthropic)
//
// SETUP: In Vercel dashboard → Project Settings → Environment Variables:
//   GROQ_API_KEY = your Groq API key from https://console.groq.com/keys
//   (Optional) ANTHROPIC_API_KEY = your Claude key from https://console.anthropic.com

import { requireAppAuth, enforceRateLimit } from "../lib/security.js";

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAppAuth(req, res)) return;
  if (!enforceRateLimit(req, res, { key: "analyze", limit: 10, windowMs: 60_000 })) return;

  const groqApiKey = process.env.GROQ_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!groqApiKey && !anthropicApiKey) {
    return res.status(500).json({
      error: { message: "กรุณาตั้งค่า GROQ_API_KEY (หรือ ANTHROPIC_API_KEY) ใน Vercel Environment Variables" },
    });
  }

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: { message: "Missing 'prompt' in request body" } });
  if (typeof prompt !== "string" || prompt.length > 12_000) {
    return res.status(400).json({ error: { message: "Prompt exceeds 12,000 characters" } });
  }

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

  // 2. Groq AI — dynamically test prioritized models or use GROQ_MODEL
  const candidateModels = [
    process.env.GROQ_MODEL,
    "openai/gpt-oss-120b",
    "groq/compound",
    "openai/gpt-oss-20b",
    "groq/compound-mini",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
  ].filter(Boolean);

  // Try to find list of active models directly from Groq if possible
  let modelList = candidateModels;
  try {
    const listRes = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { "Authorization": `Bearer ${groqApiKey}` },
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const activeIds = new Set(listData.data?.map(m => m.id) || []);
      const matched = candidateModels.filter(m => activeIds.has(m));
      if (matched.length > 0) {
        modelList = matched;
      } else if (listData.data?.length > 0) {
        // Filter out whisper and guard models, pick first text chat model
        const chatModels = listData.data
          .map(m => m.id)
          .filter(id => !id.includes("whisper") && !id.includes("guard") && !id.includes("embed"));
        if (chatModels.length > 0) modelList = chatModels;
      }
    }
  } catch (e) {
    // Fallback to static candidate list
  }

  let lastError = null;
  for (const modelName of modelList) {
    try {
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
      if (response.ok) {
        const text = data.choices?.[0]?.message?.content ?? "";
        return res.status(200).json({ text, model: modelName });
      }

      lastError = data?.error?.message || JSON.stringify(data);
      // If error is 401 Unauthorized, no need to try other models
      if (response.status === 401) {
        return res.status(401).json({
          error: { message: `Groq API Key ไม่ถูกต้อง (401 Unauthorized): ${lastError}` },
        });
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  return res.status(500).json({
    error: { message: `ไม่สามารถเรียก Groq API ได้: ${lastError}` },
  });
}
