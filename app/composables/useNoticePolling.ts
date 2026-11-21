/**
 * 公告定时轮询 —— 让管理员在后台任意页面新增公告后，其它已登录账号无需打开
 * 铃铛抽屉也能及时看到红点。
 *
 * 现状：`/api/notices` 只在打开抽屉时拉一次，用户停留在页面里时 store.items
 * 不会更新，新发的公告自然不亮红点。这里挂一次后台常驻轮询：
 *   · 每 30s 静默拉一次可见公告，写入 notification store → 红点由 unreadCount 推导自动亮；
 *   · 页面从后台切回前台（visibilitychange）立即补一次，避免切走期间错过；
 *   · 拉取失败静默保留上次的 items，不让红点/抽屉内容闪断；
 *   · 抽屉也读同一份 store、各自 setItems 同一接口数据，天然幂等，无需互斥。
 *
 * 挂点选在 admin 布局：它只在已登录的后台页面存在，退出登录后随布局卸载，
 * 定时器与监听器一起清理，不会在登录页或未登录时产生 401 噪音。
 */
import { onMounted, onUnmounted } from 'vue';
import { fetchMyNotices } from '../services/permission';
import { useNotificationStore } from '../stores/notification';

/** 轮询间隔：30s，与在线用户页刷新节奏一致，够快且不至于刷接口。 */
export const NOTICE_POLL_INTERVAL = 30_000;

export function useNoticePolling(intervalMs: number = NOTICE_POLL_INTERVAL): void {
  const notification = useNotificationStore();
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh(): Promise<void> {
    try {
      const result = await fetchMyNotices();
      notification.setItems(result.list ?? []);
    } catch {
      // 拉取失败保留上次内容；不打断用户当前操作。
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') void refresh();
  }

  onMounted(() => {
    void refresh();
    timer = setInterval(() => void refresh(), intervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
}
