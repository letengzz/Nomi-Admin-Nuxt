<script setup lang="ts">
/**
 * 主布局容器 —— 对应 docs/主布局设计.md 第 3 章 views/index/index.vue（29 行）。
 *
 * 「薄容器 + 厚组件」：模板只有四个正交节点，容器只负责 flex 骨架与滚动模型，
 * 显隐逻辑全部下沉到区域组件：
 *   aside  → NomiSidebarMenu 自己按 menuType 决定渲不渲染
 *   header → NomiHeaderBar 自己按 menuType 决定渲染哪种菜单
 *   content→ NomiPageContent 自己按 route meta 决定全屏 / 刷新
 *   global → NomiGlobalComponent 按配置列表决定挂载哪些浮层
 * 新增第五种布局时，这个文件一行都不用改（第 1.3 节）。
 *
 * Nuxt 里没有 main.ts / App.vue 里的第二个 RouterView：页面由 <NuxtPage>
 * 通过 layout 的 <slot /> 传入，页面过渡与 KeepAlive 由 app.vue 与
 * definePageMeta({ keepalive }) 负责（见 NomiPageContent 的说明）。
 */
import { onMounted, watch } from 'vue';
import NomiGlobalComponent from '../components/layout/NomiGlobalComponent.vue';
import NomiHeaderBar from '../components/layout/NomiHeaderBar.vue';
import NomiPageContent from '../components/layout/NomiPageContent.vue';
import NomiSidebarMenu from '../components/layout/NomiSidebarMenu.vue';
import NomiSiteFooter from '../components/layout/NomiSiteFooter.vue';
import {
  scrollMainToTop,
  useLayoutDom,
  useMenuThemeSync,
  useMobileDrawer,
  useMobileDrawerEffects,
  useResponsiveLayout,
} from '../composables/useLayout';
import { useNoticePolling } from '../composables/useNoticePolling';
import { useWorktabStore } from '../stores/worktab';
import { normalizeMenuPath } from '../utils/path';

const route = useRoute();
const worktab = useWorktabStore();
const { isMobile, isOpen: isDrawerOpen, close: closeDrawer } = useMobileDrawer();

useLayoutDom();
useResponsiveLayout();
// 暗色模式下侧栏跟着变暗：侧栏是布局的一部分，同步只在这里挂一次。
useMenuThemeSync();
// 抽屉的副作用（背景锁滚动 / ESC / 导航自动收起）在布局容器里只挂一次。
useMobileDrawerEffects();
// 公告轮询：停留在本布局任意页面也能及时拿到新公告，右上角红点随 store 更新。
useNoticePolling();

// 每次导航：登记工作标签 + 主区回到顶部。滚动容器是 #app-main 而不是 window，
// 否则从长页面跳到短页面会停在中段（第 1.5 节）。
watch(
  () => route.fullPath,
  () => {
    worktab.openTab(normalizeMenuPath(route.path));
    scrollMainToTop();
  },
  { immediate: true },
);

// 持久化下来的标签可能指着已经被下线的菜单（或上一个版本的路由）。
// 进布局时校验一次，清掉点开就 404 的入口（docs/状态管理.md 5.4）。
onMounted(() => {
  worktab.validateWorktabs();
});
</script>

<template>
  <div class="nomi-layout">
    <aside id="app-sidebar" :class="{ 'is-drawer-open': isDrawerOpen }">
      <NomiSidebarMenu />
    </aside>

    <!--
      遮罩必须放在 #app-sidebar 之外：抽屉有 transform，会成为其内部
      position:fixed 元素的包含块，把遮罩裁进 288px 的抽屉里。
    -->
    <div
      v-if="isMobile"
      class="nomi-drawer-backdrop"
      :class="{ 'is-visible': isDrawerOpen }"
      aria-hidden="true"
      @click="closeDrawer"
    />

    <main id="app-main">
      <div id="app-header">
        <NomiHeaderBar />
      </div>
      <div id="app-content">
        <NomiPageContent>
          <slot />
        </NomiPageContent>
      </div>
      <NomiSiteFooter />
    </main>

    <div id="app-global">
      <NomiGlobalComponent />
    </div>
  </div>
</template>
