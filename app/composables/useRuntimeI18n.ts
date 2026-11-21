/**
 * 运行期语言管理（前端侧）。
 *
 * 三件事，全部以「语言管理」里的数据库数据为准，静态 zh/en.json 只做兜底：
 *
 *   ① 清单：`/api/i18n/locales` 返回**启用**的语言，右上角切换器直接用它渲染。
 *      后台启用/停用/新增/删除语言后，事件一响这里就重新拉，两处不会各说一套。
 *   ② 译文：`/api/i18n/messages` 返回所有启用语言的非空译文，用「静态快照 + 译文」
 *      整体重建消息树（不是叠加 merge）。这样才能支持「把某条译文清空 → 回退到
 *      内置文案」，否则清空只会让页面保留上一次的旧值。
 *   ③ 切换：数据库里新增的语言（比如 `ja`）没有在 nuxt.config.ts 的 locales 里
 *      声明，@nuxtjs/i18n 的 setLocale 会直接忽略它。这里绕过路由前缀那一层，
 *      直接设置 composer 的 locale；有 URL 前缀的语言仍会顺带把地址栏切过去。
 */
import { computed, isRef, toValue, type Ref } from 'vue';
import { mergeMessages, resolvePreferredLocale } from '#shared/utils/i18n';
import { callApi } from '../utils/api';

/** 与 nuxt.config.ts 的 i18n.defaultLocale 一致；接口读不到时的最后兜底。 */
const DEFAULT_RUNTIME_LOCALE = 'zh';

export interface RuntimeLocale {
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
  isDefault: boolean;
}

interface LocalesPayload {
  defaultLocale: string;
  locales: RuntimeLocale[];
}

interface MessagesPayload {
  messages: Record<string, Record<string, unknown>>;
}

/**
 * 接口拿不到时的兜底清单。
 *
 * 只用于「数据库没就绪 / 网络抖动」这一小段时间，不参与任何持久化 ——
 * 真正的语言清单永远以接口返回为准，否则又会变成第二处配置。
 */
export const FALLBACK_LOCALES: readonly RuntimeLocale[] = [
  { code: 'zh', name: '简体中文', nativeName: '简体中文', weigh: 100, isDefault: true },
  { code: 'en', name: 'English', nativeName: 'English', weigh: 90, isDefault: false },
];

/** 只声明这里真正用到的成员，避免和 vue-i18n / @nuxtjs/i18n 的泛型签名打架。 */
export interface RuntimeI18nLike {
  locale: string | Ref<string>;
  /** 两个列表在不同版本里可能是数组、ref 或 computed，统一用 readArray 读。 */
  availableLocales?: string[] | Ref<string[]>;
  localeCodes?: readonly string[] | Ref<readonly string[]>;
  defaultLocale?: string | Ref<string>;
  getLocaleMessage: (code: string) => Record<string, unknown>;
  setLocaleMessage: (code: string, message: Record<string, unknown>) => void;
}

/** ref / computed / 普通值都能读成数组，读不出来就当空数组。 */
function readArray(value: unknown): string[] {
  const resolved = toValue(value as never);
  return Array.isArray(resolved) ? ([...resolved] as string[]) : [];
}

/** 同上，读字符串。 */
function readText(value: unknown, fallback: string): string {
  const resolved = toValue(value as never);
  return typeof resolved === 'string' && resolved ? resolved : fallback;
}

/** 默认语言的唯一读取口：切换器与插件都要用，别各写一次 `?? 'zh'`。 */
export function runtimeDefaultLocale(i18n: RuntimeI18nLike): string {
  return readText(i18n.defaultLocale, DEFAULT_RUNTIME_LOCALE);
}

/**
 * 静态语言文件的快照（客户端单例）。
 *
 * 必须在第一次写库里的译文**之前**取，之后每次刷新都从它重建；
 * 一旦为空就说明这次运行还没建立快照，顺手建立。
 */
let baseMessages: Record<string, Record<string, unknown>> | null = null;

function cloneMessages(message: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(message ?? {})) as Record<string, unknown>;
}

function localeState(): Ref<RuntimeLocale[]> {
  return useState<RuntimeLocale[]>('nomi:runtime-locales', () => []);
}

/** 拉取启用语言清单。失败时保留上一次的值，不清空 —— 清空会让切换器突然消失。 */
export async function loadRuntimeLocales(): Promise<RuntimeLocale[]> {
  const state = localeState();
  try {
    const res = await callApi<LocalesPayload>('/api/i18n/locales');
    if (res.code === 200 && res.data?.locales?.length) {
      state.value = res.data.locales;
      return state.value;
    }
  } catch {
    // 接口不通：沿用旧清单（或下面的兜底），页面照常渲染。
  }
  return state.value;
}

/** 把 composer 的语言切到 `code`；它是 ref 还是普通值是 vue-i18n 版本差异。 */
export function setRuntimeLocale(i18n: RuntimeI18nLike, code: string): void {
  if (!code) return;
  if (isRef(i18n.locale)) {
    if (i18n.locale.value !== code) i18n.locale.value = code;
    return;
  }
  if (i18n.locale !== code) i18n.locale = code;
}

/**
 * 缺译文回退到默认语言。
 *
 * vue-i18n 的 `fallbackLocale` 默认是 false，@nuxtjs/i18n 也不替我们设：
 * 「语言管理」里新增的语言一开始必然只有零星几条译文，没有这条回退，
 * 整个界面印的都是 `auth.language.title` 这种裸键。
 *
 * 这里不放 nuxt.config，是因为默认语言本身就是语言管理里的数据 —— 放在运行时，
 * 后台改了默认语言不用重新构建前端。
 */
export function applyRuntimeFallback(
  i18n: RuntimeI18nLike,
  languages: readonly RuntimeLocale[],
): void {
  const fallback = languages.find((item) => item.isDefault)?.code ?? runtimeDefaultLocale(i18n);
  const target = i18n as unknown as { fallbackLocale?: unknown };
  if (isRef(target.fallbackLocale)) {
    if (target.fallbackLocale.value !== fallback) target.fallbackLocale.value = fallback;
    return;
  }
  target.fallbackLocale = fallback;
}

/**
 * 拉译文并重建消息树。
 *
 * 先确保语言清单是最新的：停用的语言不该再被注册（否则切过去会读到过期译文）。
 */
export async function applyRuntimeMessages(i18n: RuntimeI18nLike): Promise<void> {
  const locales = await loadRuntimeLocales();
  applyRuntimeFallback(i18n, locales);

  let payload: MessagesPayload | undefined;
  try {
    const res = await callApi<MessagesPayload>('/api/i18n/messages');
    if (res.code === 200) payload = res.data;
  } catch {
    return;
  }
  if (!payload) return;

  const codes = new Set<string>([
    ...locales.map((item) => item.code),
    ...Object.keys(payload.messages ?? {}),
  ]);

  if (!baseMessages) {
    baseMessages = {};
    const available = readArray(i18n.availableLocales);
    for (const code of new Set([...codes, ...available])) {
      baseMessages[code] = cloneMessages(i18n.getLocaleMessage(code));
    }
  }

  for (const code of codes) {
    const base = baseMessages[code] ?? (baseMessages[code] = {});
    i18n.setLocaleMessage(code, mergeMessages(base, payload.messages?.[code] ?? {}));
  }
}

/**
 * 按用户偏好修正当前语言。
 *
 * 返回三种结果，调用方据此决定要不要改用户偏好：
 *   · `applied`  —— 已切到该语言；
 *   · `fallback` —— 偏好语言已经不在启用清单里（被停用/删除），需要回落到默认语言；
 *   · `skipped`  —— 清单还没拿到 / 偏好就是默认语言，交给 URL 判定即可。
 *
 * 默认语言不强制：它没有 URL 前缀，@nuxtjs/i18n 自己会选中；
 * 硬设反而会把 `/en/admin` 这种地址在第一帧之后打回中文。
 */
export type PreferredOutcome = 'applied' | 'fallback' | 'skipped';

export function applyPreferredLocale(
  i18n: RuntimeI18nLike,
  preferred: string,
): PreferredOutcome {
  const codes = localeState().value.map((item) => item.code);
  if (codes.length === 0) return 'skipped';
  if (!preferred || !codes.includes(preferred)) return 'fallback';
  const target = resolvePreferredLocale(preferred, codes, runtimeDefaultLocale(i18n));
  if (!target) return 'skipped';
  setRuntimeLocale(i18n, target);
  return 'applied';
}

/**
 * 组件侧入口：拿启用语言清单 + 切换语言。
 *
 * `switchLocale` 只在语言有 URL 前缀（即 nuxt.config.ts 里声明过）时才导航；
 * 数据库新增的语言没有前缀，改 composer 就够了，导航反而会 404。
 */
export function useRuntimeI18n() {
  const i18n = useI18n();
  const user = useUserStore();
  const switchLocalePath = useSwitchLocalePath();
  const router = useRouter();
  const state = localeState();

  const locales = computed(() =>
    state.value.length > 0 ? state.value : FALLBACK_LOCALES,
  );

  async function switchLocale(code: string): Promise<void> {
    if (!code || i18n.locale.value === code) return;
    user.setLanguage(code);
    setRuntimeLocale(i18n as unknown as RuntimeI18nLike, code);

    const codes = readArray((i18n as unknown as RuntimeI18nLike).localeCodes);
    if (!codes.includes(code)) return;
    const path = switchLocalePath(code as never);
    if (path && path !== router.currentRoute.value.fullPath) await navigateTo(path);
  }

  return { locales, switchLocale };
}
