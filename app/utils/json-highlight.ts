/**
 * 极简 JSON 高亮：把一段字符串变成带 `span.json-*` 的 HTML 片段。
 *
 * 为什么自己写：只有「日志详情里看一段报文」这一个场景，引入 highlight.js
 * （几百 KB、还要挑语言包与主题）不划算。这里只认 JSON 的几类记号，
 * 颜色交给页面样式表按明暗主题分别定义。
 *
 * 安全边界：输出走 `v-html`，所以**每一段文本都先转义再加标签**，
 * 包含键名与字符串里的 `<`、`&`。不做「先拼 HTML 再转义」，
 * 那样未转义的花括号会漏出去。
 */

const TOKEN_RE =
  /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

const TAG_CLASS: Record<string, string> = {
  key: 'json-key',
  string: 'json-string',
  number: 'json-number',
  boolean: 'json-boolean',
  null: 'json-null',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 尽量把输入格式化成缩进 JSON：
 * - 合法 JSON（对象/数组/数字/字符串）→ `JSON.stringify(value, null, 2)`
 * - 不合法（截断、半截报文、纯文本）→ 原样返回，仍然做记号高亮
 */
export function prettifyJson(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 给 `prettifyJson` 的结果上色，返回可直接 v-html 的 HTML。 */
export function highlightJson(raw: string | null | undefined): string {
  const text = prettifyJson(raw);
  if (!text) return '';

  let out = '';
  let last = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    out += escapeHtml(text.slice(last, index));

    const [full, quoted, colon, literal, number] = match;
    if (quoted) {
      // 带冒号的是键名，否则是字符串值；冒号本身不属于记号。
      const key = String(quoted);
      const isKey = Boolean(colon);
      out += `<span class="${isKey ? TAG_CLASS.key : TAG_CLASS.string}">${escapeHtml(key)}</span>`;
      if (colon) out += escapeHtml(String(colon));
    } else if (literal) {
      const cls = literal === 'null' ? TAG_CLASS.null : TAG_CLASS.boolean;
      out += `<span class="${cls}">${escapeHtml(String(literal))}</span>`;
    } else if (number) {
      out += `<span class="${TAG_CLASS.number}">${escapeHtml(String(number))}</span>`;
    } else {
      out += escapeHtml(String(full));
    }
    last = index + String(full).length;
  }

  out += escapeHtml(text.slice(last));
  return out;
}

/** 纯文本复制用：与页面上看到的内容一致（格式化后的 JSON）。 */
export function jsonForCopy(raw: string | null | undefined): string {
  return prettifyJson(raw);
}
