/**
 * 主布局的「静态事实」：枚举、断点、菜单树、主题预设、顶栏硬开关。
 *
 * 对应 docs/主布局设计.md 第 1.6 / 17.3 / 17.4 / 17.5 节。
 * 这里全是编译期常量（运行期不可改），运行期可变的那部分在 app/stores/layout.ts。
 * 把两者分开，才能解释「为什么设置面板里的某个开关改了没反应」——
 * 那说明它是这里的硬开关，而不是 store 里的软开关。
 *
 * 命名约定：源码里的 art-* 组件在本项目统一改成 Nomi*，CSS 类与变量统一用 nomi- 前缀。
 */

// --- 枚举 ------------------------------------------------------------------
export const MenuTypeEnum = {
  LEFT: 'left',
  TOP: 'top',
  TOP_LEFT: 'top-left',
  DUAL_MENU: 'dual-menu',
} as const;
export type MenuType = (typeof MenuTypeEnum)[keyof typeof MenuTypeEnum];

export const MenuThemeEnum = {
  DESIGN: 'design',
  LIGHT: 'light',
  DARK: 'dark',
} as const;
export type MenuTheme = (typeof MenuThemeEnum)[keyof typeof MenuThemeEnum];

export const ContainerWidthEnum = {
  FULL: '100%',
  BOXED: '1200px',
} as const;
export type ContainerWidth = (typeof ContainerWidthEnum)[keyof typeof ContainerWidthEnum];

export const TabStyleEnum = {
  DEFAULT: 'tab-default',
  CARD: 'tab-card',
  GOOGLE: 'tab-google',
} as const;
export type TabStyle = (typeof TabStyleEnum)[keyof typeof TabStyleEnum];

// --- 断点（第 20.1 节的统一常量，JS 与 SCSS 各写一处但数字必须一致）----------
export const LAYOUT_BREAKPOINTS = {
  /** ≤1180px：主区从 100vh 换成 100dvh，规避移动端浏览器地址栏 */
  DVH: 1180,
  /** <1000px：布局模式强制降级为左侧菜单 */
  TABLET: 1000,
  /** ≤800px：侧栏脱离文档流，改 fixed 抽屉 */
  MOBILE: 800,
  /** ≤640px：内容区留白收紧 */
  SMALL: 640,
} as const;

export const MENU_CLOSE_WIDTH = 64;
export const DEFAULT_MENU_OPEN_WIDTH = 230;
/** ≤800px 抽屉宽度：视口的 82%，但不超过这个值，避免平板上过宽。 */
export const MOBILE_DRAWER_WIDTH_RATIO = 0.82;
export const MOBILE_DRAWER_MAX_WIDTH = 288;
export const HEADER_HEIGHT = 60;
export const FAST_ENTER_MIN_WIDTH = 1200;

/** 页面过渡名，与 layout.scss 里生成的 .nomi-{name}-* 类一一对应。 */
export const PAGE_TRANSITIONS = ['fade', 'slide-left', 'slide-right', 'slide-top', 'slide-bottom'] as const;
export type PageTransition = (typeof PAGE_TRANSITIONS)[number];

// --- 系统信息 --------------------------------------------------------------
// 品牌名不在这里：它是「系统配置 → 网站配置」的 site.name，
// 侧栏标题、顶栏品牌、浏览器标签页、水印、授权页都读那一份。
export const HOME_PATH = '/admin';

// --- 菜单树 ----------------------------------------------------------------
export interface NomiMenuItem {
  /** 站内绝对路径；目录项用 `#group-*` 占位，不参与导航 */
  path: string;
  /** 显示名称：写 i18n 词条键（如 `layout.menu.users`）按当前语言显示，写自然文案则原样显示 */
  title: string;
  /** NomiIcon 的图标名 */
  icon: string;
  children?: NomiMenuItem[];
  /** 菜单右侧小红点 */
  showBadge?: boolean;
  /** 工作标签栏里固定不可关闭 */
  fixedTab?: boolean;
  /** 导航时高亮另一个菜单（详情页常用） */
  activePath?: string;
}

export const MENU_LIST: readonly NomiMenuItem[] = [
  { path: HOME_PATH, title: 'layout.menu.dashboard', icon: 'dashboard', fixedTab: true },
  { path: '/admin/analytics', title: 'layout.menu.analytics', icon: 'chart' },
  {
    path: '#group-business',
    title: 'layout.menu.business',
    icon: 'grid',
    children: [
      { path: '/admin/orders', title: 'layout.menu.orders', icon: 'orders', showBadge: true },
      {
        path: '/admin/orders/detail',
        title: 'layout.menu.orderDetail',
        icon: 'file',
        activePath: '/admin/orders',
      },
    ],
  },
  {
    path: '#group-system',
    title: 'layout.menu.system',
    icon: 'settings',
    // 顺序与服务端 permission_rule.weigh 保持一致（用户 → 部门 → 角色 → 节点 → 设置）：
    // 这份静态表只在「还没拿到动态菜单」时兜底，两者不一致会让人以为菜单会自己抖动。
    children: [
      { path: '/admin/system/users', title: 'layout.menu.users', icon: 'users' },
      { path: '/admin/system/notices', title: 'layout.menu.notices', icon: 'notice' },
      { path: '/admin/system/departments', title: 'layout.menu.departments', icon: 'department' },
      { path: '/admin/system/roles', title: 'layout.menu.roles', icon: 'role' },
      { path: '/admin/system/rules', title: 'layout.menu.rules', icon: 'menu' },
      { path: '/admin/system/languages', title: 'layout.menu.languages', icon: 'language' },
      { path: '/admin/system/settings', title: 'layout.menu.systemSettings', icon: 'sliders' },
    ],
  },
  {
    path: '#group-monitor',
    title: 'layout.menu.monitor',
    icon: 'monitor',
    children: [
      { path: '/admin/monitor/online', title: 'layout.menu.onlineUsers', icon: 'monitor' },
      { path: '/admin/monitor/logs', title: 'layout.menu.systemLogs', icon: 'file' },
    ],
  },
  // 个人中心**刻意不在菜单里**：它是「我是谁」的页面，入口只在右上角用户下拉框
  // （NomiUserMenu）。放进菜单会和「系统管理」并列成一个业务模块，但它不属于
  // 任何模块；详见下方的 HIDDEN_MENU_LIST。
];

/**
 * 有页面、但没有菜单入口的「工具页」。
 *
 * 为什么单列一张表而不是从菜单树里删干净：面包屑、工作标签、浏览器标题都要
 * 按路径查标题（`menu.findMenu`）。删干净了，`/admin/profile` 打开的标签会没有
 * 名字、面包屑只剩一个首页图标 —— 看上去像路由没注册。
 *
 * 所以约定是：
 *   · MENU_LIST        → 侧栏 / 水平菜单 / 全局搜索 / 快速入口渲染用的可见菜单；
 *   · HIDDEN_MENU_LIST → 只参与「查标题」，不参与任何菜单渲染。
 * 服务端 buildMenuTree 也按同一份路径清单过滤（server/utils/auth/rbac.ts），
 * 否则接口下发的菜单里又会冒出一个「个人中心」。
 */
export const HIDDEN_MENU_LIST: readonly NomiMenuItem[] = [
  { path: '/admin/profile', title: 'layout.menu.profile', icon: 'user' },
];

/** 菜单扁平表：面包屑、标签栏、全局搜索都从这里查，避免各自递归一遍。 */
export interface FlatMenuItem {
  path: string;
  title: string;
  icon: string;
  parent?: string;
  fixedTab?: boolean;
  activePath?: string;
}

/**
 * 菜单树 → 扁平表。抽成函数而不是写死在 FLAT_MENU 里，是因为运行期的菜单
 * 由 app/stores/menu.ts 持有（登录后可能被接口返回的菜单替换），扁平表必须
 * 跟着那份数据重新推导，否则面包屑、标签页、搜索会各留一份旧菜单。
 */
export function flattenMenus(list: readonly NomiMenuItem[]): FlatMenuItem[] {
  return list.flatMap((menu) => {
    if (!menu.children?.length) {
      return [
        {
          path: menu.path,
          title: menu.title,
          icon: menu.icon,
          fixedTab: menu.fixedTab,
          activePath: menu.activePath,
        },
      ];
    }
    const parent = menu.title;
    return menu.children.map((child) => ({
      path: child.path,
      title: child.title,
      icon: child.icon,
      parent,
      fixedTab: child.fixedTab,
      activePath: child.activePath,
    }));
  });
}

/** 默认（静态）菜单的扁平表：SSR 首屏与未接入动态菜单时使用。 */
export const FLAT_MENU: readonly FlatMenuItem[] = flattenMenus(MENU_LIST);

/** 隐藏页的扁平表：只给「按路径查标题」用，不进任何菜单渲染。 */
export const HIDDEN_MENU: readonly FlatMenuItem[] = flattenMenus(HIDDEN_MENU_LIST);

export function findMenuByPath(path: string): FlatMenuItem | undefined {
  return FLAT_MENU.find((item) => item.path === path);
}

/** 一级菜单（水平菜单 / 混合菜单 / 双栏图标列用）。 */
export const FIRST_LEVEL_MENUS: readonly NomiMenuItem[] = MENU_LIST;

// --- 菜单主题预设（第 17.4 节 config/index.ts themeList 的等价物）------------
export interface MenuThemePreset {
  theme: MenuTheme;
  label: string;
  background: string;
  textColor: string;
  activeTextColor: string;
  hoverBackground: string;
  systemNameColor: string;
  borderColor: string;
}

export const MENU_THEME_PRESETS: readonly MenuThemePreset[] = [
  {
    theme: MenuThemeEnum.DESIGN,
    label: 'layout.setting.menuTheme.design',
    background: 'var(--nomi-sidebar-bg)',
    textColor: 'var(--nomi-sidebar-text)',
    activeTextColor: 'var(--el-color-primary)',
    hoverBackground: 'var(--nomi-hover)',
    systemNameColor: 'var(--fg)',
    borderColor: 'var(--border)',
  },
  {
    theme: MenuThemeEnum.LIGHT,
    label: 'layout.setting.menuTheme.light',
    // 走 --nomi-menu-* 变量而不是写死 #ffffff：暗色界面里白侧栏会成为整屏最亮的
    // 一块（比内容区还抢眼）。变量在 layout.scss 里按明暗两套取值，预设本身不变。
    background: 'var(--nomi-menu-bg)',
    textColor: 'var(--nomi-menu-text)',
    activeTextColor: 'var(--el-color-primary)',
    hoverBackground: 'color-mix(in srgb, var(--el-color-primary) 8%, var(--nomi-menu-bg))',
    systemNameColor: 'var(--nomi-menu-name)',
    borderColor: 'var(--nomi-border)',
  },
  {
    theme: MenuThemeEnum.DARK,
    label: 'layout.setting.menuTheme.dark',
    background: '#191a23',
    textColor: '#babbc1',
    activeTextColor: '#ffffff',
    hoverBackground: '#252631',
    systemNameColor: '#ffffff',
    borderColor: '#2a2b36',
  },
];

/**
 * 设置面板「菜单风格」只给亮色 / 暗色两种。
 *
 * DESIGN 还留在 MENU_THEME_PRESETS 里，只为兼容老用户 localStorage 里的
 * 'design' 值（store 会归一化成 light）；它跟随系统主题变量，和明确的
 * 「亮/暗」放一起会让人分不清自己选的到底是哪一个，所以不进可选项。
 */
export const MENU_THEME_CHOICES: readonly MenuThemePreset[] = MENU_THEME_PRESETS.filter(
  (item) => item.theme === MenuThemeEnum.LIGHT || item.theme === MenuThemeEnum.DARK,
);

export function getMenuThemePreset(theme: MenuTheme): MenuThemePreset {
  return MENU_THEME_PRESETS.find((item) => item.theme === theme) ?? MENU_THEME_PRESETS[0]!;
}

// --- 顶栏硬开关（第 1.10 / 17.5 节）---------------------------------------
/**
 * enabled 只能改代码。设置面板会按这份配置过滤掉软开关，
 * 杜绝「面板里有开关但改了没反应」的死开关。
 */
export const HEADER_BAR_CONFIG = {
  menuButton: { enabled: true },
  refreshButton: { enabled: true },
  fastEnter: { enabled: true },
  breadcrumb: { enabled: true },
  globalSearch: { enabled: true },
  fullscreen: { enabled: true },
  notification: { enabled: true },
  // 演示「硬开关」：本项目不提供独立聊天窗口，关掉后设置面板会自动过滤掉这个开关，
  // 避免出现「面板里有开关、改了没反应」的死开关（第 1.10 节双向一致性）。
  chat: { enabled: false },
  language: { enabled: true },
  settings: { enabled: true },
  themeToggle: { enabled: true },
} as const;

export type HeaderBarFeature = keyof typeof HEADER_BAR_CONFIG;
