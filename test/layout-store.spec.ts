/**
 * 主布局状态层单测：布局切换的连锁规则、持久化、标签栏与事件总线。
 *
 * 这些逻辑一旦出错，症状都是「点设置面板没反应 / 刷新后配置丢失」这类
 * 很难从界面反推的问题，所以把它们留在不依赖 Nuxt 运行时的快测试里。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAYOUT_BREAKPOINTS,
  MENU_THEME_CHOICES,
  MenuThemeEnum,
  MenuTypeEnum,
  PAGE_TRANSITIONS,
} from '../app/constants/layout';
import { getMobileDrawerWidth, isMobileWidth } from '../app/composables/useLayout';
import {
  LAYOUT_DEFAULTS,
  LAYOUT_STORAGE_KEY,
  useLayoutStore,
} from '../app/stores/layout';
import { useWorktabStore, WORKTAB_STORAGE_KEY } from '../app/stores/worktab';
import { emitNomiBus, onNomiBus } from '../app/utils/bus';

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe('layout store', () => {
  it('首次进入是左侧菜单、展开态', () => {
    const store = useLayoutStore();
    expect(store.state.menuType).toBe(MenuTypeEnum.LEFT);
    expect(store.state.menuOpen).toBe(true);
    expect(store.getMenuOpenWidth).toBe('230px');
  });

  it('切到双栏菜单会强制亮色主题并展开侧栏', () => {
    const store = useLayoutStore();
    store.patch({ menuTheme: MenuThemeEnum.DARK, menuOpen: false });
    store.switchMenuLayouts(MenuTypeEnum.DUAL_MENU);

    expect(store.state.menuType).toBe(MenuTypeEnum.DUAL_MENU);
    expect(store.state.menuTheme).toBe(MenuThemeEnum.LIGHT);
    expect(store.state.menuOpen).toBe(true);
  });

  it('切到混合菜单会展开侧栏，切到顶部菜单不动它', () => {
    const store = useLayoutStore();
    store.setMenuOpen(false);
    store.switchMenuLayouts(MenuTypeEnum.TOP_LEFT);
    expect(store.state.menuOpen).toBe(true);

    store.setMenuOpen(false);
    store.switchMenuLayouts(MenuTypeEnum.TOP);
    expect(store.state.menuOpen).toBe(false);
  });

  it('水合不会用 SSR 快照覆盖 localStorage 里的真实偏好', () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ ...LAYOUT_DEFAULTS, menuType: MenuTypeEnum.TOP, menuOpenWidth: 280 }),
    );
    const pinia = createPinia();
    pinia.state.value = { layout: { state: { ...LAYOUT_DEFAULTS } } };
    setActivePinia(pinia);

    const store = useLayoutStore();
    expect(store.state.menuType).toBe(MenuTypeEnum.TOP);
    expect(store.state.menuOpenWidth).toBe(280);
    // mergeDefaults 让老存储缺字段时也能拿到新默认值，而不是 undefined。
    expect(store.state.showWorkTab).toBe(true);
  });

  it('reset 恢复全部默认值', () => {
    const store = useLayoutStore();
    store.patch({ menuType: MenuTypeEnum.TOP, customRadius: '1.5', showWorkTab: false });
    store.reset();
    expect(store.state).toEqual(LAYOUT_DEFAULTS);
  });
});

describe('worktab store', () => {
  it('打开标签去重，固定标签排在前面', () => {
    const store = useWorktabStore();
    store.openTab('/admin/analytics');
    store.openTab('/admin/analytics');
    store.openTab('/admin/system/users');

    expect(store.opened.map((tab) => tab.path)).toEqual([
      '/admin',
      '/admin/analytics',
      '/admin/system/users',
    ]);
    expect(store.opened[0]?.fixedTab).toBe(true);
  });

  it('关闭当前标签时返回相邻路径，固定标签不可关闭', () => {
    const store = useWorktabStore();
    store.openTab('/admin/analytics');
    store.openTab('/admin/system/users');

    expect(store.removeTab('/admin', '/admin')).toBeUndefined();
    expect(store.removeTab('/admin/analytics', '/admin/analytics')).toBe('/admin/system/users');
    expect(store.opened.some((tab) => tab.path === '/admin')).toBe(true);
  });

  it('关闭操作会把页面加入 KeepAlive 排除名单', () => {
    const store = useWorktabStore();
    store.openTab('/admin/analytics', { name: 'NomiAdminAnalytics' });
    expect(store.removeTab('/admin/analytics', '/admin')).toBeUndefined();
    expect(store.keepAliveExclude).toContain('NomiAdminAnalytics');
  });

  it('标签列表可持久化', async () => {
    const store = useWorktabStore();
    store.openTab('/admin/orders');
    await Promise.resolve();
    expect(localStorage.getItem(WORKTAB_STORAGE_KEY)).toContain('/admin/orders');
  });
});

describe('全局事件总线', () => {
  it('off 之后不再收到事件（热更新不残留订阅）', () => {
    let count = 0;
    const off = onNomiBus('openSetting', () => {
      count += 1;
    });
    emitNomiBus('openSetting');
    off();
    emitNomiBus('openSetting');
    expect(count).toBe(1);
  });
});

describe('菜单风格与页面过渡', () => {
  it('菜单风格只给亮色 / 暗色，默认亮色', () => {
    expect(MENU_THEME_CHOICES.map((item) => item.theme)).toEqual([
      MenuThemeEnum.LIGHT,
      MenuThemeEnum.DARK,
    ]);
    expect(LAYOUT_DEFAULTS.menuTheme).toBe(MenuThemeEnum.LIGHT);
  });

  it('老存储里的 design 归一化成亮色，设置面板不会出现「一个都没选中」', () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ menuTheme: 'design' }));
    const store = useLayoutStore();
    expect(store.state.menuTheme).toBe(MenuThemeEnum.LIGHT);
  });

  it('每个过渡名都有对应 CSS，且内容区真的用 Transition 驱动', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/assets/styles/layout.scss'), 'utf-8');
    for (const name of PAGE_TRANSITIONS) {
      expect(css).toContain(`.nomi-${name}`);
    }

    const page = readFileSync(
      resolve(process.cwd(), 'app/components/layout/NomiPageContent.vue'),
      'utf-8',
    );
    expect(page).toContain('<Transition :name="transitionName" mode="out-in">');
    expect(page).toContain(':key="pageKey"');
    // 过渡不再只挂在 NuxtPage 上（SPA + Suspense 下经常不触发）。
    const app = readFileSync(resolve(process.cwd(), 'app/app.vue'), 'utf-8');
    expect(app).not.toContain(':transition="pageTransition"');
  });
});

describe('移动端布局', () => {
  it('断点边界与常量一致，SSR 拿不到视口时不会误判', () => {
    expect(LAYOUT_BREAKPOINTS.MOBILE).toBe(800);
    expect(isMobileWidth(360)).toBe(true);
    expect(isMobileWidth(800)).toBe(true);
    expect(isMobileWidth(801)).toBe(false);
    expect(isMobileWidth(1280)).toBe(false);
    expect(isMobileWidth(0)).toBe(false);
    expect(isMobileWidth(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('抽屉宽度随视口增长但封顶，关闭态能完整移出屏幕', () => {
    expect(getMobileDrawerWidth(320)).toBe('262px');
    expect(getMobileDrawerWidth(390)).toBe('288px');
    expect(getMobileDrawerWidth(768)).toBe('288px');
    expect(getMobileDrawerWidth(Number.POSITIVE_INFINITY)).toBe('288px');
  });

  it('新增的移动端文案在中英文语言包里都存在', () => {
    for (const name of ['zh', 'en']) {
      const locale = JSON.parse(
        readFileSync(resolve(process.cwd(), 'i18n/locales', `${name}.json`), 'utf-8'),
      ) as Record<string, { layout?: { header?: Record<string, string>; sidebar?: Record<string, string> } }>;
      expect(typeof locale.layout?.header?.more).toBe('string');
      expect(locale.layout?.header?.more?.length).toBeGreaterThan(0);
      expect(typeof locale.layout?.sidebar?.close).toBe('string');
      expect(locale.layout?.sidebar?.close?.length).toBeGreaterThan(0);
    }
  });

  it('布局样式里保留抽屉滑出、遮罩与背景锁滚动规则', () => {
    // 这几条一旦被删，症状是「手机上左侧又出现 64px 常驻窄条」，
    // 肉眼在小屏截图里容易漏看，所以用样式快照守着。
    const css = readFileSync(resolve(process.cwd(), 'app/assets/styles/layout.scss'), 'utf-8');
    expect(css).toContain('translate3d(-100%, 0, 0)');
    expect(css).toContain('#app-sidebar.is-drawer-open');
    expect(css).toContain('.nomi-drawer-backdrop');
    expect(css).toContain('html.nomi-drawer-open');
    expect(css).toContain('100dvh');
  });
});
