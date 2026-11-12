/**
 * 首帧主题引导脚本。
 *
 * 为什么需要它：主题偏好存在 localStorage，而 SSR 拿不到 localStorage。
 * 如果等应用水合后再读，暗色用户会先看到一帧白底 —— 这就是「主题闪烁」。
 * 把这段脚本内联进 <head>，浏览器解析到它时 <html> 已存在、body 还没渲染，
 * 于是第一帧就是正确的主题。
 *
 * 它与 app/utils/theme.ts 的 buildPrimaryVars 是同一套色阶算法的两份实现：
 * 一份给浏览器启动期用（无法 import 打包后的模块），一份给运行时用。
 * 两者一致性由 test/theme-bootstrap.spec.ts 守住 —— 改了一边另一边会红。
 *
 * 注意：本文件属于 shared/，不能引用 Vue / Nuxt / DOM 类型，保持运行时无关。
 */

/** 主题偏好的 localStorage 键。store 与内联脚本共用，避免字符串各写一遍。 */
export const THEME_STORAGE_KEYS = {
  mode: 'nomi:color-mode',
  color: 'nomi:theme-color',
} as const;

/** 与 app/utils/theme.ts 的 THEME_COLORS[0] 对齐；无存储值时用它兜底，避免首帧闪默认蓝。 */
export const DEFAULT_THEME_COLOR = '#5D87FF';

/**
 * 写进 <head> 的内联脚本。
 *
 * 用数组 join 而不是一整行压缩字符串：这段代码会在查看源代码时被人看到，
 * 可读性比省下几个字节重要。整个脚本约 700 字节，且随 HTML 一起 gzip。
 *
 * 全部包在 try/catch 里：隐私模式 / 禁用存储时 localStorage 会抛异常，
 * 而主题初始化失败不应该阻断整个页面。
 */
export const THEME_BOOTSTRAP_SCRIPT = [
  'try {',
  '  var root = document.documentElement;',
  '  /*',
  '   * 读字符串型键，两种存储形态都认：',
  '   *   · useStorage 对 string 走 StorageSerializers.string，写入的是裸值 dark；',
  '   *   · 换成默认 JSON 序列化器（或历史上存过带引号的值）时是 "dark"。',
  '   * 只认一种的后果很难查：用户切了暗色，刷新后先闪一帧白、再跳回暗色。',
  '   */',
  '  function read(key) {',
  '    var raw = localStorage.getItem(key);',
  '    if (!raw) return null;',
  '    if (raw.charAt(0) !== \'"\') return raw;',
  '    try { return JSON.parse(raw); } catch (error) { return raw.slice(1, -1); }',
  '  }',
  `  var mode = read('${THEME_STORAGE_KEYS.mode}') || 'auto';`,
  "  var isDark = mode === 'dark' || (mode === 'auto' &&",
  "    window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "  root.classList.toggle('dark', isDark);",
  "  root.style.colorScheme = isDark ? 'dark' : 'light';",
  `  var color = read('${THEME_STORAGE_KEYS.color}');`,
  `  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) color = '${DEFAULT_THEME_COLOR}';`,
  '  var hex = color.slice(1);',
  '  var rgb = [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });',
  '  var base = isDark ? [0, 0, 0] : [255, 255, 255];',
  '  function toHex(channels) {',
  '    return "#" + channels.map(function (v) {',
  '      var n = Math.round(Math.min(255, Math.max(0, v)));',
  '      return (n < 16 ? "0" : "") + n.toString(16);',
  '    }).join("").toUpperCase();',
  '  }',
  '  /* target 占 weight，其余是主色 —— 与 theme.ts 的 mixColor(target, primary, weight) 同义 */',
  '  function mix(target, weight) {',
  '    return toHex([',
  '      target[0] * weight + rgb[0] * (1 - weight),',
  '      target[1] * weight + rgb[1] * (1 - weight),',
  '      target[2] * weight + rgb[2] * (1 - weight)',
  '    ]);',
  '  }',
  '  var primary = color.toUpperCase();',
  '  root.style.setProperty("--el-color-primary", primary);',
  '  root.style.setProperty("--main-color", primary);',
  '  root.style.setProperty("--theme-color", primary);',
  '  for (var i = 1; i <= 9; i += 1) {',
  '    root.style.setProperty("--el-color-primary-light-" + i, mix(base, i / 10));',
  '  }',
  '  root.style.setProperty("--el-color-primary-dark-2", mix(isDark ? [255, 255, 255] : [0, 0, 0], 0.2));',
  '} catch (error) {',
  '  /* 存储不可用：交给 CSS 里的默认主题，不阻断渲染 */',
  '}',
].join('\n');
