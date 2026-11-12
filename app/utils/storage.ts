/**
 * 浏览器存储可用性检测。
 *
 * 为什么值得单独写一个函数：`localStorage` 存在不等于**能用**。
 *   · Safari 隐私模式：对象在，setItem 抛 QuotaExceededError；
 *   · Chrome 禁用站点数据：访问 localStorage 直接抛 SecurityError；
 *   · 部分内嵌 WebView：跨域 iframe 里同样被拒。
 * 这些情况下 @vueuse 的 useStorage 会在每次读写时静默退回默认值，
 * 表现为「设置改完刷新就丢」，排查起来很容易走冤枉路 —— 启动时探一次并给出
 * 明确告警，比事后猜要省事得多。
 */

export interface StorageSupport {
  local: boolean;
  session: boolean;
}

function probe(store: () => Storage): boolean {
  try {
    const target = store();
    const key = '__nomi_probe__';
    target.setItem(key, '1');
    const ok = target.getItem(key) === '1';
    target.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

/** 探测 localStorage / sessionStorage 是否真的可写。SSR 环境下两者返回 false。 */
export function checkStorageCompatibility(): StorageSupport {
  if (typeof window === 'undefined') return { local: false, session: false };
  return {
    local: probe(() => window.localStorage),
    session: probe(() => window.sessionStorage),
  };
}
