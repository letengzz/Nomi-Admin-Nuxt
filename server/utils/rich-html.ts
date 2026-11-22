/**
 * 富文本白名单净化（服务端权威版本）。
 *
 * ## 为什么不用正则
 *
 * 之前的实现是四条黑名单正则，实测能绕过两次：`<svg/onload=alert(1)>`（`on` 前是 `/`，
 * 正则只认空白）和 `javas&#99;ript:alert(1)`（正则不解析实体，浏览器解析）。
 * 根因不是「正则写得不够狠」，而是**用文本匹配去模拟 HTML 解析器**：只要解析器与正则
 * 对同一段字节的理解有分歧，就存在绕过。所以这里把解析交给 htmlparser2（sanitize-html
 * 的内核），由解析器产出 AST，再按白名单**重新序列化** —— 输出的每个字节都是我们生成的，
 * 没有「原样透传」的路径。
 *
 * ## 配置上的几个硬性决定
 *
 * · 标签白名单（见 shared/constants/rich-html.ts）：`svg` / `math` / `template` / `iframe`
 *   / `style` 都不在名单里，连内容一起丢弃（nonTextTags）。
 * · 属性白名单：不放行 `class` / `id` / `data-*`，避免正文样式串到宿主页面。
 * · 协议白名单：只认 `http` / `https` / `mailto` / `tel`，并关掉协议相对地址（`//evil.com`）。
 * · 行内样式二次过滤：`style` 是唯一能带「值」的属性，按属性名 + 值正则逐个放行，
 *   `url()` / `expression()` / `position` 这类天然不在名单里。
 * · 链接强制 `rel`：`target="_blank"` 必须带 `noopener noreferrer`，否则新窗口能
 *   通过 `window.opener` 反向控制后台页面（reverse tabnabbing）。
 */
import sanitizeHtml from 'sanitize-html';
import {
  RICH_HTML_ATTRS,
  RICH_HTML_MAX_LENGTH,
  RICH_HTML_SCHEMES,
  RICH_HTML_SELF_CLOSING,
  RICH_HTML_TAGS,
} from '../../shared/constants/rich-html';

/** 长度单位：`12px` / `1.5em` / `80%` / 纯数字。 */
const LENGTH = String.raw`-?\d{1,3}(?:\.\d+)?(?:px|em|rem|%|pt)?`;
/** 颜色：十六进制 / rgb() / rgba() / 关键字。故意不认 `var()`（可指向任意自定义属性）。 */
const COLOR = String.raw`(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|transparent|inherit|currentColor)`;

/**
 * 行内样式白名单。
 *
 * sanitize-html 只保留这里列出的属性，且值必须整体匹配对应正则；没列到的一律删掉。
 * 少一个属性最多是「排版丢了」，多一个属性可能就是「样式注入」。
 */
const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    color: [new RegExp(`^${COLOR}$`, 'i')],
    'background-color': [new RegExp(`^${COLOR}$`, 'i')],
    'font-size': [/^\d{1,3}(?:\.\d+)?(?:px|em|rem|%|pt)$/i],
    'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
    'font-style': [/^(?:normal|italic|oblique)$/i],
    // 字体名只允许字母数字与常见分隔符：括号 / 分号 / 反斜杠都在外面
    'font-family': [/^[A-Za-z0-9\s,'"_-]{1,120}$/],
    'text-align': [/^(?:left|right|center|justify|start|end)$/i],
    'text-decoration': [/^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i],
    'text-decoration-line': [/^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i],
    'text-indent': [new RegExp(`^(?:${LENGTH})$`, 'i')],
    'line-height': [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/i],
    'letter-spacing': [new RegExp(`^(?:normal|${LENGTH})$`, 'i')],
    margin: [new RegExp(`^(?:auto|${LENGTH})(?:\\s+(?:auto|${LENGTH})){0,3}$`, 'i')],
    padding: [new RegExp(`^(?:${LENGTH})(?:\\s+${LENGTH}){0,3}$`, 'i')],
    width: [/^(?:auto|\d{1,4}(?:px|em|rem|%))$/i],
    height: [/^(?:auto|\d{1,4}(?:px|em|rem|%))$/i],
    'max-width': [/^(?:none|\d{1,4}(?:px|em|rem|%))$/i],
    'vertical-align': [/^(?:baseline|top|middle|bottom|sub|super|text-top|text-bottom)$/i],
    'white-space': [/^(?:normal|pre|pre-wrap|pre-line|nowrap)$/i],
    'word-break': [/^(?:normal|break-all|keep-all|break-word)$/i],
    'border-radius': [new RegExp(`^${LENGTH}(?:\\s+${LENGTH}){0,3}$`, 'i')],
    'border-left': [new RegExp(`^(?:none|\\d{1,2}px\\s+(?:solid|dashed|dotted)\\s+${COLOR})$`, 'i')],
    'border-bottom': [new RegExp(`^(?:none|\\d{1,2}px\\s+(?:solid|dashed|dotted)\\s+${COLOR})$`, 'i')],
  },
};

/** 允许的属性表：`'*'` 是所有标签通用的，其余按标签名精确匹配。 */
function allowedAttributes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(RICH_HTML_ATTRS)) out[tag] = [...attrs];
  return out;
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_HTML_TAGS],
  allowedAttributes: allowedAttributes(),
  allowedSchemes: [...RICH_HTML_SCHEMES],
  // 图片只走 http(s)：`data:` 可以塞超长 base64 撑爆库，`file:` 更没道理。
  allowedSchemesByTag: { img: ['http', 'https'] },
  // `//evil.com/x.png` 会被当成当前协议下的外链：解析歧义，直接关掉。
  allowProtocolRelative: false,
  allowedStyles: ALLOWED_STYLES,
  selfClosing: [...RICH_HTML_SELF_CLOSING],
  // 这些标签连内容一起丢：留下 `alert(1)` 这种正文比丢掉更让人困惑。
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'svg', 'math', 'template', 'object', 'embed'],
  // 不认识标签时只丢标签、保留文字（例如粘贴来的 `<font>` 包住的一段话）。
  disallowedTagsMode: 'discard',
  transformTags: {
    a(tagName, attribs) {
      const next: Record<string, string> = { ...attribs };
      if (!next.href) {
        // 没有 href 的 <a> 只是排版噪音，降级成纯文本更干净。
        return { tagName: 'span', attribs: { ...(next.style ? { style: next.style } : {}) } };
      }
      if (next.target) {
        next.target = next.target === '_self' ? '_self' : '_blank';
        // 不带 noopener 时，新窗口可以用 window.opener 改写后台页面地址。
        next.rel = 'noopener noreferrer nofollow';
      }
      return { tagName, attribs: next };
    },
    img(tagName, attribs) {
      const next: Record<string, string> = { ...attribs, loading: 'lazy' };
      return { tagName, attribs: next };
    },
  },
  // 没有 src 的 img 只剩一个破图图标，直接连标签一起去掉。
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
};

/**
 * 兜底：把 HTML 全部当纯文本转义。
 *
 * 只在净化器自己抛错时走这条路（畸形到解析器崩掉，或将来升级踩到库的 bug）。
 * 选择「丢掉全部排版」而不是「原样放行」，是因为两种失败的代价不对等：
 * 前者是公告难看一眼，后者是任何一个打开公告的人被执行脚本。
 */
function escapeToText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 净化富文本 HTML。**幂等**：对已净化过的内容再跑一次，输出不变。
 *
 * 超长输入先截断再解析：给解析器一个确定的规模上限，避免畸形 HTML 打满 CPU。
 */
export function sanitizeRichHtml(raw: string): string {
  if (!raw) return '';
  const input = raw.length > RICH_HTML_MAX_LENGTH ? raw.slice(0, RICH_HTML_MAX_LENGTH) : raw;
  try {
    return sanitizeHtml(input, OPTIONS).trim();
  } catch (error) {
    console.error('[rich-html] 净化失败，已降级为纯文本：', error);
    return escapeToText(input);
  }
}

/** 判断一段 HTML 里是否存在「净化后就会变形」的危险结构，供数据修复脚本先扫后改。 */
export function richHtmlLooksDangerous(raw: string): boolean {
  if (!raw) return false;
  return sanitizeRichHtml(raw) !== raw.trim();
}
