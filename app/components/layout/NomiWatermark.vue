<script setup lang="ts">
/**
 * 水印 —— 对应文档第 5 章全局组件清单里的 art-watermark。
 * 常驻挂载但只在软开关打开时绘制，用 SVG data URI 平铺，不拦截任何点击。
 *
 * 内容由 utils/watermark.ts 拼装：系统名 + 用途、当前用户 + 时间 + 登录 IP。
 * 时间从 onMounted 起每分钟刷新一次，首帧留空以避免 SSR/水合时间不一致。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useLayoutStore } from '../../stores/layout';
import { usePermissionStore } from '../../stores/permission';
import { useSettingStore } from '../../stores/setting';
import { useSiteStore } from '../../stores/site';
import { useUserStore } from '../../stores/user';
import {
  buildWatermarkSvg,
  formatWatermarkTime,
  toWatermarkBackground,
  WATERMARK_TILE,
} from '../../utils/watermark';

const layout = useLayoutStore();
const user = useUserStore();
const permission = usePermissionStore();
const setting = useSettingStore();
const site = useSiteStore();

const now = ref<Date | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  now.value = new Date();
  timer = setInterval(() => {
    now.value = new Date();
  }, 60_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const backgroundSize = `${WATERMARK_TILE.width}px ${WATERMARK_TILE.height}px`;

const backgroundImage = computed(() => {
  const profile = permission.adminInfo;
  const userName =
    profile?.nickname ||
    profile?.username ||
    user.info.userName ||
    user.info.userId ||
    (user.language === 'en' ? 'Guest' : '访客');

  return toWatermarkBackground(
    buildWatermarkSvg({
      systemName: site.name,
      internalLabel: user.language === 'en' ? 'Internal use only' : '内部使用',
      userName,
      dateTime: formatWatermarkTime(now.value),
      ip: profile?.lastLoginIp || '',
      dark: setting.isDark,
    }),
  );
});
</script>

<template>
  <div
    v-if="layout.state.showWatermark"
    class="nomi-watermark"
    :style="{ backgroundImage, backgroundSize }"
    aria-hidden="true"
  />
</template>

<style scoped>
.nomi-watermark {
  position: fixed;
  z-index: 1990;
  inset: 0;
  background-repeat: repeat;
  background-position: 0 0;
  pointer-events: none;
}
</style>
