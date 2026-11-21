/**
 * 个人中心的展示层工具单测。
 *
 * 脱敏是「给自己看」的页面上唯一带着信息量的逻辑：遮多了看不出是哪个号，
 * 遮少了等于把号码印在屏幕上。边界（空值、超短号、没有 @ 的脏数据）
 * 都在这里钉住，页面上就不用再写 if。
 */
import { describe, expect, it } from 'vitest';
import { maskEmail, maskMobile } from '../app/utils/format';

describe('maskMobile', () => {
  it('保留前 3 位与后 4 位', () => {
    expect(maskMobile('13800008888')).toBe('138****8888');
  });

  it('带分隔符也照样只遮中间', () => {
    expect(maskMobile('138 0000 8888')).toBe('138****8888');
  });

  it('位数不足时整体打码，不硬凑出号码的形状', () => {
    expect(maskMobile('12345')).toBe('*****');
  });

  it('空值与空串返回空串（页面自己决定显示「未设置」）', () => {
    expect(maskMobile('')).toBe('');
    expect(maskMobile(undefined)).toBe('');
    expect(maskMobile(null)).toBe('');
  });
});

describe('maskEmail', () => {
  it('只留首字母与域名', () => {
    expect(maskEmail('chenyifan@126.com')).toBe('c********@126.com');
  });

  it('本地部分很短时至少 4 个星号', () => {
    expect(maskEmail('ab@qq.com')).toBe('a****@qq.com');
  });

  it('星号最多 8 个，长邮箱不会把行撑开', () => {
    expect(maskEmail('averylonglocalpart@example.com')).toBe('a********@example.com');
  });

  it('没有 @ 的脏数据整段打码，不抛错', () => {
    expect(maskEmail('not-an-email')).toBe('************');
    expect(maskEmail('')).toBe('');
  });
});
