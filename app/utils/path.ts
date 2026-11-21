/**
 * 路由 path 归一化。
 *
 * i18n 的 strategy 是 `prefix_except_default`：中文是 `/admin/system/permissions`，
 * 英文是 `/en/admin/system/permissions`。而权限节点里存的 path 不带语言前缀，
 * 所以「用当前路径查权限表」之前必须先剥掉语言前缀。
 */
const LOCALE_PREFIX = /^\/(en|zh)(?=\/|$)/;

export function stripLocalePrefix(path: string): string {
  const stripped = path.replace(LOCALE_PREFIX, '');
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

/** 当前页面对应的菜单项 path（去掉查询串、语言前缀与尾部斜杠）。 */
export function normalizeMenuPath(path: string): string {
  const clean = stripLocalePrefix(path.split('?')[0] ?? path);
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1);
  return clean;
}
