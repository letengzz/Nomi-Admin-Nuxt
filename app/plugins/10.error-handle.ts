/**
 * 全局错误处理 —— Nuxt 里对应传统项目的 setupErrorHandle(app)。
 *
 * 三条来源都要接住，少一条就会在用户侧表现为「点了没反应」：
 *   ① Vue 渲染 / 生命周期 / watch 回调里的异常  → vueApp.config.errorHandler
 *   ② 未 catch 的 Promise（await 写漏了 try）   → unhandledrejection
 *   ③ Nuxt 的路由与数据获取异常                → app:error 钩子
 *
 * 这里只做归一化与日志。接 Sentry / 自建上报时改 `report` 一处即可，
 * 不要把上报逻辑散进三个回调里。
 */
import type { NuxtError } from '#app';

function normalize(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    return new Error(typeof message === 'string' ? message : JSON.stringify(error));
  }
  return new Error(String(error));
}

function report(error: unknown, source: string): void {
  const normalized = normalize(error);
  // 开发期完整打印；生产期这里应替换为监控上报（console 会被构建移除）。
  console.error(`[app-error][${source}]`, normalized);
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (error, _instance, info) => {
    report(error, `vue:${info || 'unknown'}`);
  };

  if (import.meta.client) {
    window.addEventListener('unhandledrejection', (event) => {
      report(event.reason, 'unhandledrejection');
    });
  }

  nuxtApp.hook('app:error', (error: NuxtError) => {
    report(error, `nuxt:${error.statusCode ?? 500}`);
  });

  return {
    provide: {
      /** 供业务代码手动上报：nuxtApp.$reportError(error, 'login') */
      reportError: (error: unknown, source = 'manual') => report(error, source),
    },
  };
});
