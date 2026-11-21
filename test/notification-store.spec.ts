/**
 * 通知已读状态单测（不连 Nuxt 运行时）。
 *
 * 顶栏铃铛的红点、抽屉里的小圆点、「全部已读」按钮都读这一份状态，
 * 所以未读数必须随逐条已读递减、归零后红点条件为 false。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { NOTICE_IDS, useNotificationStore } from '../app/stores/notification';
import type { NoticeItem } from '../app/types/permission';
import { storageKey } from '../app/utils/storage-key';

/** 造一条公告：只覆盖顶部公告筛选用到的字段。 */
function notice(id: number, isTop: number, published: boolean): NoticeItem {
  return {
    id,
    title: `公告${id}`,
    category: 'notice',
    content: '内容',
    publishTime: 0,
    isTop,
    notifyMethod: 'internal',
    notifyScope: 'all',
    scopeIds: [],
    status: 1,
    creatorId: 1,
    creatorName: 'admin',
    createTime: 0,
    updateTime: 0,
    published,
  };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe('通知已读状态', () => {
  it('初始全部未读，红点条件为真', () => {
    const store = useNotificationStore();
    expect(store.readIds).toEqual([]);
    expect(store.unreadCount).toBe(NOTICE_IDS.length);
    expect(store.hasUnread).toBe(true);
  });

  it('逐条点已读只消掉那一条', () => {
    const store = useNotificationStore();
    store.markRead(1);
    expect(store.isRead(1)).toBe(true);
    expect(store.isRead(2)).toBe(false);
    expect(store.unreadCount).toBe(NOTICE_IDS.length - 1);

    // 重复点不能把同一条写两次，也不能改变未读数。
    store.markRead(1);
    expect(store.readIds).toEqual([1]);
  });

  it('全部已读后红点消失，按钮状态也随之关闭', () => {
    const store = useNotificationStore();
    store.markAllRead();
    expect(store.unreadCount).toBe(0);
    expect(store.hasUnread).toBe(false);
    expect(NOTICE_IDS.every((id) => store.isRead(id))).toBe(true);
  });

  it('已读状态持久化，刷新后仍是已读', async () => {
    const first = useNotificationStore();
    first.markAllRead();
    await nextTick();
    expect(localStorage.getItem(storageKey('notification'))).toContain('"readIds"');

    setActivePinia(createPinia());
    const second = useNotificationStore();
    expect(second.hasUnread).toBe(false);
  });

  it('旧存储里的脏 id 被过滤，不会凭空少算未读', () => {
    localStorage.setItem(
      storageKey('notification'),
      JSON.stringify({ readIds: [1, 'x', -3, 1, 999] }),
    );
    const store = useNotificationStore();
    expect(store.readIds).toEqual([1, 999]);
    expect(store.unreadCount).toBe(2);
  });

  it('reset 可以把演示通知恢复成未读', () => {
    const store = useNotificationStore();
    store.markAllRead();
    store.reset();
    expect(store.unreadCount).toBe(NOTICE_IDS.length);
  });
});

describe('顶部公告派生', () => {
  it('只取已发布且置顶的公告', () => {
    const store = useNotificationStore();
    store.setItems([
      notice(1, 1, true),   // 已发布置顶 ✓
      notice(2, 0, true),   // 已发布未置顶 ✗
      notice(3, 1, false),  // 定时中置顶 ✗
      notice(4, 1, true),   // 已发布置顶 ✓
    ]);
    expect(store.topNotices.map((item) => item.id)).toEqual([1, 4]);
  });

  it('无公告时顶部公告为空，红点仍走演示兜底', () => {
    const store = useNotificationStore();
    store.setItems([]);
    expect(store.topNotices).toEqual([]);
    expect(store.unreadCount).toBe(NOTICE_IDS.length);
  });

  it('真实公告进来后未读数按真实 id 计算，新公告点亮红点', () => {
    const store = useNotificationStore();
    store.setItems([notice(101, 0, true), notice(102, 1, true)]);
    expect(store.hasUnread).toBe(true);
    expect(store.unreadCount).toBe(2);
    store.markRead(101);
    store.markRead(102);
    expect(store.hasUnread).toBe(false);
  });
});
