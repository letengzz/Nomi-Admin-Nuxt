/**
 * 请求元信息：把一次 HTTP 请求里「审计和会话监控要用到的东西」集中解析一次。
 *
 * 三件事刻意不引第三方依赖：
 *   1. UA 解析 —— 只取「浏览器 + 版本 / 终端系统」，用有序正则足够覆盖
 *      主流浏览器；把完整 UA 也留着，细节可以在日志详情里看。
 *   2. IP 归属 —— 内网/保留段本地就能判定，且返回的是 i18n 词条键，
 *      中英文界面各自翻译；公网 IP 可通过 `IP_LOCATION_API`（用 {ip} 占位）
 *      接任意归属地服务拿真实地名，没配或查询失败则回落「公网 IP」词条，
 *      不留空白（见 resolveIpLocation）。超时可用 `IP_LOCATION_TIMEOUT` 调整
 *      （默认 2500ms，公共服务常在 700ms 以上，太短会必然降级）。
 *   3. 请求头脱敏 —— 令牌/Cookie 一律不落库，日志本身不能变成泄密源。
 */
import { randomUUID } from 'node:crypto';
import type { H3Event } from 'h3';

export interface RequestMeta {
  ip: string;
  /** i18n 词条键或真实地名；公网查不到时是 monitor.location.public，不会是空串 */
  ipLocation: string;
  browser: string;
  os: string;
  useragent: string;
  traceId: string;
}

export interface ClientDevice {
  browser: string;
  os: string;
}

const SENSITIVE_HEADER = /(authorization|cookie|batoken|ba-token|ba_token|ba-refresh-token|token|secret|api-?key)/i;
const MAX_HEADER_LENGTH = 4000;

/** 取一段版本号：'Chrome/131.0.0.0' → '131'（只保留主版本，表格列放得下）。 */
function majorVersion(source: string, pattern: RegExp): string {
  const matched = pattern.exec(source);
  return matched?.[1]?.split('.')[0] ?? '';
}

export function parseUserAgent(raw: string): ClientDevice {
  const ua = String(raw ?? '').slice(0, 500);
  if (!ua) return { browser: '', os: '' };

  // 浏览器：顺序有意义 —— Edg/OPR 都带 Chrome，必须先认出真身再回落到 Chrome。
  const browserRules: ReadonlyArray<readonly [RegExp, string, RegExp]> = [
    [/MicroMessenger\/([\d.]+)/i, '微信内置浏览器', /MicroMessenger\/([\d.]+)/i],
    [/EdgA?\/([\d.]+)/i, 'Edge', /EdgA?\/([\d.]+)/i],
    [/(?:OPR|Opera)\/([\d.]+)/i, 'Opera', /(?:OPR|Opera)\/([\d.]+)/i],
    [/SamsungBrowser\/([\d.]+)/i, '三星浏览器', /SamsungBrowser\/([\d.]+)/i],
    [/(?:Firefox|FxiOS)\/([\d.]+)/i, 'Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/i],
    [/(?:CriOS|Chrome)\/([\d.]+)/i, 'Chrome', /(?:CriOS|Chrome)\/([\d.]+)/i],
    [/Version\/([\d.]+).*Safari/i, 'Safari', /Version\/([\d.]+)/i],
    [/MSIE\s([\d.]+)|Trident\/.*rv:([\d.]+)/i, 'IE', /MSIE\s([\d.]+)|rv:([\d.]+)/i],
    [/PostmanRuntime\/([\d.]+)/i, 'Postman', /PostmanRuntime\/([\d.]+)/i],
    [/curl\/([\d.]+)/i, 'curl', /curl\/([\d.]+)/i],
  ];
  let browser = '';
  for (const [detect, label, version] of browserRules) {
    if (!detect.test(ua)) continue;
    const major = majorVersion(ua, version);
    browser = major ? `${label} ${major}` : label;
    break;
  }
  if (!browser && /Electron/i.test(ua)) browser = 'Electron';
  if (!browser && /bot|spider|crawler/i.test(ua)) browser = '爬虫';
  if (!browser) browser = ua.split(' ')[0] || '未知';

  // 终端系统：iOS 要在 Android / Mac 之前判，UA 里 iPhone 也带 'Mac OS X'。
  let os: string;
  if (/Windows NT 10\.0/i.test(ua)) os = /Windows NT 10\.0.*(?:Win64|x64)/i.test(ua) ? 'Windows 10/11' : 'Windows 10';
  else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.2/i.test(ua)) os = 'Windows 8';
  else if (/Windows NT 6\.1/i.test(ua)) os = 'Windows 7';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/HarmonyOS|HuaweiBrowser/i.test(ua)) os = 'HarmonyOS';
  else if (/Android\s?([\d.]+)/i.test(ua)) {
    const version = majorVersion(ua, /Android\s?([\d.]+)/i);
    os = version ? `Android ${version}` : 'Android';
  } else if (/(?:iPhone|iPad|iPod).*?OS\s([\d_]+)/i.test(ua)) {
    os = `iOS ${majorVersion(ua, /(?:iPhone|iPad|iPod).*?OS\s([\d_]+)/i).replaceAll('_', '.')}`;
  } else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  else os = '未知';

  return { browser: browser.slice(0, 60), os: os.slice(0, 60) };
}

/** IPv4-mapped IPv6（::ffff:127.0.0.1）还原成 IPv4，否则内网判定会失效。 */
export function normalizeIp(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^::ffff:/i, '')
    .replace(/^\[|\]$/g, '');
}

/** 内网/保留段 → i18n 词条键；公网返回 ''（交给可选归属地服务）。 */
export function localIpLabel(raw: string): string {
  const ip = normalizeIp(raw);
  if (!ip) return '';
  if (ip === '::1' || ip === '127.0.0.1' || /^127\./.test(ip) || ip === 'localhost') {
    return 'monitor.location.loopback';
  }
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    return 'monitor.location.lan';
  }
  if (/^169\.254\./.test(ip) || /^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)) {
    return 'monitor.location.linkLocal';
  }
  if (/^192\.0\.2\./.test(ip) || /^198\.51\.100\./.test(ip) || /^203\.0\.113\./.test(ip)) {
    return 'monitor.location.reserved';
  }
  return '';
}

/**
 * 从归属地服务返回体里挖地名。
 *
 * 字段名各家不一：ip-api.com 的省名在 `regionName`（`region` 只是 "IDF" 这类缩写），
 * ipwho.is / ipinfo.io 用 `region`，国内服务多用 `province`。按
 * province → regionName → region_name → region 的优先级取，避免显示「法国 IDF 巴黎」。
 * 同时兼容 `{ data: {...} }` 嵌套。
 */
function pickLocation(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim().slice(0, 120);
  if (!raw || typeof raw !== 'object') return '';
  const source = raw as Record<string, unknown>;
  const nested = source.data && typeof source.data === 'object' ? (source.data as Record<string, unknown>) : source;
  const region = nested.province ?? nested.regionName ?? nested.region_name ?? nested.region;
  const parts = [nested.country, region, nested.city, nested.district]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  return [...new Set(parts)].join(' ').slice(0, 120);
}

/** 默认超时 2500ms：ip-api.com 等免费服务实测要 700ms+，原来的 600ms 必然超时。可用 IP_LOCATION_TIMEOUT 覆盖。 */
const DEFAULT_LOCATION_TIMEOUT_MS = 2500;
/** 进程内缓存上限：只缓存查到的真实地名，防止同一批 IP 反复打外部服务。超量直接清空，实现简单且归属地本就低频。 */
const LOCATION_CACHE_LIMIT = 2000;
const locationCache = new Map<string, string>();

function locationTimeoutMs(): number {
  const configured = Number(process.env.IP_LOCATION_TIMEOUT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LOCATION_TIMEOUT_MS;
}

/** 仅测试用：清空归属地缓存，避免用例之间互相污染。 */
export function clearIpLocationCache(): void {
  locationCache.clear();
}

/**
 * 解析 IP 归属：一律返回可直接展示的内容 —— i18n 词条键（内网/无归属地服务）
 * 或真实地名（配了 `IP_LOCATION_API` 且查询成功）。
 *
 * 内网/本地立刻返回词条键，不产生网络请求；公网在没配服务、服务报错或返回空时，
 * 回落到 `monitor.location.public`（界面显示「公网 IP」），不再留空 —— 审计列里
 * 一个「—」既不能定位也容易被误读成「没记录」，明确标「公网 IP」至少说明来源类型。
 *
 * 失败不写缓存：服务临时不可用时降级，恢复后下一次登录能自动查到真实地名。
 */
export async function resolveIpLocation(raw: string): Promise<string> {
  const local = localIpLabel(raw);
  if (local) return local;
  const ip = normalizeIp(raw);
  const endpoint = process.env.IP_LOCATION_API;
  if (!ip || !endpoint) return 'monitor.location.public';

  const cached = locationCache.get(ip);
  if (cached) return cached;

  try {
    const response = await fetch(endpoint.replace('{ip}', encodeURIComponent(ip)), {
      signal: AbortSignal.timeout(locationTimeoutMs()),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn(`[ip-location] 查询失败 IP=${ip} HTTP ${response.status}`);
      return 'monitor.location.public';
    }
    const place = pickLocation(await response.json());
    if (!place) {
      console.warn(`[ip-location] 返回空地名 IP=${ip}`);
      return 'monitor.location.public';
    }
    if (locationCache.size >= LOCATION_CACHE_LIMIT) locationCache.clear();
    locationCache.set(ip, place);
    return place;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[ip-location] 查询异常 IP=${ip}：${reason}`);
    return 'monitor.location.public';
  }
}

/** 请求 IP：优先代理头，其次 socket。与会话、审计三处共用同一取值口径。 */
export function requestIp(event: H3Event): string {
  const forwarded = event.node.req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0]!.trim();
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].split(',')[0]!.trim();
  return event.node.req.socket.remoteAddress ?? '';
}

export function newTraceId(): string {
  return randomUUID();
}

/** 请求头 → 脱敏后的 JSON 字符串。令牌类字段换成 ******，其余截断防撑爆 text 列。 */
export function stringifyHeaders(headers: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    safe[key] = SENSITIVE_HEADER.test(key) ? '******' : truncate(String(value), 300);
  }
  try {
    return truncate(JSON.stringify(safe), MAX_HEADER_LENGTH);
  } catch {
    return '';
  }
}

export function requestHeadersForLog(event: H3Event): string {
  return stringifyHeaders(event.node.req.headers as Record<string, unknown>);
}

/** 响应头取 Node 原生 getHeaders()：不依赖 h3 版本，也拿得到刚 setResponseHeader 的 trace-id。 */
export function responseHeadersForLog(event: H3Event): string {
  return stringifyHeaders(event.node.res.getHeaders() as Record<string, unknown>);
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 从接口路径推「所属模块」，返回 i18n 词条键。
 * 日志里存 key 而不是中文，切换语言时旧日志也能跟着翻译。
 */
const MODULE_BY_SEGMENT: Readonly<Record<string, string>> = {
  users: 'monitor.module.user',
  departments: 'monitor.module.department',
  roles: 'monitor.module.role',
  rules: 'monitor.module.rule',
  languages: 'monitor.module.language',
  logs: 'monitor.module.log',
  monitor: 'monitor.module.monitor',
  settings: 'monitor.module.settings',
  login: 'monitor.module.auth',
  logout: 'monitor.module.auth',
  'refresh-token': 'monitor.module.auth',
  init: 'monitor.module.auth',
  profile: 'monitor.module.profile',
  orders: 'monitor.module.business',
};

export function moduleFromPath(url: string): string {
  const segments = String(url ?? '').replace(/^\/api\//, '').split('/');
  return MODULE_BY_SEGMENT[segments[1] ?? ''] ?? 'monitor.module.other';
}

/** 一次请求解析一次，审计日志与登录日志都用它，避免两处 UA/IP 口径不一致。 */
export async function collectRequestMeta(event: H3Event, traceId = newTraceId()): Promise<RequestMeta> {
  const useragent = String(event.node.req.headers['user-agent'] ?? '');
  const { browser, os } = parseUserAgent(useragent);
  const ip = requestIp(event);
  const ipLocation = await resolveIpLocation(ip);
  return { ip, ipLocation, browser, os, useragent, traceId };
}
