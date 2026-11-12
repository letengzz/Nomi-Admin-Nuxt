/**
 * 主题色工具：把「一个主色 + 明暗模式」展开成 Element Plus 需要的整套 CSS 变量。
 *
 * 保持纯函数（除最后一个写 DOM 的 applyThemeToDocument），这样在 vitest 里
 * 不需要 Nuxt 运行时就能测。
 *
 * 首帧用的那一份实现在 shared/utils/theme-bootstrap.ts（内联进 <head> 的脚本）。
 * 两边的色阶算法必须一致，test/theme-bootstrap.spec.ts 会比较两者的输出。
 */
import { DEFAULT_THEME_COLOR } from '#shared/utils/theme-bootstrap';

export const THEME_COLORS = [
  DEFAULT_THEME_COLOR,
  '#B48DF3',
  '#1D84FF',
  '#60C041',
  '#38C0FC',
  '#F9901F',
  '#FF80C8',
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number];
export type ColorMode = 'light' | 'dark' | 'auto';

function parseHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(channels: readonly number[]): string {
  return `#${channels
    .map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/** weightA 是 colorA 的占比，其余为 colorB。与 Sass mix($a, $b, $weight) 同义。 */
export function mixColor(colorA: string, colorB: string, weightA: number): string {
  const a = parseHex(colorA);
  const b = parseHex(colorB);
  const weight = Math.min(1, Math.max(0, weightA));
  return toHex([
    (a[0] * weight + b[0] * (1 - weight)),
    (a[1] * weight + b[1] * (1 - weight)),
    (a[2] * weight + b[2] * (1 - weight)),
  ]);
}

/** light-1..9 由底色（亮色白 / 暗色黑）与当前主色混合，与 Element Plus 官方主题一致。 */
export function buildPrimaryVars(color: string, isDark: boolean): Record<string, string> {
  const base = isDark ? '#000000' : '#FFFFFF';
  const primary = color.toUpperCase();
  const vars: Record<string, string> = {
    '--el-color-primary': primary,
    '--main-color': primary,
    '--theme-color': primary,
  };
  for (let i = 1; i <= 9; i += 1) {
    vars[`--el-color-primary-light-${i}`] = mixColor(base, primary, i / 10);
  }
  vars['--el-color-primary-dark-2'] = mixColor(isDark ? '#FFFFFF' : '#000000', primary, 0.2);
  return vars;
}

/** 把主题写到 <html>，组件只需读 var(--el-color-primary)，无需感知主题状态。 */
export function applyThemeToDocument(root: HTMLElement, color: string, isDark: boolean): void {
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  for (const [name, value] of Object.entries(buildPrimaryVars(color, isDark))) {
    root.style.setProperty(name, value);
  }
}
