/**
 * 富文本白名单：服务端（sanitize-html）与前端（DOMPurify）共用同一份。
 *
 * ## 为什么是白名单
 *
 * 公告正文是「编辑者可控的 HTML」，最终用 `v-html` 渲染。黑名单（「去掉 script / on* /
 * javascript:」）永远漏一个：`<svg/onload=>` 的 `on` 前面是 `/` 不是空白、
 * `javas&#99;ript:` 在浏览器解码后才是协议、`<math><mtext></mtext></math>` 能改写命名空间。
 * 所以只保留明确认识的标签，其余一律丢掉 —— 漏掉的后果是「排版少了」，不是「被盗号」。
 *
 * ## 两边为什么必须一致
 *
 * 客户端这一层是纵深防御：服务端漏了，前端还有一道。两边清单不一致时，
 * 就会出现「服务端存进去、前端渲染时又被削掉」的诡异排版。清单放 shared/ 下，
 * 只留一个事实来源。
 *
 * 编辑器是 wangEditor（工具栏已排除视频 / 表格 / 代码块），这里的清单是它的超集 ——
 * 用户从别处粘贴进来的普通排版也不该被削得太狠。
 */

/** 允许保留的标签。`svg` / `math` / `template` / `iframe` / `style` 一律不在其中。 */
export const RICH_HTML_TAGS = [
  'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'a', 'img', 'figure', 'figcaption',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
] as const;

/**
 * 允许保留的属性（按标签分组）。
 *
 * 注意**没有** `class` / `id` / `data-*`：
 *   · 正文里的 class 会串到宿主页面的样式上（`class="el-button"` 能让正文冒充按钮）；
 *   · id 会与页面上已有元素撞名，配合 `label[for]` 之类的组合能做出点击劫持。
 * 排版一律走行内 `style`，由服务端按属性名 + 值正则二次过滤。
 */
export const RICH_HTML_ATTRS: Record<string, readonly string[]> = {
  '*': ['style'],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan', 'width', 'height', 'align', 'valign'],
  th: ['colspan', 'rowspan', 'width', 'height', 'align', 'valign'],
  ol: ['start', 'type'],
  ul: ['type'],
  col: ['span', 'width'],
  colgroup: ['span', 'width'],
};

/** 允许的协议。相对地址（`/uploads/x.png`）没有协议，默认放行。 */
export const RICH_HTML_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

/**
 * 正文长度上限（字符）。
 *
 * 不是为了限制编辑者，而是给净化器一个确定的规模上限：没有上限时，
 * 一个几 MB 的畸形 HTML 能让单线程的正则解析跑满 CPU（ReDoS 的现实版本）。
 * 100 万字足够写一本手册，公告场景远用不到。
 */
export const RICH_HTML_MAX_LENGTH = 1_000_000;

/** `a` / `img` 这类标签是否需要「必须带某个属性」的额外检查，见服务端 transformTags。 */
export const RICH_HTML_SELF_CLOSING = ['img', 'br', 'hr', 'col'] as const;
