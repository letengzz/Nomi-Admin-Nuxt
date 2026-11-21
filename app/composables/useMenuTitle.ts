/**
 * 菜单显示名称 → 当前语言文案。
 *
 * 菜单的 `title` 有两种合法写法：
 *   · 词条键，如 `layout.menu.users` —— 走 i18n，跟着右上角语言切换；
 *   · 直接文案，如「用户管理」—— 原样显示（多语言站点也能这样写死一个通用词）。
 *
 * 判定靠 `isI18nEntryKey`（至少两段点分），再用 `te()` 确认词条真的存在：
 * 只有「像键 + 确实有译文」才翻译，避免把用户写的普通英文单词当成 key 吃掉。
 */
import { isI18nEntryKey } from '#shared/utils/i18n';

export function useMenuTitle() {
  const { t, te } = useI18n();

  return function menuTitle(title?: string | null): string {
    if (!title) return '';
    if (!isI18nEntryKey(title)) return title;
    const key = title.trim();
    return te(key) ? t(key) : title;
  };
}
