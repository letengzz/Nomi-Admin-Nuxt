/**
 * 运行期 i18n 的纯逻辑：词条键识别、消息深合并、偏好语言判定。
 *
 * 放在 shared/ 而不是 app/composables/，是因为这三段逻辑没有任何 Vue / Nuxt / DOM
 * 依赖，可以被 vitest 以 happy-dom 直接跑；插件与组件只负责「把结果接到实例上」。
 */

/** 词条键：至少两段、只含字母数字下划线中划线，段间用点分隔。 */
const ENTRY_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

/**
 * 判断一个字符串是否「像」i18n 词条键。
 *
 * 菜单名称允许两种写法：直接写「用户管理」，或写语言管理里的词条键
 * `layout.menu.users`。只有后者才该走翻译 —— 纯中文文案里没有点，
 * 带空格/中文标点的自然句子也不会命中，不会把用户写的原文吃掉。
 */
export function isI18nEntryKey(value: unknown): value is string {
  return typeof value === 'string' && ENTRY_KEY_PATTERN.test(value.trim());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 深合并两份消息树，`patch` 优先。
 *
 * 返回新对象而不是就地修改：调用方（运行时插件）要先留一份静态语言文件的快照，
 * 之后每次刷新都从「快照 + 数据库译文」重建。就地改会让快照一起被污染 ——
 * 症状是语言管理里把某条译文清空后，页面还留着上一次的旧文案。
 */
export function mergeMessages(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? mergeMessages(current, value) : value;
  }
  return merged;
}

/**
 * 导航时的语言裁决：首屏认 URL，站内跳转认用户偏好。
 *
 * @nuxtjs/i18n 每次导航都按目标路径前缀判语言，而后台菜单跳转不带前缀，
 * 会把英文状态误判成中文。在 i18n 落语言之前按这条规则改一次，
 * 就不会先渲染一帧中文再被后置钩子纠正。
 */
export function resolveNavigationLocale(
  detected: string,
  preferred: string,
  initialSetup: boolean,
): string {
  if (initialSetup || !preferred || preferred === detected) return detected;
  return preferred;
}

/**
 * 决定启动/切路由后该不该强制切语言。
 *
 * 返回 null 表示「交给 URL 判定」：
 *   · 用户偏好不是启用语言（被停用或删除）→ null，由调用方回落到默认语言；
 *   · 用户偏好就是默认语言 → null，默认语言没有 URL 前缀，@nuxtjs/i18n 自己会选中它；
 *   · 其余情况返回该 code，让运行期语言盖过 URL 前缀。
 *
 * 第三点是「语言管理里新增的语言」能生效的关键：`ja` 这种没在 nuxt.config.ts
 * 声明过的语言没有自己的 URL 前缀，@nuxtjs/i18n 的路由检测会把它判回默认语言，
 * 只能由这里在每次导航后重新按用户偏好盖回去。
 */
export function resolvePreferredLocale(
  preferred: string,
  available: readonly string[],
  defaultLocale: string,
): string | null {
  if (!preferred || !available.includes(preferred)) return null;
  if (preferred === defaultLocale) return null;
  return preferred;
}
