const memoryClaims = new Map();

function claimInMemory(key, ttlSeconds) {
  const now = Date.now();
  const expiresAt = memoryClaims.get(key) || 0;
  if (expiresAt > now) return false;
  memoryClaims.set(key, now + ttlSeconds * 1000);
  return true;
}

/**
 * Atomically claims an alert key. Supports Vercel KV/Upstash REST when configured,
 * with an in-memory fallback for local development.
 */
export async function claimAlert(key, ttlSeconds = 28_800) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return claimInMemory(key, ttlSeconds);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", `btc-desk:${key}`, "1", "EX", ttlSeconds, "NX"]),
    });
    if (!response.ok) throw new Error(`Alert state store HTTP ${response.status}`);
    const data = await response.json();
    return data?.result === "OK";
  } catch (error) {
    console.error("Alert state store unavailable; using instance-local cooldown:", error.message);
    return claimInMemory(key, ttlSeconds);
  }
}

