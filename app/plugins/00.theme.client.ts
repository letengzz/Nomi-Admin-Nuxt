import type { Pinia } from 'pinia';
import { watch } from 'vue';
import { useSettingStore } from '../stores/setting';

/**
 * 主题同步插件 —— 初始化链的第一环（文件名前缀 00 固定执行顺序）。
 *
 * 它**不负责首帧**：首帧由 <head> 里的内联脚本完成（shared/utils/theme-bootstrap.ts）。
 * 这里做的是「接管」：把 localStorage 里的偏好读进 Pinia，之后用户每次切换都
 * 实时写回 <html>，并与内联脚本用同一套色阶算法，视觉上不出现二次跳变。
 *
 * 只在客户端执行：SSR 阶段读不到 localStorage，强行执行会产出与水合结果不一致
 * 的 HTML，表现为「服务端亮色、客户端暗色」的 hydration mismatch。
 *
 * 显式传入 nuxtApp.$pinia：插件之间只有文件名顺序这个约定，早于 Pinia 安装时
 * 直接调 useSettingStore() 会拿到未初始化 activePinia 的报错。
 */
export default defineNuxtPlugin((nuxtApp) => {
  const pinia = (nuxtApp as unknown as { $pinia?: Pinia }).$pinia;
  const setting = pinia ? useSettingStore(pinia) : useSettingStore();
  setting.applyTheme();
  watch([() => setting.isDark, () => setting.themeColor], () => setting.applyTheme());
});
