<script setup lang="ts">
/**
 * 内联 SVG 图标表 —— 替代原设计里的 Iconify `ri:*`。
 *
 * 项目装了 @nuxt/icon，但没有离线图标集依赖；走 Iconify 远程 API 在断网、
 * 内网、构建机上会整片空白。NomiAuthTopBar 已经用内联 SVG 规避过同一个问题，
 * 这里把它抽成组件：图标名仍是配置里的一串字符串，组件层零外部请求。
 *
 * 统一 24×24 viewBox、stroke 风格、currentColor 描边，跟着文字色与主题走。
 * 两个例外走模板里的专用分支（而不是扁平路径表）：
 *   · 语言切换图标「文 / A」：两组笔画分别响应默认、悬浮、展开三种状态；
 *   · 快速入口图标：四个圆角方块 + 中间圆角十字留白，需要 fill 与 rx，
 *     用纯 stroke path 画不出内角的弧度（见 isFastEnter）。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number | string;
    strokeWidth?: number;
  }>(),
  { size: 20, strokeWidth: 1.7 },
);

const PATHS: Record<string, string[]> = {
  dashboard: ['M3 3h8v8H3z', 'M13 3h8v5h-8z', 'M13 10h8v11h-8z', 'M3 13h8v8H3z'],
  chart: ['M3 20h18', 'M6 16v-5', 'M11 16V6', 'M16 16v-8', 'M21 16v-3'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  users: [
    'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20',
    'M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M21 20v-1.5a4 4 0 0 0-3-3.87',
    'M16 3.6a3.5 3.5 0 0 1 0 6.8',
  ],
  orders: ['M4 5h16v16H4z', 'M4 9h16', 'M8 3v4', 'M16 3v4', 'M8 13h5', 'M8 17h8'],
  // 语言管理：地球 + 经纬线，与顶栏的「文/A」切换图标区分开
  language: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21', 'M12 3c-2.5 2.6-3.8 5.7-3.8 9S9.5 18.4 12 21'],
  // 角色：一张工牌（证件照 + 两行信息）。与 users（两个人）刻意区分开，
  // 因为「角色管理」和「用户管理」在侧边栏里是相邻的两项。
  role: [
    'M3 5.5h18v13H3z',
    'M8.6 12.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z',
    'M5.4 16.4c.7-1.6 1.9-2.4 3.2-2.4s2.5.8 3.2 2.4',
    'M14.2 9.6h4.4',
    'M14.2 13h4.4',
    'M14.2 16.4h3',
  ],
  // 部门：三级组织树（一个父节点挂两个子节点）。
  department: [
    'M9.5 2.5h5v3.5h-5z',
    'M2.5 10h5v3.5h-5z',
    'M16.5 10h5v3.5h-5z',
    'M12 6v2',
    'M5 8h14',
    'M5 8v2',
    'M19 8v2',
  ],
  file: ['M6 2.5h8l4 4V21H6z', 'M14 2.5v4h4', 'M9 12h6', 'M9 16h6'],
  settings: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
    'M19.4 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.47-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1.7z',
  ],
  sliders: ['M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h10', 'M18 18h2', 'M14 4v4', 'M8 10v4', 'M14 16v4'],
  shield: ['M12 2.5l8 3v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10v-6z', 'M9 12l2 2 4-4'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  refresh: ['M20 11a8 8 0 1 0-2.3 6.1', 'M20 5v6h-6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  fullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  'fullscreen-exit': ['M9 4v5H4', 'M15 4v5h5', 'M9 20v-5H4', 'M15 20v-5h5'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8', 'M10 20a2 2 0 0 0 4 0'],
  chat: ['M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z', 'M8 11h8', 'M8 15h5'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4',
    'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4',
  ],
  moon: ['M20 14.4A8.5 8.5 0 0 1 9.6 4 8.5 8.5 0 1 0 20 14.4z'],
  home: ['M3 10.5L12 3l9 7.5', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  'chevron-left': ['M15 6l-6 6 6 6'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],
  // 第三方绑定：两节链接。左右两段各自是一个「钩 + 直线」，中间不闭合，
  // 16px 下也看得出是两个环扣在一起，而不是一根横杠。
  link: [
    'M10.2 13.4a4.2 4.2 0 0 0 5.9 0l2.4-2.4a4.2 4.2 0 0 0-5.9-5.9l-1.1 1.1',
    'M13.8 10.6a4.2 4.2 0 0 0-5.9 0l-2.4 2.4a4.2 4.2 0 0 0 5.9 5.9l1.1-1.1',
  ],
  palette: [
    'M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.8 1.8 0 0 1 1.4-2.9h1.4A3.5 3.5 0 0 0 21 11.3C20.6 6.8 16.8 3 12 3z',
    'M7.5 11h.01', 'M10 7.5h.01', 'M15 7.5h.01',
  ],
  pin: ['M9 3h6l-1 6 3 3v2H7v-2l3-3z', 'M12 14v7'],
  plus: ['M12 5v14', 'M5 12h14'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
  // function（快速入口）不用路径表：四个圆角方块在模板专用分支里画。
  switch: ['M4 8h14l-3-3', 'M20 16H6l3 3'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  mobile: ['M7 2h10v20H7z', 'M11 18h2'],
  eye: ['M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  mail: ['M3 5h18v14H3z', 'M3 6l9 7 9-7'],
  trending: ['M3 17l6-6 4 4 8-8', 'M17 7h4v4'],
  wallet: ['M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1z', 'M3 7V5a1 1 0 0 1 1-1h12', 'M16 13h2'],
  copy: ['M9 9h11v11H9z', 'M15 5H4v11'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'],
  reset: ['M4 4v6h6', 'M4.6 14a8 8 0 1 0 1.6-6.5L4 10'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  sparkles: ['M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
};

// 这两个图标需要独立 SVG 结构，交给模板里的专用分支，避免两套定义分叉。
const isLanguage = computed(() => props.name === 'translate');
const isFastEnter = computed(() => props.name === 'function');
// info 也是：路径表里的 'M12 8h.01' 是拿一根极短的线段当「点」，
// 在 14px 这类小尺寸下会被压成不到 1px 的一抹灰，看上去只有个空心圆。
const isInfo = computed(() => props.name === 'info');
const paths = computed(() => PATHS[props.name] ?? PATHS.info ?? []);
const pixelSize = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
// 双字形笔画比几何图标密：小尺寸略加粗才不发虚，放大后回到细笔画。
const stroke = computed(() => {
  if (!isLanguage.value) return props.strokeWidth;
  return typeof props.size === 'number' && props.size <= 20 ? 1.6 : 1.45;
});
</script>

<template>
  <svg
    :width="pixelSize"
    :height="pixelSize"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="isLanguage">
      <!-- 「文」：点 / 横 / 撇 / 捺；撇捺从横两端起笔并在中间交叉成「乂」 -->
      <g class="nomi-icon__han" stroke="currentColor">
        <path d="M6.9 5v1.5" />
        <path d="M2.8 8.4h8.2" />
        <path d="M8.6 8.8C8.1 12.4 6.5 15.8 3.2 19.2" />
        <path d="M5.2 8.8c1 3.6 3 6.9 6 10.4" />
      </g>
      <!-- 「A」：与「文」共用基线，略窄以平衡两个字符的视觉重量 -->
      <g class="nomi-icon__latin" stroke="currentColor">
        <path d="M14 19.2l3.9-12.4 3.9 12.4" />
        <path d="M15.2 15.2h5.4" />
      </g>
      <!-- 展开态指示点，位于字形下方留白内，不改变按钮尺寸 -->
      <circle class="nomi-icon__marker" cx="12" cy="21.5" r="1.35" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="isInfo">
      <!--
        「i」的信息图标：外圈描边、竖线描边、点用实心圆。
        点的半径取 1.25（约图标的 20%）：缩到 14px 时仍有 1px 出头，
        不会像 tick 线那样在小尺寸下消失。竖线略细且短一档，
        和外圈之间留出呼吸，避免整颗图标糊成一团深色。
      -->
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5.3" />
      <circle cx="12" cy="7.7" r="1.25" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="isFastEnter">
      <!--
        四个带弧度的正方形；2.8px 的间隙就是一个「+」，四块内角的圆弧让
        十字的交汇处与四个端头都圆润，而不是硬邦邦的直角网格。
        rx 统一取 2.6：外角与内角同一种弧度，整体才像一个被十字分开的圆角方块。
        四块整体占 3..21，中心正好是 12，缩小到顶栏尺寸时也不会偏。
      -->
      <g fill="currentColor" stroke="none">
        <rect x="3" y="3" width="7.6" height="7.6" rx="2.6" />
        <rect x="13.4" y="3" width="7.6" height="7.6" rx="2.6" />
        <rect x="3" y="13.4" width="7.6" height="7.6" rx="2.6" />
        <rect x="13.4" y="13.4" width="7.6" height="7.6" rx="2.6" />
      </g>
    </template>
    <template v-else>
      <path v-for="(d, index) in paths" :key="index" :d="d" />
    </template>
  </svg>
</template>

<style scoped>
.nomi-icon__latin {
  opacity: var(--nomi-lang-secondary-opacity, 0.8);
  transition: opacity 0.18s var(--ease, ease);
}

.nomi-icon__marker {
  opacity: var(--nomi-lang-marker-opacity, 0);
  transition: opacity 0.18s var(--ease, ease);
}

@media (prefers-reduced-motion: reduce) {
  .nomi-icon__latin,
  .nomi-icon__marker {
    transition: none;
  }
}
</style>
