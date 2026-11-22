/**
 * 富文本渲染前的第二道净化（前端 / DOMPurify）。
 *
 * ## 定位
 *
 * 正文入库时服务端已经用白名单净化过（`server/utils/rich-html.ts`），这里是**纵深防御**：
 * 万一有历史数据、别的写入路径，或者将来某个接口绕过了入库净化，
 * 渲染层也不会把脚本放进 DOM。两层用的是同一份标签 / 属性清单（`shared/constants/rich-html.ts`），
 * 不会出现「服务端存进去、前端又削掉」的排版漂移。
 *
 * ## 为什么不是「再写一遍正则」
 *
 * DOMPurify 在浏览器里跑，用的是浏览器自己的解析器 —— 这正是关键：
 * 服务端的 htmlparser2 与浏览器的解析结果理论上可能不一致（mXSS 就活在这个缝隙里），
 * 用浏览器解析器再过一遍，等于用「最终渲染引擎」校对了服务端的判断。
 *
 * SSR 下没有 DOM，直接返回空串：后台是 SPA（`ssr: false`），首屏本就不渲染这些内容，
 * 返回原文反而会在水合前把未净化的 HTML 塞进文档。
 */
import DOMPurify from 'dompurify';
import { RICH_HTML_ATTRS, RICH_HTML_TAGS } from '#shared/constants/rich-html';

/** 把「按标签分组」的属性表拍平成 DOMPurify 需要的单一数组。 */
const ALLOWED_ATTR = [...new Set(Object.values(RICH_HTML_ATTRS).flat())];

/** 这些标签即便将来被误加进白名单，也在渲染层兜住。 */
const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'template'];

export function safeRichHtml(raw: string): string {
  if (!raw || !import.meta.client) return '';
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [...RICH_HTML_TAGS],
    ALLOWED_ATTR,
    FORBID_TAGS,
    // data-* / aria-* 默认放行，但正文里不需要它们，少开一个面
    ALLOW_DATA_ATTR: false,
    // `target` 不在默认白名单里，必须显式加，否则链接一律同窗口打开
    ADD_ATTR: ['target'],
    // 保留相对地址（站内图片是 /uploads/...），但禁掉协议相对 `//evil.com`
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}
