/**
 * 通知已读状态 + 当前账号可见的公告列表。
 *
 * 顶栏铃铛红点和抽屉里的逐条小圆点必须是**同一个事实来源**：早先红点是
 * 写死的 `dot`，抽屉只有一个本地 `readAll`，点「全部已读」后铃铛照样亮。
 * 这里把已读 id 收敛成一份持久化状态，红点由 `unreadCount` 推导。
 *
 * 公告内容来自 `/api/notices`（已发布 + 在通知范围内，服务端过滤）。
 * `setItems` 由顶栏在挂载时调用：拿到真实公告后未读数按真实 id 计算；
 * 未加载时回退到 NOTICE_IDS，保证首屏与单测行为稳定。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { usePersistedState } from '../composables/usePersistedState';
import type { NoticeItem } from '../types/permission';

/** 未加载接口时的兜底 id（也是单测里的三条演示通知）。 */
export const NOTICE_IDS = [1, 2, 3] as const;
export type NoticeId = (typeof NOTICE_IDS)[number];

export interface NoticeState {
  readIds: number[];
}

export const NOTICE_DEFAULTS: NoticeState = { readIds: [] };

function mergeNoticeState(stored: NoticeState, defaults: NoticeState): NoticeState {
  const source = Array.isArray(stored?.readIds) ? stored.readIds : defaults.readIds;
  return {
    readIds: [...new Set(source.filter((id): id is number => Number.isInteger(id) && id > 0))],
  };
}

export const useNotificationStore = defineStore('notification', () => {
  const state = usePersistedState<NoticeState>('notification', { ...NOTICE_DEFAULTS }, {
    merge: mergeNoticeState,
  });

  /** 接口返回的真实公告；未加载时为空，未读数回退到 NOTICE_IDS。 */
  const items = ref<NoticeItem[]>([]);
  const noticeIds = computed<number[]>(() =>
    items.value.length > 0
      ? items.value.map((item) => Number(item.id))
      : [...NOTICE_IDS],
  );

  function setItems(list: NoticeItem[]): void {
    items.value = list;
  }

  /**
   * 顶部公告：已发布且置顶的公告，按 isTop 优先、发布时间倒序（接口已排好序）。
   * 单独派生一份，供顶部滚动条与单测共用，避免各自写过滤口径。
   */
  const topNotices = computed<NoticeItem[]>(() =>
    items.value.filter((item) => Number(item.isTop) === 1 && item.published),
  );

  const readIds = computed<number[]>(() => state.value.readIds);
  const unreadCount = computed(() =>
    noticeIds.value.filter((id) => !readIds.value.includes(id)).length,
  );
  const hasUnread = computed(() => unreadCount.value > 0);

  function isRead(id: number): boolean {
    return readIds.value.includes(id);
  }

  function markRead(id: number): void {
    if (isRead(id)) return;
    state.value = { readIds: [...readIds.value, id] };
  }

  function markAllRead(): void {
    state.value = { readIds: [...noticeIds.value] };
  }

  /** 演示/测试用：把所有通知恢复成未读。 */
  function reset(): void {
    state.value = { readIds: [] };
  }

  return {
    state, items, setItems, topNotices, readIds, noticeIds, unreadCount, hasUnread,
    isRead, markRead, markAllRead, reset,
  };
});
