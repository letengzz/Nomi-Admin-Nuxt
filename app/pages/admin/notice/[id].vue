<script setup lang="ts">
/**
 * 通知中心详情：铃铛里点某条公告的标题进来，看这条消息的完整正文。
 *
 * 数据来自 GET /api/notices/:id —— 服务端已按登录上下文校验「已发布 + 启用 +
 * 在通知范围内」，越权的 id 只会拿到「公告不存在」。
 *
 * 正文是富文本 HTML：入库时服务端已按白名单净化（server/utils/rich-html.ts），
 * 渲染前再用 DOMPurify 过一遍（app/utils/safe-html.ts）—— 两层用同一份标签清单。
 * 前端这层不是「重复劳动」：它用的是浏览器自己的解析器，能校掉服务端解析与浏览器解析
 * 之间的分歧（mXSS 就活在这个缝隙里）。
 *
 * definePageMeta 不写 pageFill：详情页跟随默认滚动容器；activePath 指向公告管理，
 * 让侧栏高亮它所属的菜单而不是一个不存在的详情路由。
 */
import { computed, ref } from 'vue';
import { ElTag } from 'element-plus';
import NomiIcon from '../../../components/layout/NomiIcon.vue';
import { fetchNoticeById } from '../../../services/permission';
import type { NoticeCategory, NoticeItem } from '../../../types/permission';
import { formatDateTime } from '../../../utils/format';
import { safeRichHtml } from '../../../utils/safe-html';

definePageMeta({ layout: 'admin', keepalive: false, activePath: '/admin/system/notices' });
defineOptions({ name: 'NomiAdminNoticeDetail' });

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();

const notice = ref<NoticeItem | null>(null);
const loading = ref(true);
const error = ref('');

/** 净化后的正文：模板只认这个变量，避免有人回头直接绑 notice.content。 */
const safeContent = computed(() => safeRichHtml(notice.value?.content ?? ''));

const categoryLabel = computed(() => {
  if (!notice.value) return '';
  const key: Record<NoticeCategory, string> = {
    notice: 'auth.notice.categoryNotice',
    bulletin: 'auth.notice.categoryBulletin',
    activity: 'auth.notice.categoryActivity',
  };
  return t(key[notice.value.category] ?? 'auth.notice.categoryNotice');
});

useHead({ title: computed(() => t('auth.notice.detail.title')) });

async function load(): Promise<void> {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  loading.value = true;
  error.value = '';
  try {
    if (!Number.isInteger(id) || id <= 0) throw new Error(t('auth.notice.detail.notFound'));
    notice.value = await fetchNoticeById(id);
  } catch (err) {
    notice.value = null;
    error.value = (err as Error).message || t('auth.notice.detail.notFound');
  } finally {
    loading.value = false;
  }
}

void load();
</script>

<template>
  <div class="notice-detail-page">
    <div class="nomi-page-toolbar nomi-page-toolbar--end">
      <NuxtLink :to="localePath('/admin/system/notices')" class="nomi-btn">
        <NomiIcon name="arrow-left" :size="15" />{{ t('auth.notice.detail.gone') }}
      </NuxtLink>
    </div>

    <section v-loading="loading" class="page-content notice-detail">
      <template v-if="notice">
        <header class="notice-detail-head">
          <h1>{{ notice.title }}</h1>
          <div class="notice-detail-meta">
            <ElTag v-if="notice.isTop" size="small" type="danger" effect="plain">
              {{ t('auth.notice.top') }}
            </ElTag>
            <ElTag size="small" type="primary" effect="plain">{{ categoryLabel }}</ElTag>
            <span class="notice-detail-meta-item">
              {{ t('auth.notice.detail.publisher') }}：{{ notice.creatorName || '—' }}
            </span>
            <span class="notice-detail-meta-item">
              {{ t('auth.notice.detail.publishTime') }}：{{
                formatDateTime(notice.publishTime || notice.createTime)
              }}
            </span>
          </div>
        </header>
        <!-- 正文经服务端白名单 + 前端 DOMPurify 双层净化；deep 样式把排版约束在卡片内。 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <article class="notice-detail-body" v-html="safeContent" />
      </template>

      <div v-else-if="!loading" class="notice-detail-empty">
        <NomiIcon name="notice" :size="36" />
        <p>{{ error || t('auth.notice.detail.notFound') }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notice-detail {
  max-width: 900px;
  margin: 0 auto;
  min-height: 240px;
}

.notice-detail-head {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--nomi-border);
}

.notice-detail-head h1 {
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.4;
}

.notice-detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--fg-muted);
  font-size: 12px;
}

.notice-detail-meta-item {
  display: inline-flex;
  align-items: center;
}

.notice-detail-body {
  padding: 20px 2px 8px;
  color: var(--fg, #1f2937);
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
}

.notice-detail-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.notice-detail-body :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}

.notice-detail-body :deep(th),
.notice-detail-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--nomi-border);
}

.notice-detail-body :deep(pre) {
  overflow-x: auto;
  padding: 12px;
  background: var(--bg-subtle);
  border-radius: 6px;
}

.notice-detail-body :deep(h1),
.notice-detail-body :deep(h2),
.notice-detail-body :deep(h3) {
  margin: 18px 0 8px;
  font-weight: 600;
}

.notice-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 200px;
  color: var(--fg-muted);
}
</style>
