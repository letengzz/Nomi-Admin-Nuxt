/**
 * 用户 store —— docs/状态管理.md 第 3 章（user.ts，236 行）。
 *
 * 管的四类东西：凭证（token）、身份（info）、语言偏好、搜索历史。
 *
 * 与文档的三处刻意偏离：
 *
 * ① **不存 isLogin**。文档里 isLogin 是独立 ref，与 accessToken 是两个事实来源，
 *    总有一个先更新的窗口期会出现「有 token 但显示未登录」。这里直接由 token
 *    推导（computed），不可能不一致。
 * ② **不做锁屏（isLock / lockPassword）**。模板里没有锁屏页，存一个永远为 false
 *    的开关 + 一个明文密码字段，是纯粹的风险而不是能力。要加锁屏时请改成
 *    服务端会话校验，密码不该落在 localStorage 里。
 * ③ **store 不导航**。logOut() 只清理状态并返回应该跳转的路径，由调用的组件执行
 *    navigateTo —— 这样 store 在纯 vitest 里可测，也不绑死 Nuxt 自动导入
 *    （tests/layout-store.spec.ts 就是这么跑的）。
 *
 * 登出清理与「换用户」判断是这一层最容易出错的地方，见下方 logOut /
 * checkAndClearWorktabs 的注释。
 */
import { computed } from 'vue';
import { defineStore } from 'pinia';
import { usePersistedState } from '../composables/usePersistedState';
import { canUseStorage, storageKey, takeLegacyValue } from '../utils/storage-key';
import { useMenuStore } from './menu';
import { useWorktabStore } from './worktab';

/** 登录页路径。放在 store 里作为 logOut 的返回值，组件不必各自写死字符串。 */
export const LOGIN_PATH = '/login';

/** 上一个登录用户的标识：用来判断「换人了」，见 checkAndClearWorktabs。 */
export const LAST_USER_ID_KEY = 'nomi:last-user-id';

/** 搜索历史的条数上限。够用就好，无限增长只会让 localStorage 里堆垃圾。 */
export const SEARCH_HISTORY_LIMIT = 8;

export interface NomiUserInfo {
  userId: string;
  userName: string;
  avatar: string;
  roles: string[];
}

export interface UserState {
  accessToken: string;
  refreshToken: string;
  language: string;
  info: NomiUserInfo;
  /** 全局搜索里点开过的菜单路径，最近的在前 */
  searchHistory: string[];
}

export const USER_DEFAULTS: UserState = {
  accessToken: '',
  refreshToken: '',
  language: 'zh',
  info: { userId: '', userName: '', avatar: '', roles: [] },
  searchHistory: [],
};

/**
 * 每次都要一份新的默认值。直接展开 USER_DEFAULTS 会让多个状态共享同一个
 * `info` 对象 —— 一旦有代码就地改了 info，默认值本身就被污染，
 * 下一个 store 实例（或下一次测试）会从一个被改过的基线开始。
 */
function freshUserState(
  language: string = USER_DEFAULTS.language,
  searchHistory: string[] = [],
): UserState {
  return {
    accessToken: '',
    refreshToken: '',
    language,
    info: { ...USER_DEFAULTS.info, roles: [] },
    searchHistory: [...searchHistory],
  };
}

export const USER_STORAGE_KEY = storageKey('user');

/**
 * 嵌套对象要深合并。useStorage 默认的浅合并会让老存储里的 info 整个替换掉
 * 默认值 —— 新版本给 info 加了字段，老用户那里就是 undefined。
 */
function mergeUserState(stored: UserState, defaults: UserState): UserState {
  return {
    ...defaults,
    ...stored,
    info: { ...defaults.info, ...stored.info },
    searchHistory: Array.isArray(stored.searchHistory) ? stored.searchHistory : defaults.searchHistory,
  };
}

/**
 * 老版本的登录态分散在三个键里（nomi:access-token / nomi:refresh-token /
 * nomi:language），拼不成一个对象，只能逐个取出后重新组装。
 * 读一次就删，所以这段只会在升级后的第一次启动时产生值。
 */
function legacyUserDefaults(): UserState {
  const state = freshUserState();
  if (!canUseStorage()) return state;
  return {
    ...state,
    accessToken: takeLegacyValue<string>('access-token') ?? '',
    refreshToken: takeLegacyValue<string>('refresh-token') ?? '',
    language: takeLegacyValue<string>('language') ?? state.language,
  };
}

export const useUserStore = defineStore('user', () => {
  const state = usePersistedState<UserState>('user', legacyUserDefaults(), {
    merge: mergeUserState,
  });

  /** 登录态由 token 推导，不做第二个事实来源。 */
  const isLogin = computed(() => state.value.accessToken.length > 0);
  const accessToken = computed(() => state.value.accessToken);
  const refreshToken = computed(() => state.value.refreshToken);
  const language = computed(() => state.value.language);
  const info = computed(() => state.value.info);
  const getUserInfo = computed(() => state.value.info);
  const searchHistory = computed(() => state.value.searchHistory);
  /** userId 缺失时退化为 userName，只用于「是不是同一个人」的比较。 */
  const identity = computed(() => state.value.info.userId || state.value.info.userName);

  function patch(partial: Partial<UserState>): void {
    state.value = { ...state.value, ...partial };
  }

  function setToken(token: string, newRefreshToken?: string): void {
    patch({
      accessToken: token,
      ...(newRefreshToken ? { refreshToken: newRefreshToken } : {}),
    });
  }

  function setUserInfo(partial: Partial<NomiUserInfo>): void {
    patch({ info: { ...state.value.info, ...partial } });
  }

  function setLanguage(lang: string): void {
    patch({ language: lang });
  }

  /**
   * 登录成功后的唯一写入口：凭证 + 身份一次写完，再处理「换用户」。
   *
   * 分成 setToken / setUserInfo 两步也可以，但那样两个调用点之间会短暂存在
   * 「有 token 没有身份」的中间态，任何 watch 都可能读到它。
   */
  function login(payload: {
    token: string;
    refreshToken?: string;
    info?: Partial<NomiUserInfo>;
  }): void {
    patch({
      accessToken: payload.token,
      // 不记住密码时服务端返回空 refresh token：这里必须显式清空，
      // 否则同一个人重新登录会沿用上一次的续期凭据，「不记住」就白取消了。
      refreshToken: payload.refreshToken ?? '',
      info: { ...state.value.info, ...payload.info },
    });
    checkAndClearWorktabs();
  }

  function addSearchHistory(path: string): void {
    if (!path) return;
    const next = [path, ...state.value.searchHistory.filter((item) => item !== path)];
    patch({ searchHistory: next.slice(0, SEARCH_HISTORY_LIMIT) });
  }

  function clearSearchHistory(): void {
    patch({ searchHistory: [] });
  }

  /**
   * 换用户登录时清空标签栏（文档 3.4）。
   *
   * 判断依据是上一次登出时记下的 userId：
   *   · 没有记录 → 首次登录，保留标签（用户可能只是清过一次缓存）；
   *   · 与当前用户相同 → 同一个人的重新登录，保留他之前的标签；
   *   · 不同 → 清空，否则新用户会看到上一个身份打开过的页面标题。
   *
   * 记完即删：这个键只在「登出 → 登录」这一跳里有意义，留着只会让下一次
   * 冷启动误判。
   */
  function checkAndClearWorktabs(): void {
    if (!canUseStorage()) return;
    const lastUserId = window.localStorage.getItem(LAST_USER_ID_KEY);
    window.localStorage.removeItem(LAST_USER_ID_KEY);
    if (!lastUserId) return;
    const current = identity.value;
    if (!current) return;
    if (current !== lastUserId) useWorktabStore().reset();
  }

  /**
   * 登出：清理所有「别人不该看到」的状态，返回应当跳转的路径。
   *
   * 清理顺序有意义：先把身份写进 LAST_USER_ID_KEY，再清 state —— 反过来就
   * 取不到 userId，下次登录会被当成「首次登录」而保留上一个人的标签页。
   *
   * 保留项：语言、搜索历史、布局与主题偏好。它们是「这台机器的偏好」，
   * 不是「这个身份的数据」，换账号也不该重置。
   */
  function logOut(): string {
    if (canUseStorage()) {
      const current = identity.value;
      if (current) window.localStorage.setItem(LAST_USER_ID_KEY, current);
      else window.localStorage.removeItem(LAST_USER_ID_KEY);
    }

    state.value = freshUserState(state.value.language, state.value.searchHistory);

    const menu = useMenuStore();
    menu.setHomePath('');
    menu.removeAllDynamicRoutes();

    return LOGIN_PATH;
  }

  return {
    state,
    isLogin,
    accessToken,
    refreshToken,
    language,
    info,
    getUserInfo,
    searchHistory,
    identity,
    setToken,
    setUserInfo,
    setLanguage,
    login,
    addSearchHistory,
    clearSearchHistory,
    checkAndClearWorktabs,
    logOut,
  };
});
