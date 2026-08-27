import crypto from "crypto";

const rateBuckets = new Map();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAppAuth(req, res) {
  const expected = process.env.APP_ACCESS_TOKEN;

  // If no APP_ACCESS_TOKEN is configured, allow requests (open access mode)
  if (!expected) {
    return true;
  }

  const header = String(req.headers.authorization || "");
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(supplied, expected)) {
    res.status(401).json({ code: "AUTH_REQUIRED", error: "กรุณาปลดล็อก Dashboard ด้วย Access Token" });
    return false;
  }
  return true;
}

export function requireCronAuth(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // If CRON_SECRET is not configured in env, allow Vercel cron or manual trigger
    return true;
  }
  const header = String(req.headers.authorization || "");
  const urlKey = req.query?.key;
  if (safeEqual(header, `Bearer ${expected}`) || (urlKey && safeEqual(urlKey, expected))) {
    return true;
  }
  res.status(401).json({ error: "Unauthorized cron request" });
  return false;
}

export function enforceRateLimit(req, res, { key = "default", limit = 30, windowMs = 60_000 } = {}) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const current = rateBuckets.get(bucketKey);
  const bucket = !current || now >= current.resetAt
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
  if (bucket.count > limit) {
    res.status(429).json({ error: "Too many requests — please retry later" });
    return false;
  }
  return true;
}
