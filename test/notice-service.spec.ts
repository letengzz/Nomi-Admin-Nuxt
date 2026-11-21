/**
 * 通知公告的纯逻辑单测（不连数据库）。
 *
 * 覆盖三条会影响「谁能看到什么」的边界：
 *   1. 定时发布：0 / 过去 / 未来的判定；
 *   2. 通知范围：all / 指定部门（含子部门）/ 指定角色 / 超管放行；
 *   3. 表单校验与列表筛选参数的归一化（枚举白名单、范围目标必填）。
 */
import { describe, expect, it } from 'vitest';
import {
  isNoticePublished,
  isNoticeVisibleTo,
  normalizeNoticeInput,
  normalizeNoticeListQuery,
  noticeHtmlToText,
  parseScopeIds,
  sanitizeNoticeHtml,
  type NoticeVisibilityIdentity,
} from '../server/utils/notice-service';

const TREE = [
  { id: 1, pid: 0 },
  { id: 2, pid: 1 },
  { id: 3, pid: 2 },
  { id: 4, pid: 1 },
];

const superUser: NoticeVisibilityIdentity = { isSuper: true, departmentId: 0, roleIds: [] };
const dept2User: NoticeVisibilityIdentity = { isSuper: false, departmentId: 2, roleIds: [7] };
const dept3User: NoticeVisibilityIdentity = { isSuper: false, departmentId: 3, roleIds: [8] };

describe('isNoticePublished', () => {
  it('0 表示立即发布，永远已发布', () => {
    expect(isNoticePublished(0, 1000)).toBe(true);
  });
  it('过去时间点已发布', () => {
    expect(isNoticePublished(900, 1000)).toBe(true);
  });
  it('未来时间点未发布', () => {
    expect(isNoticePublished(1100, 1000)).toBe(false);
  });
});

describe('parseScopeIds', () => {
  it('字符串逗号分隔去重并过滤非法值', () => {
    expect(parseScopeIds('1,2,1,,x,-3,4')).toEqual([1, 2, 4]);
  });
  it('接受数字数组', () => {
    expect(parseScopeIds([2, '3', 2, 0])).toEqual([2, 3]);
  });
});

describe('isNoticeVisibleTo', () => {
  it('all 对所有人可见', () => {
    expect(isNoticeVisibleTo({ notifyScope: 'all', scopeIds: [] }, dept2User, TREE)).toBe(true);
  });

  it('超管对任何范围都放行', () => {
    expect(
      isNoticeVisibleTo({ notifyScope: 'role', scopeIds: [999] }, superUser, TREE),
    ).toBe(true);
  });

  it('指定部门：命中本部门可见', () => {
    expect(
      isNoticeVisibleTo({ notifyScope: 'department', scopeIds: [2] }, dept2User, TREE),
    ).toBe(true);
  });

  it('指定部门：命中父部门时子部门也可见', () => {
    expect(
      isNoticeVisibleTo({ notifyScope: 'department', scopeIds: [2] }, dept3User, TREE),
    ).toBe(true);
  });

  it('指定部门：不相关的部门不可见', () => {
    expect(
      isNoticeVisibleTo({ notifyScope: 'department', scopeIds: [4] }, dept3User, TREE),
    ).toBe(false);
  });

  it('指定角色：命中角色可见，不命中不可见', () => {
    expect(isNoticeVisibleTo({ notifyScope: 'role', scopeIds: [7] }, dept2User, TREE)).toBe(true);
    expect(isNoticeVisibleTo({ notifyScope: 'role', scopeIds: [99] }, dept2User, TREE)).toBe(false);
  });
});

describe('normalizeNoticeInput', () => {
  const base = { title: '  标题  ', content: '  正文  ', category: 'notice' };

  it('剥掉首尾空白，枚举取合法值', () => {
    const result = normalizeNoticeInput({ ...base, category: 'bogus', notifyMethod: 'bogus' });
    expect(result.title).toBe('标题');
    expect(result.content).toBe('正文');
    expect(result.category).toBe('notice');
    expect(result.notifyMethod).toBe('internal');
  });

  it('毫秒时间戳收敛成秒', () => {
    const result = normalizeNoticeInput({ ...base, publishTime: 1_700_000_000_000 });
    expect(result.publishTime).toBe(1_700_000_000);
  });

  it('标题或内容为空时抛错', () => {
    expect(() => normalizeNoticeInput({ ...base, title: '' })).toThrow();
    expect(() => normalizeNoticeInput({ ...base, content: '' })).toThrow();
  });

  it('非 all 范围必须给目标，否则抛错', () => {
    expect(() => normalizeNoticeInput({ ...base, notifyScope: 'department' })).toThrow();
    expect(() =>
      normalizeNoticeInput({ ...base, notifyScope: 'department', scopeIds: [2, 3] }),
    ).not.toThrow();
  });

  it('all 范围忽略传入的目标 id', () => {
    const result = normalizeNoticeInput({ ...base, notifyScope: 'all', scopeIds: [2, 3] });
    expect(result.scopeIds).toEqual([]);
  });
});

describe('sanitizeNoticeHtml（富文本入库净化）', () => {
  it('去掉 script 标签及其内容，保留正常排版标签', () => {
    const html = '<p>正文<script>alert(1)</script>继续</p><strong>加粗</strong>';
    const result = sanitizeNoticeHtml(html);
    expect(result).toBe('<p>正文继续</p><strong>加粗</strong>');
  });

  it('去掉 on* 事件属性与 javascript: 链接', () => {
    const html = '<p onclick="evil()">x</p><a href="javascript:alert(1)">链</a><img src="javascript:x">';
    const result = sanitizeNoticeHtml(html);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
  });

  it('正文只剩脚本时被清空，normalize 会拒绝空正文', () => {
    expect(sanitizeNoticeHtml('<script>alert(1)</script>')).toBe('');
    expect(() =>
      normalizeNoticeInput({ title: 't', content: '<script>alert(1)</script>' }),
    ).toThrow();
  });
});

describe('noticeHtmlToText（抽屉纯文本摘要）', () => {
  it('剥掉标签、解开实体并压缩空白', () => {
    expect(noticeHtmlToText('<p>有&nbsp;3&nbsp;条&amp;提醒</p>')).toBe('有 3 条&提醒');
  });
});

describe('normalizeNoticeListQuery', () => {
  it('合法筛选条件保留，非法回落空值', () => {
    const q = normalizeNoticeListQuery({
      keyword: '  系统  ',
      category: 'bulletin',
      status: '0',
      published: '1',
    });
    expect(q).toEqual({ keyword: '系统', category: 'bulletin', status: 0, published: true });
  });

  it('URL query 的字符串布尔 true/false 要正确识别', () => {
    expect(normalizeNoticeListQuery({ published: 'false' }).published).toBe(false);
    expect(normalizeNoticeListQuery({ published: 'true' }).published).toBe(true);
    expect(normalizeNoticeListQuery({ status: 'false' }).status).toBe(0);
    expect(normalizeNoticeListQuery({ status: 'true' }).status).toBe(1);
  });

  it('未传时全部为空，不加任何筛选', () => {
    expect(normalizeNoticeListQuery({})).toEqual({
      keyword: '',
      category: '',
      status: null,
      published: null,
    });
  });
});
