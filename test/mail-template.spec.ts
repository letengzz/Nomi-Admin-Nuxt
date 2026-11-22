/**
 * 邮件模板单测。
 *
 * 模板是「拼接字符串」的活儿，改一个字符都可能把标签拼断，而错误只会在真实收件箱里
 * 显形（甚至只在 Outlook 里显形）。这里能自动化的只有两件事：
 *   ① 关键内容确实进了正文（验证码不能丢）；
 *   ② 外部可控的字符串（昵称、站点名、logo）没有变成 HTML 注入点。
 */
import { describe, expect, it } from 'vitest';
import { renderResetCodeMail, renderTestMail } from '../server/utils/mail-template';

const brand = { name: 'Nomi Admin' };

describe('renderResetCodeMail', () => {
  const mail = renderResetCodeMail({
    brand,
    recipient: '张三',
    account: 'zhangsan',
    code: '482915',
    minutes: 5,
    requestedAt: '2026/11/22 16:20:00',
  });

  it('主题带站点名，不含验证码本身', () => {
    expect(mail.subject).toContain('Nomi Admin');
    // 主题会出现在锁屏通知和收件箱列表里，把码写进去等于公开
    expect(mail.subject).not.toContain('482915');
  });

  it('HTML 里验证码按位分隔，纯文本里是连着的六位', () => {
    expect(mail.html).toContain('4 8 2 9 1 5');
    expect(mail.text).toContain('482915');
  });

  it('纯文本是完整降级版本，不含任何标签', () => {
    expect(mail.text).toContain('5 分钟内有效');
    expect(mail.text).toContain('zhangsan');
    expect(mail.text).not.toContain('<');
    expect(mail.text).not.toContain('&nbsp;');
  });

  it('是一封完整的 HTML 文档，且没有脚本 / 外部样式表', () => {
    expect(mail.html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(mail.html).toContain('<body');
    expect(mail.html).not.toContain('<script');
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).not.toContain('<link');
    // 内联样式是底线：Gmail 会剥掉 <style>
    expect(mail.html).toContain('style="');
  });

  it('相对路径的 logo 不会被渲染成坏图', () => {
    const withRelative = renderResetCodeMail({
      brand: { name: 'Nomi Admin', logo: '/logo.png' },
      recipient: '张三',
      account: 'zhangsan',
      code: '482915',
      minutes: 5,
    });
    expect(withRelative.html).not.toContain('<img');
  });

  it('绝对地址的 logo 才输出 img', () => {
    const withAbsolute = renderResetCodeMail({
      brand: { name: 'Nomi Admin', logo: 'https://cdn.example.com/logo.png' },
      recipient: '张三',
      account: 'zhangsan',
      code: '482915',
      minutes: 5,
    });
    expect(withAbsolute.html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it('昵称 / 站点名里的 HTML 被转义，不能变成注入点', () => {
    const evil = renderResetCodeMail({
      brand: { name: '<img src=x onerror=alert(1)>' },
      recipient: '<script>alert("x")</script>',
      account: 'zhangsan',
      code: '482915',
      minutes: 5,
    });
    expect(evil.html).not.toContain('<script>alert');
    expect(evil.html).not.toContain('<img src=x onerror');
    expect(evil.html).toContain('&lt;script&gt;');
    // 纯文本没有转义的必要，但也不能把标签当结构渲染
    expect(evil.text).toContain('<script>alert("x")</script>');
  });
});

describe('renderTestMail', () => {
  const mail = renderTestMail({
    brand,
    host: 'smtp.163.com',
    port: 465,
    encryption: 'ssl',
    fromAddress: 'noreply@nomi.dev',
    sentAt: '2026/11/22 16:20:00',
  });

  it('把实际生效的服务器参数写进正文', () => {
    for (const target of [mail.html, mail.text]) {
      expect(target).toContain('smtp.163.com');
      expect(target).toContain('465');
      expect(target).toContain('noreply@nomi.dev');
    }
    expect(mail.html).toContain('SSL');
  });

  it('主题带站点名，便于在收件箱里认出来', () => {
    expect(mail.subject).toContain('Nomi Admin');
  });
});
