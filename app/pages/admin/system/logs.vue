<script setup lang="ts">
/**
 * 操作日志已迁入「系统监控 → 系统日志」（页内可切换登录日志 / 操作日志）。
 * 这里保留一条重定向，让旧书签、旧标签页不至于落到 404；路径替换而不是
 * 写死目标，是为了保留 /en 这类语言前缀。
 */
import { onMounted } from 'vue';

definePageMeta({ layout: 'admin' });
defineOptions({ name: 'NomiAdminLogsRedirect' });

const route = useRoute();

onMounted(() => {
  void navigateTo(route.path.replace('/admin/system/logs', '/admin/monitor/logs'), {
    replace: true,
  });
});
</script>

<template>
  <div />
</template>
