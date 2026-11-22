/**
 * 状态层单测 —— 覆盖 docs/状态管理.md 里最容易坏、又最难从界面反推的几条链路：
 *
 *   · 版本化存储键的搬迁与清理（升级后偏好不能丢，旧键不能堆在存储里）；
 *   · menu store 的首页推导与扁平表（接动态菜单后，面包屑/标签页都靠它）；
 *   · user store 的登出清理与「换用户」判断（登出没清干净 = 数据越权）；
 *   · worktab 按路由名复用标签（否则动态路由会开出一排同名标签）。
 *
 * 全部跑在 happy-dom + 裸 Pinia 上，不需要拉起 Nuxt 运行时。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { HOME_PATH } from '../app/constants/layout';
import { useMenuStore } from '../app/stores/menu';
import { useTableStore, TABLE_DEFAULTS, TABLE_STORAGE_KEY } from '../app/stores/table';
import { useUserStore, USER_STORAGE_KEY, LAST_USER_ID_KEY } from '../app/stores/user';
import { useWorktabStore } from '../app/stores/worktab';
import {
  legacyStorageKey,
  migrateLegacyKeys,
  purgeOutdatedStorage,
  STORAGE_SCHEMA_VERSION,
  storageKey,
  takeLegacyValue,
} from '../app/utils/storage-key';

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe('版本化存储键', () => {
  it('键格式是 nomi:v{schema}:{name}', () => {
    expect(storageKey('layout')).toBe(`nomi:v${STORAGE_SCHEMA_VERSION}:layout`);
    expect(legacyStorageKey('layout')).toBe('nomi:layout');
  });

  it('老键只在新键不存在时搬迁，之后删除老键', () => {
    localStorage.setItem('nomi:layout', '{"menuOpen":false}');
    expect(migrateLegacyKeys(storageKey('layout'), [legacyStorageKey('layout')])).toBe(true);
    expect(localStorage.getItem(storageKey('layout'))).toBe('{"menuOpen":false}');
    expect(localStorage.getItem('nomi:layout')).toBeNull();
  });

  it('新键已存在时不会被老键覆盖', () => {
    localStorage.setItem(storageKey('layout'), '{"menuOpen":true}');
    localStorage.setItem('nomi:layout', '{"menuOpen":false}');
    migrateLegacyKeys(storageKey('layout'), [legacyStorageKey('layout')]);
    expect(localStorage.getItem(storageKey('layout'))).toBe('{"menuOpen":true}');
    expect(localStorage.getItem('nomi:layout')).toBeNull();
  });

  it('单值老键读一次就删', () => {
    localStorage.setItem('nomi:access-token', JSON.stringify('token-a'));
    expect(takeLegacyValue<string>('access-token')).toBe('token-a');
    expect(localStorage.getItem('nomi:access-token')).toBeNull();
    expect(takeLegacyValue<string>('access-token')).toBeUndefined();
  });

  it('清理不属于当前 schema 的键，且不误伤当前版本与主题键', () => {
    localStorage.setItem('nomi:v0:layout', '{}');
    localStorage.setItem('nomi:v9:user', '{}');
    localStorage.setItem(storageKey('layout'), '{}');
    localStorage.setItem('nomi:color-mode', 'dark');

    expect(purgeOutdatedStorage()).toEqual(['nomi:v0:layout', 'nomi:v9:user']);
    expect(localStorage.getItem(storageKey('layout'))).toBe('{}');
    expect(localStorage.getItem('nomi:color-mode')).toBe('dark');
  });
});

describe('menu store', () => {
  it('默认读静态菜单，首页是 /admin', () => {
    const menu = useMenuStore();
    expect(menu.homePath).toBe(HOME_PATH);
    expect(menu.findMenu('/admin/orders')?.title).toBe('layout.menu.orders');
  });

  it('setMenuList 由菜单树推导首页路径与扁平表', () => {
    const menu = useMenuStore();
    menu.setMenuList([
      {
        path: '#group-a',
        title: 'group.a',
        icon: 'grid',
        children: [{ path: '/a/one', title: 'a.one', icon: 'file' }],
      },
      { path: '/b', title: 'b', icon: 'user' },
    ]);

    expect(menu.homePath).toBe('/a/one');
    expect(menu.findMenu('/a/one')?.parent).toBe('group.a');
    expect(menu.menuPaths.has('#group-a')).toBe(false);
  });

  it('详情页用 activePath 指回所属列表', () => {
    const menu = useMenuStore();
    expect(menu.activePathOf('/admin/orders/detail')).toBe('/admin/orders');
    expect(menu.activePathOf('/admin/unknown')).toBe('/admin/unknown');
  });

  it('reset 回到静态菜单并恢复首页', () => {
    const menu = useMenuStore();
    menu.setMenuList([{ path: '/only', title: 'only', icon: 'file' }]);
    menu.reset();
    expect(menu.homePath).toBe(HOME_PATH);
    expect(menu.findMenu('/admin/analytics')).toBeDefined();
  });
});

describe('table store', () => {
  it('默认值可读，setter 生效并写入持久化键', async () => {
    const table = useTableStore();
    expect(table.state).toEqual(TABLE_DEFAULTS);

    table.setIsZebra(true);
    table.setTableSize('small');
    await nextTick();

    expect(table.state.isZebra).toBe(true);
    expect(table.state.tableSize).toBe('small');
    expect(localStorage.getItem(TABLE_STORAGE_KEY)).toContain('"isZebra":true');
  });

  it('reset 恢复默认观感', () => {
    const table = useTableStore();
    table.setIsBorder(true);
    table.toggleZebra();
    table.reset();
    expect(table.state).toEqual(TABLE_DEFAULTS);
  });
});

describe('user store', () => {
  it('登录态由 token 推导，不用第二个 isLogin 字段', () => {
    const user = useUserStore();
    expect(user.isLogin).toBe(false);
    user.login({ token: 't1', info: { userId: 'u1', userName: 'nomi' } });
    expect(user.isLogin).toBe(true);
    expect(user.info.userName).toBe('nomi');
  });

  it('重新登录但服务端没发 refresh token 时，旧的续期凭据要清掉', () => {
    const user = useUserStore();
    user.login({ token: 't1', refreshToken: 'r1', info: { userId: 'u1', userName: 'nomi' } });
    expect(user.refreshToken).toBe('r1');

    // 「记住密码」取消勾选：keepLogin=false，服务端返回空 refresh token。
    user.login({ token: 't2', info: { userId: 'u1', userName: 'nomi' } });
    expect(user.refreshToken).toBe('');
  });

  it('登出清凭证与身份，但保留语言与搜索历史', async () => {
    const user = useUserStore();
    user.login({ token: 't1', info: { userId: 'u1', userName: 'nomi' } });
    user.setLanguage('en');
    user.addSearchHistory('/admin/system/users');

    expect(user.logOut()).toBe('/login');
    expect(user.isLogin).toBe(false);
    expect(user.info.userName).toBe('');
    expect(user.language).toBe('en');
    expect(user.searchHistory).toEqual(['/admin/system/users']);

    await nextTick();
    expect(localStorage.getItem(USER_STORAGE_KEY)).not.toContain('t1');
  });

  it('换来一个人登录时清空标签页，同一个人重登则保留', () => {
    const user = useUserStore();
    const worktab = useWorktabStore();

    user.login({ token: 't1', info: { userId: 'u1', userName: 'u1' } });
    worktab.openTab('/admin/analytics');
    user.logOut();

    // 同一个人回来：标签还在
    user.login({ token: 't2', info: { userId: 'u1', userName: 'u1' } });
    expect(worktab.opened.map((tab) => tab.path)).toContain('/admin/analytics');

    user.logOut();
    // 换人：只剩固定的首页标签
    user.login({ token: 't3', info: { userId: 'u2', userName: 'u2' } });
    expect(worktab.opened.map((tab) => tab.path)).toEqual([HOME_PATH]);
    expect(localStorage.getItem(LAST_USER_ID_KEY)).toBeNull();
  });

  it('搜索历史去重、最多 8 条、最近的在前', () => {
    const user = useUserStore();
    user.addSearchHistory('/admin');
    user.addSearchHistory('/admin/system/users');
    user.addSearchHistory('/admin');

    expect(user.searchHistory).toEqual(['/admin', '/admin/system/users']);

    for (let index = 0; index < 12; index += 1) {
      user.addSearchHistory(`/admin/p${index}`);
    }
    expect(user.searchHistory).toHaveLength(8);
    expect(user.searchHistory[0]).toBe('/admin/p11');

    user.clearSearchHistory();
    expect(user.searchHistory).toEqual([]);
  });
});

describe('worktab store 的标签复用', () => {
  it('同一路由名不同参数只占一个标签，并更新路径', () => {
    const worktab = useWorktabStore();
    worktab.openTab('/admin/system/users', { name: 'NomiAdminUsers', query: { page: '1' } });
    worktab.openTab('/admin/system/users', { name: 'NomiAdminUsers', query: { page: '2' } });

    const tabs = worktab.opened.filter((tab) => tab.name === 'NomiAdminUsers');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.query).toEqual({ page: '2' });

    // 重新打开会把页面请出缓存排除名单（否则拿到的还是旧实例）
    worktab.addKeepAliveExclude('NomiAdminUsers');
    worktab.openTab('/admin/system/users', { name: 'NomiAdminUsers' });
    expect(worktab.keepAliveExclude).not.toContain('NomiAdminUsers');
  });

  it('validateWorktabs 清掉已经不在菜单里的标签', () => {
    const worktab = useWorktabStore();
    worktab.openTab('/admin/analytics');
    worktab.opened.push({ path: '/admin/gone', title: 'gone', icon: 'file' });

    worktab.validateWorktabs();
    expect(worktab.opened.some((tab) => tab.path === '/admin/gone')).toBe(false);
    expect(worktab.opened.some((tab) => tab.path === '/admin/analytics')).toBe(true);
  });
});
