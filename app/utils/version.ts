/**
 * 版本与构建信息。
 *
 * 它们来自 nuxt.config.ts 的 `vite.define`，是编译期常量而不是 runtimeConfig
 * 里的值 —— 好处是可以被常量折叠，未使用的分支在打包时直接消失。
 *
 * `typeof __APP_VERSION__ === 'string'` 这层判断不是为了兼容生产环境，
 * 而是为了兼容 **vitest**：单测跑在裸 happy-dom 里，没有经过 Vite 的 define
 * 替换，直接引用会 ReferenceError。typeof 对未声明标识符是安全的。
 */

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

/**
 * 比较两个语义化版本号，返回 -1 / 0 / 1。
 *
 * 只处理主.次.修订三段数字，忽略预发布标签（-beta.1）：做了升级迁移的判定
 * 只需要「比之前新还是旧」，把预发布语义也实现进来会让这段代码比它的用途更复杂。
 * 段数不足时按 0 补齐，1.2 与 1.2.0 视为相同。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]!
      .split('.')
      .map((part) => {
        const num = Number.parseInt(part, 10);
        return Number.isFinite(num) ? num : 0;
      });

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}
