/**
 * 进程内滑动窗口限流。
 *
 * 用途很具体：登录、找回密码这类**免登录**接口，任何一个都能被脚本以每秒上千次
 * 的频率打。原来的实现只按「账号」做 60 秒冷却，等于给攻击者留了两条路：
 *   · 换账号名就能绕过（对每个账号各发一次，把邮箱打成轰炸机）；
 *   · 反向利用冷却（把别人刚发的验证码顶掉，让真正的主人永远收不到）。
 * 所以这里补一层**按来源 IP** 的窗口限流，两条维度同时生效才挡得住。
 *
 * 为什么不是 Redis：单实例部署下进程内 Map 就够，引入外部依赖只为限流不划算。
 * 代价写清楚 —— **多实例部署时是按实例计数的**，实际阈值等于「配置值 × 实例数」；
 * 真要严格全局限流，把 `buckets` 换成 Redis 的 ZSET（ZREMRANGEBYSCORE + ZCARD）即可，
 * 接口形状不用变。
 */

interface Bucket {
  /** 窗口内的命中时间戳（毫秒），升序 */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/** 键数量上限：防止「每次请求换一个 key」把内存打爆。超出后清理最旧的一批。 */
const MAX_KEYS = 20_000;

export interface RateLimitResult {
  /** false = 本次请求超出阈值，应当拒绝 */
  allowed: boolean;
  /** 窗口内还剩几次 */
  remaining: number;
  /** 距离窗口腾出名额还有多久（毫秒），用于 Retry-After 提示 */
  retryAfterMs: number;
}

/**
 * 记一次命中并返回是否放行。
 *
 * 只有 allowed=true 时才计入窗口 —— 被拒的请求不再累加，
 * 否则一个正在狂刷的客户端会把窗口「顶死」，等到它停下来还要再等一整个窗口。
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key) ?? { hits: [] };
  // 顺手裁掉滑出窗口的旧记录：数组本身很小（<= limit），不用二分。
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > MAX_KEYS) prune(now, windowMs);

  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
}

/** 超量时先扫掉整张表里已经空了的桶；仍超量就丢掉最早创建的键。 */
function prune(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((at) => now - at >= windowMs)) buckets.delete(key);
  }
  if (buckets.size <= MAX_KEYS) return;
  const overflow = buckets.size - MAX_KEYS;
  let dropped = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= overflow) break;
  }
}

/** 仅供单测：清空全部计数。 */
export function clearRateLimits(): void {
  buckets.clear();
}
