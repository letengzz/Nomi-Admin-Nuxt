/**
 * 滑动窗口限流单测。
 *
 * 时间参数全部显式传入（`now`），不依赖 fake timer —— 这类逻辑一旦引入
 * 真实时钟，测试就会在 CI 上偶发失败。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRateLimits, consumeRateLimit } from '../server/utils/rate-limit';

const WINDOW = 60_000;
const LIMIT = 3;

describe('consumeRateLimit', () => {
  beforeEach(() => {
    clearRateLimits();
  });

  it('窗口内前 N 次放行，第 N+1 次拒绝', () => {
    const now = 1_700_000_000_000;
    expect(consumeRateLimit('ip:1', LIMIT, WINDOW, now).allowed).toBe(true);
    expect(consumeRateLimit('ip:1', LIMIT, WINDOW, now + 1000).allowed).toBe(true);
    expect(consumeRateLimit('ip:1', LIMIT, WINDOW, now + 2000).allowed).toBe(true);

    const blocked = consumeRateLimit('ip:1', LIMIT, WINDOW, now + 3000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(WINDOW - 3000);
  });

  it('被拒的请求不占用名额（否则客户端越刷，恢复越晚）', () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < LIMIT; i += 1) consumeRateLimit('ip:1', LIMIT, WINDOW, now);
    for (let i = 0; i < 50; i += 1) consumeRateLimit('ip:1', LIMIT, WINDOW, now + i);

    // 第一条命中滑出窗口后立刻就能再放行一次
    expect(consumeRateLimit('ip:1', LIMIT, WINDOW, now + WINDOW).allowed).toBe(true);
  });

  it('不同 key 之间互不影响（一个 IP 刷爆不影响别人）', () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < LIMIT; i += 1) consumeRateLimit('ip:1', LIMIT, WINDOW, now);
    expect(consumeRateLimit('ip:1', LIMIT, WINDOW, now).allowed).toBe(false);
    expect(consumeRateLimit('ip:2', LIMIT, WINDOW, now).allowed).toBe(true);
  });

  it('剩余次数随命中递减', () => {
    const now = 1_700_000_000_000;
    expect(consumeRateLimit('ip:9', LIMIT, WINDOW, now).remaining).toBe(LIMIT - 1);
    expect(consumeRateLimit('ip:9', LIMIT, WINDOW, now).remaining).toBe(LIMIT - 2);
  });
});
