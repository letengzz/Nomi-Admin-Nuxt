/**
 * 语言管理入参归一化与译文嵌套的单测（不连数据库）。
 *
 * 这些函数是「数据库内容与前端 i18n 之间的边界」：key 写歪了会生成
 * 前端取不到的消息，语言 code 写歪了会污染译文表，所以全部钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeEntryInput,
  normalizeEntryKey,
  normalizeEntryQuery,
  normalizeLanguageCode,
  normalizeLanguageInput,
  setNested,
} from '../server/utils/auth/language-service';

describe('normalizeEntryKey', () => {
  it('去空格并接受点分路径', () => {
    expect(normalizeEntryKey('  auth.user.title ')).toBe('auth.user.title');
    expect(normalizeEntryKey('app_title-2')).toBe('app_title-2');
  });

  it('空值、超长、非法字符一律拒绝', () => {
    for (const bad of ['', '   ', undefined, null, 123, 'auth.user title', 'auth/user', '.a', 'a..b']) {
      expect(() => normalizeEntryKey(bad)).toThrow();
    }
    expect(() => normalizeEntryKey('a'.repeat(191))).toThrow(/过长/);
  });
});

describe('normalizeLanguageCode', () => {
  it('统一小写并去空格', () => {
    expect(normalizeLanguageCode('  ZH-CN ')).toBe('zh-cn');
  });

  it('只接受小写字母开头的短代码', () => {
    for (const bad of ['', '1zh', '中文', 'zh CN', undefined]) {
      expect(() => normalizeLanguageCode(bad)).toThrow();
    }
  });
});

describe('normalizeEntryQuery', () => {
  it('分页收敛到 1..100，关键词去空格', () => {
    const query = normalizeEntryQuery({ page: '-3', limit: '999', keyword: '  user  ', module: 'auth' });
    expect(query).toEqual({ page: 1, limit: 100, keyword: 'user', module: 'auth', type: '' });
  });

  it('缺省值稳定', () => {
    expect(normalizeEntryQuery({})).toEqual({
      page: 1,
      limit: 10,
      keyword: '',
      module: '',
      type: '',
    });
  });

  it('类型只认 system / custom，其余（含脏值）当全部', () => {
    expect(normalizeEntryQuery({ type: 'system' }).type).toBe('system');
    expect(normalizeEntryQuery({ type: ' custom ' }).type).toBe('custom');
    for (const bad of ['', 'SYSTEM', 'all', undefined, 1]) {
      expect(normalizeEntryQuery({ type: bad }).type).toBe('');
    }
  });
});

describe('normalizeEntryInput', () => {
  it('只保留已注册语言的译文，非字符串按空串处理', () => {
    const input = normalizeEntryInput(
      { key: 'auth.user.title', values: { zh: '用户', en: 123, ja: '不要' } },
      ['zh', 'en'],
    );
    expect(input).toEqual({
      id: 0,
      key: 'auth.user.title',
      remark: '',
      values: { zh: '用户', en: '' },
    });
  });

  it('译文过长时拒绝', () => {
    expect(() =>
      normalizeEntryInput({ key: 'a.b', values: { zh: 'x'.repeat(4001) } }, ['zh']),
    ).toThrow(/过长/);
  });
});

describe('normalizeLanguageInput', () => {
  it('补齐默认值：本地名称回退到显示名、状态启用', () => {
    expect(normalizeLanguageInput({ code: 'EN', name: ' English ' })).toEqual({
      id: 0,
      code: 'en',
      name: 'English',
      nativeName: 'English',
      weigh: 0,
      status: 1,
    });
  });

  it('status 只认 0 / false / "0" 为停用', () => {
    expect(normalizeLanguageInput({ code: 'ja', name: '日本語', status: 0 }).status).toBe(0);
    expect(normalizeLanguageInput({ code: 'ja', name: '日本語', status: false }).status).toBe(0);
    expect(normalizeLanguageInput({ code: 'ja', name: '日本語' }).status).toBe(1);
  });
});

describe('setNested', () => {
  it('把点分 key 写成嵌套对象', () => {
    expect(setNested({}, 'auth.user.title', '用户管理')).toEqual({
      auth: { user: { title: '用户管理' } },
    });
  });

  it('遇到已有非对象节点时替换成对象，不覆盖别的分支', () => {
    const target = { app: { loading: 'Loading' }, auth: 'not-an-object' };
    setNested(target, 'auth.user.title', '用户');
    setNested(target, 'app.loading', 'Loading 2');
    expect(target).toEqual({ app: { loading: 'Loading 2' }, auth: { user: { title: '用户' } } });
  });
});
