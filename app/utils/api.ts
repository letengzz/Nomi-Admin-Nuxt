/**
 * 接口调用总入口。
 *
 * 全站只有这里决定「这次请求到底发去哪里」：
 *   · 正式环境 → `$fetch`，打到 Nitro；
 *   · 演示构建（`NUXT_PUBLIC_DEMO=1`）→ `app/mock`，从内存里取数据。
 *
 * 为什么要在这一层分流，而不是在每个页面上写 `if (demo)`：
 * 页面不该知道自己跑在演示站里 —— 它们拿到的仍然是同一个 `ApiEnvelope`，
 * 演示数据一旦变成「另一种调用方式」，页面就会开始出现两份逻辑。
 *
 * mock 用动态 import：非演示构建里它只是永远不会被加载的独立 chunk，
 * 不会把一批假数据塞进首屏包体。
 */
import type { ApiEnvelope } from '../types/permission';

export interface ApiCallInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  /**
   * 注入请求器，仅供单测使用（默认 `$fetch`）。
   * Nuxt 的 `$fetch` 是运行时自动导入，vitest 里 stubGlobal 拦不住它。
   */
  request?: typeof $fetch;
  /** 不追加 `ignoreResponseError`：极少数调用方需要自己处理非 2xx。 */
  bare?: boolean;
}

/**
 * 是否运行在演示站上。
 *
 * 不能写成 `config.public.demo === true`：`NUXT_PUBLIC_DEMO=1` 这个环境变量
 * 会被 Nuxt 当成运行时覆盖，用 destr 解析后写进 `public.demo` 的是数字 `1`
 * （字符串 'true' 同理），严格等于布尔值一律落空。落空的后果很实在 ——
 * 服务端渲染阶段会去打真实接口，静态构建时连库、页面里又没有演示数据。
 *
 * `useRuntimeConfig()` 依赖 Nuxt 运行时，纯 vitest 环境下会抛错 —— 那种情况
 * 一律按「不是演示」处理，让测试里的显式 stub 继续生效。
 */
export function isDemoMode(): boolean {
  try {
    const raw = (useRuntimeConfig().public as { demo?: unknown }).demo;
    return raw === true || raw === 1 || raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function callApi<T>(url: string, init: ApiCallInit = {}): Promise<ApiEnvelope<T>> {
  if (isDemoMode()) {
    const { mockEnvelope } = await import('../mock');
    return mockEnvelope<T>(url, init);
  }

  const request = init.request ?? $fetch;
  const options: Record<string, unknown> = { method: init.method ?? 'GET' };
  if (init.body !== undefined) options.body = init.body;
  if (init.query !== undefined) options.query = init.query;
  if (init.headers !== undefined) options.headers = init.headers;
  if (!init.bare) options.ignoreResponseError = true;

  const response = await request(url, options);
  return response as ApiEnvelope<T>;
}
