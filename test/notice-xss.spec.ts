/**
 * 富文本净化（HIGH-01）回归测试。
 *
 * ## 这个文件补的是「之前没有断言」的窟窿
 *
 * 仓库里曾有一个 `test/__sec_probe.spec.ts`：列出十来个 XSS 载荷、`console.log` 打出来、
 * 最后 `expect(true).toBe(true)`。它每次都「通过」，所以 CI 一直是绿的 ——
 * 而实际上 `<svg/onload=alert(1)>` 原样落库。**没有断言的测试比没有测试更糟**：
 * 它让人误以为覆盖到了。
 *
 * 这里的写法反过来：每个载荷都断言「输出里不存在危险结构」，而不是断言输出长什么样。
 * 断言精确输出会被净化库的版本升级搞得到处红，而「不能有 script / on* / javascript:」
 * 是不随实现变化的不变量。
 *
 * 覆盖范围参考 OWASP XSS Filter Evasion Cheat Sheet 的常见家族：
 * 事件处理器、命名空间标签（svg/math）、实体与空白混淆的协议、协议相对地址、
 * data: URI、CSS 表达式与 url()、mXSS 嵌套、模板标签。
 */
import { describe, expect, it } from 'vitest';
import { richHtmlLooksDangerous, sanitizeRichHtml } from '../server/utils/rich-html';
import { noticeHtmlToText, sanitizeNoticeHtml } from '../server/utils/notice-service';

/** 净化结果里绝不能出现的结构。命中任意一条即视为修复失败。 */
const DANGEROUS = [
  { re: /<\s*(script|style|iframe|object|embed|svg|math|template|form)\b/i, why: '危险标签' },
  { re: /\son[a-z]+\s*=/i, why: '事件属性' },
  { re: /javascript\s*:/i, why: 'javascript: 协议' },
  { re: /\bvbscript\s*:/i, why: 'vbscript: 协议' },
  { re: /url\s*\(/i, why: 'CSS url()' },
  { re: /expression\s*\(/i, why: 'CSS expression()' },
  { re: /@import/i, why: 'CSS @import' },
];

/** 净化并断言安全，返回净化结果供进一步断言。 */
function clean(input: string): string {
  const out = sanitizeNoticeHtml(input);
  for (const rule of DANGEROUS) expect(out, `${rule.why} 未被清掉：${input}`).not.toMatch(rule.re);
  return out;
}

describe('sanitizeNoticeHtml：审计报告里的两个绕过载荷', () => {
  it('<svg/onload=> 整个标签被丢弃', () => {
    expect(clean('<p>正文</p><svg/onload=alert(document.domain)>')).toBe('<p>正文</p>');
  });

  it('实体编码的 javascript: 链接不会保留 href', () => {
    const out = clean('<a href="javas&#99;ript:alert(1)">点我</a>');
    expect(out).not.toContain('href');
    expect(out).toContain('点我');
  });

  it('冒号实体编码同样无效', () => {
    expect(clean('<a href="javascript&#58;alert(1)">x</a>')).not.toContain('href');
  });
});

describe('sanitizeNoticeHtml：事件处理器家族', () => {
  const handlers = [
    '<img src=x onerror=alert(1)>',
    '<img/src=x/onerror=alert(1)>',
    '<img src=x OnErRoR=alert(1)>',
    '<img src=x onerror="alert(1)"',
    '<div onclick=alert(1)>x</div>',
    '<p onmouseover="alert(1)">x</p>',
    '<body onload=alert(1)>',
    '<input onfocus=alert(1) autofocus>',
    '<details open ontoggle=alert(1)>',
    '<marquee onstart=alert(1)>x</marquee>',
    '<video><source onerror=alert(1)></video>',
    '<a href="https://ok.com" onclick="alert(1)">x</a>',
  ];

  for (const payload of handlers) {
    it(`清掉事件属性：${payload.slice(0, 40)}`, () => {
      clean(payload);
    });
  }
});

describe('sanitizeNoticeHtml：协议混淆', () => {
  const protocols = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="  javascript:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="java&Tab;script:alert(1)">x</a>',
    '<a href="java&NewLine;script:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    // 协议相对地址：浏览器会按当前协议补全成 https://evil.com
    '<a href="//evil.com/steal">x</a>',
    '<img src="javascript:alert(1)">',
    '<img src="//evil.com/x.png">',
    '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  ];

  for (const payload of protocols) {
    it(`拒绝危险协议：${payload.slice(0, 46)}`, () => {
      const out = clean(payload);
      expect(out).not.toMatch(/(href|src)\s*=\s*"(javascript|vbscript|data):/i);
      expect(out).not.toContain('//evil.com');
    });
  }
});

describe('sanitizeNoticeHtml：命名空间与 mXSS', () => {
  const payloads = [
    '<svg><script>alert(1)</script></svg>',
    '<svg><animate onbegin=alert(1) attributeName=x>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<math href="javascript:alert(1)">x</math>',
    '<template><img src=x onerror=alert(1)></template>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<form action="javascript:alert(1)"><button>x</button></form>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="javascript:alert(1)">',
    '<base href="https://evil.com/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.com">',
    '<link rel="stylesheet" href="https://evil.com/x.css">',
    '<style>@import "https://evil.com/x.css";</style>',
  ];

  for (const payload of payloads) {
    it(`丢弃非 HTML 命名空间与元标签：${payload.slice(0, 40)}`, () => {
      clean(payload);
    });
  }

  it('mXSS 载荷净化后为空，且不会残留可执行的 img', () => {
    expect(sanitizeNoticeHtml('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>')).toBe('');
  });
});

describe('sanitizeNoticeHtml：样式注入', () => {
  it('url() / position / expression 被剔除，只留安全属性', () => {
    const out = clean(
      '<div style="background:url(javascript:alert(1));position:fixed;top:0;left:0;z-index:9999;color:#f00">x</div>',
    );
    expect(out).toContain('color:#f00');
    expect(out).not.toContain('position');
    expect(out).not.toContain('z-index');
  });

  it('正常的居中 / 字号 / 加粗保留', () => {
    const out = sanitizeNoticeHtml('<p style="text-align:center;font-size:16px">居中</p>');
    expect(out).toContain('text-align:center');
    expect(out).toContain('font-size:16px');
  });

  it('字体名里不能夹带括号或分号', () => {
    const out = clean('<span style="font-family:evil(\'x\');color:red">x</span>');
    expect(out).not.toContain('evil(');
  });
});

describe('sanitizeNoticeHtml：不误伤编辑器正常产出', () => {
  it('段落 / 加粗 / 斜体 / 列表 / 换行原样保留', () => {
    const html = '<p><strong>粗</strong><em>斜</em><u>下划线</u><br></p><ul><li>一</li><li>二</li></ul>';
    // 空元素会被序列化成 XHTML 形式的 `<br />`，这是 sanitize-html 的既定输出，
    // 浏览器与编辑器都能正常解析，不值得为此改库。
    expect(sanitizeNoticeHtml(html)).toBe(html.replace('<br>', '<br />'));
  });

  it('站内相对地址的图片保留，自动补 loading=lazy', () => {
    const out = sanitizeNoticeHtml('<img src="/uploads/2026/11/a.png" alt="图" width="120">');
    expect(out).toContain('src="/uploads/2026/11/a.png"');
    expect(out).toContain('alt="图"');
    expect(out).toContain('loading="lazy"');
  });

  it('外链保留并强制 noopener', () => {
    const out = sanitizeNoticeHtml('<a href="https://example.com" target="_blank">外链</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('表格与合并单元格保留', () => {
    const html = '<table><thead><tr><th colspan="2">表头</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
    expect(sanitizeNoticeHtml(html)).toBe(html);
  });

  it('class / id 被摘掉，避免正文样式串到宿主页面', () => {
    const out = sanitizeNoticeHtml('<p id="app" class="el-button">x</p>');
    expect(out).toBe('<p>x</p>');
  });
});

describe('sanitizeNoticeHtml：幂等与规模', () => {
  it('对已净化内容再跑一次，输出不变', () => {
    const once = sanitizeNoticeHtml('<p onclick="x">a<svg/onload=alert(1)></p><a href="https://a.com" target="_blank">b</a>');
    expect(sanitizeNoticeHtml(once)).toBe(once);
  });

  it('超长正文被截断到上限附近，不会无限膨胀', () => {
    const huge = `<p>${'a'.repeat(1_500_000)}</p>`;
    // 截断点落在标签中间时解析器会补上闭合标签，所以允许一点点溢出，
    // 关键是「输入 1.5M 输出不会超过 1M + 收尾标签」。
    const out = sanitizeNoticeHtml(huge);
    expect(out.length).toBeLessThanOrEqual(1_000_000 + 32);
    expect(out.length).toBeGreaterThan(900_000);
  });

  it('纯文本里的尖括号按文本保留，不变成标签', () => {
    const out = sanitizeNoticeHtml('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });
});

describe('richHtmlLooksDangerous（存量数据扫描用）', () => {
  it('干净内容判为安全', () => {
    expect(richHtmlLooksDangerous('<p><strong>正常</strong></p>')).toBe(false);
  });

  it('带载荷的内容判为需要修复', () => {
    expect(richHtmlLooksDangerous('<p>正文</p><svg/onload=alert(1)>')).toBe(true);
    expect(richHtmlLooksDangerous('<a href="javas&#99;ript:alert(1)">x</a>')).toBe(true);
  });

  it('sanitizeNoticeHtml 只是 sanitizeRichHtml 的别名，两者结果一致', () => {
    const payload = '<p onclick="x">a</p><svg/onload=alert(1)>';
    expect(sanitizeNoticeHtml(payload)).toBe(sanitizeRichHtml(payload));
  });
});

describe('noticeHtmlToText 与净化共用同一套规则', () => {
  it('带脚本的正文摘要里不出现脚本内容', () => {
    expect(noticeHtmlToText('<p>公告<script>alert(1)</script></p>')).toBe('公告');
  });

  it('实体解开后是可读文本', () => {
    expect(noticeHtmlToText('<p>有&nbsp;3&nbsp;条&amp;提醒</p>')).toBe('有 3 条&提醒');
  });
});
