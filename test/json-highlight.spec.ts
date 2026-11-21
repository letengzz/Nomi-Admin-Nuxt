/**
 * JSON 高亮的单测。
 *
 * 这段逻辑的产物直接进 `v-html`，所以除了「颜色对不对」，更要钉住两件事：
 *   ① 任何输入都不能产出可执行的标签（日志报文里出现 `<script>` 是常见情况）；
 *   ② 键名和字符串值不能串色 —— 区分它们全靠冒号，正则写错就会整段变成键色。
 */
import { describe, expect, it } from 'vitest';
import { highlightJson, jsonForCopy, prettifyJson } from '../app/utils/json-highlight';

describe('prettifyJson', () => {
  it('合法 JSON 按两空格缩进重排', () => {
    expect(prettifyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('已经是缩进格式的保持不变', () => {
    expect(prettifyJson('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
  });

  it('半截报文原样返回，不抛错', () => {
    expect(prettifyJson('{"a":1')).toBe('{"a":1');
  });

  it('空值统一成空串', () => {
    expect(prettifyJson('')).toBe('');
    expect(prettifyJson(null)).toBe('');
    expect(prettifyJson(undefined)).toBe('');
  });
});

describe('highlightJson', () => {
  it('键名与字符串值分别上色', () => {
    const html = highlightJson('{"name":"张三"}');
    expect(html).toContain('<span class="json-key">"name"</span>');
    expect(html).toContain('<span class="json-string">"张三"</span>');
  });

  it('数字、布尔、null 各有独立记号', () => {
    const html = highlightJson('{"n":12.5,"ok":true,"empty":null}');
    expect(html).toContain('<span class="json-number">12.5</span>');
    expect(html).toContain('<span class="json-boolean">true</span>');
    expect(html).toContain('<span class="json-null">null</span>');
  });

  it('字符串里的 HTML 被转义，不会变成标签', () => {
    const html = highlightJson('{"html":"<script>alert(1)</script>"}');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('键名里的尖括号同样被转义', () => {
    const html = highlightJson('{"<b>":"x"}');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('数字出现在字符串里时按字符串处理', () => {
    const html = highlightJson('{"code":"200"}');
    expect(html).toContain('<span class="json-string">"200"</span>');
    expect(html).not.toContain('json-number');
  });

  it('空输入返回空串（页面自己显示「未记录」）', () => {
    expect(highlightJson('')).toBe('');
    expect(highlightJson(null)).toBe('');
  });
});

describe('jsonForCopy', () => {
  it('复制的内容与展示的内容一致（同样是格式化后的 JSON）', () => {
    expect(jsonForCopy('{"a":1}')).toBe(prettifyJson('{"a":1}'));
  });
});
