<script setup lang="ts">
/**
 * 通知抽屉 —— 对应文档第 11.3 节 ArtNotification，挂在全局层由事件总线打开。
 *
 * 已读状态不再放在组件里：顶栏铃铛的红点与这里的小圆点都读 notification store，
 * 点一条 / 点「全部已读」之后两边同时消失，刷新页面也保持已读。
 */
import { computed, ref } from 'vue';
import { ElDrawer } from 'element-plus';
import { useWindowSize } from '@vueuse/core';
import NomiIcon from './NomiIcon.vue';
import { isMobileWidth } from '../../composables/useLayout';
import { useNotificationStore } from '../../stores/notification';
import { fetchMyNotices } from '../../services/permission';
import type { NoticeCategory } from '../../types/permission';
import { useNomiBus } from '../../utils/bus';
import { formatDate } from '../../utils/format';

const { t } = useI18n();
const visible = ref(false);
const loading = ref(false);
const notification = useNotificationStore();
const { width } = useWindowSize();
const drawerSize = computed(() => (isMobileWidth(width.value) ? 'min(88vw, 360px)' : '360px'));

/** 打开抽屉时拉一次，保证拿到最新发布且仍在范围内的公告。 */
async function loadNotices(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchMyNotices();
    notification.setItems(result.list ?? []);
  } catch {
    // 拉取失败时保留上一次的内容（或演示兜底），不让抽屉空白。
  } finally {
    loading.value = false;
  }
}

useNomiBus('openNotification', () => {
  visible.value = true;
  void loadNotices();
});

const CATEGORY_TONE: Record<NoticeCategory, string> = {
  notice: 'primary',
  bulletin: 'success',
  activity: 'warn',
};
const CATEGORY_ICON: Record<NoticeCategory, string> = {
  notice: 'notice',
  bulletin: 'shield',
  activity: 'orders',
};

/**
 * 真实公告映射成展示项；接口无数据时回退到三条演示通知。
 * linkable 标记只有真实公告才有详情页可去——演示通知点了只会标记已读，不跳一个必然 404 的链接。
 * text 是富文本正文，这里只在抽屉里展示纯文本摘要。
 */
const notices = computed(() => {
  if (notification.items.length > 0) {
    return notification.items.map((item) => ({
      id: Number(item.id),
      icon: CATEGORY_ICON[item.category] ?? 'notice',
      title: item.title,
      text: htmlToText(item.content),
      time: item.publishTime ? formatDate(item.publishTime) : formatDate(item.createTime),
      tone: CATEGORY_TONE[item.category] ?? 'primary',
      linkable: true,
    }));
  }
  return [
    {
      id: 1,
      icon: 'orders',
      title: t('layout.notice.orderTitle'),
      text: t('layout.notice.orderText'),
      time: '10:24',
      tone: 'primary',
      linkable: false,
    },
    {
      id: 2,
      icon: 'users',
      title: t('layout.notice.userTitle'),
      text: t('layout.notice.userText'),
      time: '09:12',
      tone: 'success',
      linkable: false,
    },
    {
      id: 3,
      icon: 'shield',
      title: t('layout.notice.systemTitle'),
      text: t('layout.notice.systemText'),
      time: t('layout.notice.yesterday'),
      tone: 'warn',
      linkable: false,
    },
  ];
});

/** 富文本正文 → 纯文本摘要，避免把 `<p>` 之类的标签直接显示在抽屉里。 */
function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 点标题进详情：先标已读，再关抽屉，最后跳到公告详情页（保留当前语言前缀）。 */
const localePath = useLocalePath();
async function openDetail(noticeId: number, linkable: boolean): Promise<void> {
  notification.markRead(noticeId);
  if (!linkable) return;
  visible.value = false;
  await navigateTo(localePath(`/admin/notice/${noticeId}`));
}
</script>

<template>
  <ElDrawer v-model="visible" :size="drawerSize" :with-header="false" :append-to-body="true">
    <div class="nomi-notice">
      <div class="nomi-notice-head">
        <h3>
          {{ t('layout.notice.title') }}
          <span v-if="notification.unreadCount" class="nomi-notice-unread">
            {{ notification.unreadCount }}
          </span>
        </h3>
        <button
          type="button"
          :disabled="!notification.hasUnread"
          @click="notification.markAllRead()"
        >
          {{ t('layout.notice.readAll') }}
        </button>
      </div>
      <div
        v-for="notice in notices"
        :key="notice.id"
        class="nomi-notice-item"
        :class="[`tone-${notice.tone}`, { 'is-read': notification.isRead(notice.id) }]"
      >
        <span class="nomi-notice-icon"><NomiIcon :name="notice.icon" :size="18" /></span>
        <div class="nomi-notice-body">
          <div class="nomi-notice-title">
            <button
              type="button"
              class="nomi-notice-title-link"
              :disabled="!notice.linkable"
              @click="openDetail(notice.id, notice.linkable)"
            >
              {{ notice.title }}
            </button>
            <span v-if="!notification.isRead(notice.id)" class="nomi-notice-dot" />
          </div>
          <p>{{ notice.text }}</p>
          <time>{{ notice.time }}</time>
        </div>
      </div>
      <p class="nomi-notice-footer">
        {{ loading ? t('app.loading') : t('layout.notice.noMore') }}
      </p>
    </div>
  </ElDrawer>
</template>

<style scoped>
.nomi-notice {
  padding: 4px 0 24px;
}

.nomi-notice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 16px;
  border-bottom: 1px solid var(--nomi-border);
}

.nomi-notice-head h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 17px;
}

.nomi-notice-unread {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  color: #fff;
  background: var(--danger, #dc2626);
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
}

.nomi-notice-head button {
  padding: 4px 8px;
  color: var(--el-color-primary);
  background: transparent;
  border: 0;
  font-size: 12px;
  cursor: pointer;
}

.nomi-notice-head button:disabled {
  color: var(--fg-muted);
  cursor: default;
  opacity: 0.55;
}

.nomi-notice-item {
  display: flex;
  gap: 12px;
  padding: 16px 4px;
  border-bottom: 1px solid var(--nomi-border);
  transition: opacity 0.2s var(--ease, ease);
}

.nomi-notice-item.is-read {
  opacity: 0.62;
}

.nomi-notice-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 11%, transparent);
  border-radius: 10px;
}

.tone-success .nomi-notice-icon {
  color: #16a34a;
  background: rgb(22 163 74 / 12%);
}

.tone-warn .nomi-notice-icon {
  color: #d97706;
  background: rgb(217 119 6 / 12%);
}

.nomi-notice-body {
  flex: 1;
  min-width: 0;
}

.nomi-notice-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.nomi-notice-title-link {
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nomi-notice-title-link:not(:disabled):hover {
  color: var(--el-color-primary);
}

.nomi-notice-title-link:disabled {
  cursor: default;
}

.nomi-notice-dot {
  width: 6px;
  height: 6px;
  background: var(--el-color-primary);
  border-radius: 50%;
}

.nomi-notice-body p {
  margin: 4px 0 6px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.6;
}

.nomi-notice-body time {
  color: var(--fg-muted);
  font-size: 11px;
}

.nomi-notice-footer {
  padding: 20px 0;
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
}
</style>
