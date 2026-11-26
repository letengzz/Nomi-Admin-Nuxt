/**
 * 账号导入/导出的纯函数单测。
 *
 * 只测「不碰库」的那一层：Excel 解析、表头识别、模板与导出文件的表结构、
 * 策略归一化。校验与冲突判定需要数据库（`prepareUserImport`），
 * 那部分由接口层和手工验收覆盖 —— 在这里造假库只会测出「我的 mock 长什么样」。
 */
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUserExportFile,
  buildUserImportTemplate,
  IMPORT_PASSWORD_ENV,
  MAX_IMPORT_ROWS,
  normalizeImportStrategies,
  parseUserImportFile,
  resolveImportPassword,
} from '../server/utils/auth/user-import';

function sheetBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '用户数据');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 从导出/模板的字节里读回二维数组，用来断言表头与内容。 */
function readBack(buffer: Buffer, sheetName?: string): unknown[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[sheetName ?? workbook.SheetNames[0]!];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, raw: false, defval: '' });
}

// 密码与部门刻意不在模板里：它们分别来自服务端配置与操作人所属部门。
const HEADER = ['账号*', '昵称', '邮箱', '手机号', '性别', '角色*', '状态'];

describe('parseUserImportFile', () => {
  it('按表头取列，行号与表格一致（空白行跳过但不占错位）', () => {
    const rows = parseUserImportFile(
      sheetBuffer([
        HEADER,
        ['zhangsan', '张三', 'z@a.com', '13800138000', '男', '普通用户', '启用'],
        [],
        ['lisi', '李四', '', '', '', '', '普通用户', ''],
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.line).toBe(2);
    expect(rows[0]!.cells.username).toBe('zhangsan');
    expect(rows[0]!.cells.nickname).toBe('张三');
    // 空白行之后的那一行，行号仍然是 4
    expect(rows[1]!.line).toBe(4);
    expect(rows[1]!.cells.email).toBe('');
  });

  it('认常见表头别名，多余的列不影响解析', () => {
    const rows = parseUserImportFile(
      sheetBuffer([
        ['用户名', '备注', '手机', '角色'],
        ['wangwu', '这一列不会被读取', '13900139000', '运营,客服'],
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells.username).toBe('wangwu');
    expect(rows[0]!.cells.mobile).toBe('13900139000');
    expect(rows[0]!.cells.roles).toBe('运营,客服');
    expect(rows[0]!.cells.nickname).toBe('');
  });

  it('旧模板多出来的密码列 / 部门列会被忽略，不会污染解析结果', () => {
    const rows = parseUserImportFile(
      sheetBuffer([
        ['账号', '密码', '部门', '手机号'],
        ['zhaoliu', 'abcdef', '技术部', 13800138000],
      ]),
    );
    expect(rows[0]!.cells.mobile).toBe('13800138000');
    expect(rows[0]!.cells).not.toHaveProperty('password');
    expect(rows[0]!.cells).not.toHaveProperty('department');
  });

  it('手机号存成数字时不会变成科学计数法', () => {
    const rows = parseUserImportFile(
      sheetBuffer([
        ['账号', '手机号'],
        ['zhaoliu', 13800138000],
      ]),
    );
    expect(rows[0]!.cells.mobile).toBe('13800138000');
  });

  it('表头不在第一行也能找到（上方有标题行）', () => {
    const rows = parseUserImportFile(
      sheetBuffer([['用户导入表'], HEADER, ['sunqi', '', '', '', '', '普通用户', '']]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.line).toBe(3);
  });

  it('没有「账号」表头时给出可执行的提示', () => {
    expect(() => parseUserImportFile(sheetBuffer([['姓名', '电话'], ['张三', '138']]))).toThrow(
      /表头/,
    );
  });

  it('超过行数上限直接拒绝，不让人等一个注定失败的请求', () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => [
      `user${index}`,
      '',
      '',
      '',
      '',
      '普通用户',
      '',
    ]);
    expect(() => parseUserImportFile(sheetBuffer([HEADER, ...body]))).toThrow(/最多导入/);
  });
});

describe('buildUserImportTemplate', () => {
  it('数据表的表头就是解析器认的那一套', () => {
    const data = readBack(buildUserImportTemplate(), '用户数据');
    expect(data[0]).toEqual(HEADER);
    expect(String(data[1]![0])).toBe('zhangsan');
  });

  it('模板能被自己的解析器读回来（示例行可直接导入）', () => {
    const rows = parseUserImportFile(buildUserImportTemplate());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells).toMatchObject({
      username: 'zhangsan',
      nickname: '张三',
      roles: '普通用户',
      status: '启用',
    });
    // 密码与部门不在模板中：它们分别来自服务端配置和操作人所属部门。
    expect(rows[0]!.cells).not.toHaveProperty('password');
    expect(rows[0]!.cells).not.toHaveProperty('department');
  });

  it('填写说明里仍向人解释密码 / 部门来源，但不作为数据列解析', () => {
    const guide = readBack(buildUserImportTemplate(), '填写说明');
    expect(guide.some((row) => row[0] === '密码' && String(row[2]).includes('系统配置'))).toBe(true);
    expect(guide.some((row) => row[0] === '部门' && String(row[2]).includes('操作人'))).toBe(true);
    const rows = parseUserImportFile(buildUserImportTemplate());
    expect(rows.every((row) => row.cells.username !== '字段')).toBe(true);
  });
});

describe('resolveImportPassword', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('未配置时直接报错，绝不给新账号写空密码', () => {
    vi.stubEnv(IMPORT_PASSWORD_ENV, '');
    expect(() => resolveImportPassword()).toThrow(/未配置/);
  });

  it('密码过短时报错，与服务端的密码策略一致', () => {
    vi.stubEnv(IMPORT_PASSWORD_ENV, '12345');
    expect(() => resolveImportPassword()).toThrow(/至少需要 6 位/);
  });

  it('返回配置的值（允许前后空白被 trim 掉）', () => {
    vi.stubEnv(IMPORT_PASSWORD_ENV, '  Import@2026  ');
    expect(resolveImportPassword()).toBe('Import@2026');
  });
});

describe('buildUserExportFile', () => {
  it('导出仍带部门（只读资料）但不含密码，额外列导入时会被忽略', () => {
    const data = readBack(
      buildUserExportFile([
        {
          username: 'zhangsan',
          nickname: '张三',
          email: 'z@a.com',
          mobile: '13800138000',
          gender: 'male',
          departmentName: '技术部',
          roleNames: '普通用户、运营',
          status: 'disable',
          createTime: 1_700_000_000,
          lastLoginTime: 0,
          lastLoginIp: '',
        },
      ]),
    );

    expect(data[0]).toEqual([
      '账号',
      '昵称',
      '邮箱',
      '手机号',
      '性别',
      '部门',
      '角色',
      '状态',
      '注册时间',
      '最近登录',
      '最近登录 IP',
    ]);
    const row = data[1]!;
    expect(row[0]).toBe('zhangsan');
    expect(row[4]).toBe('男');
    expect(row[7]).toBe('停用');
    expect(row[9]).toBe(''); // 从未登录：留空，不印一个 1970
    expect(data[0]).not.toContain('密码');
  });
});

describe('normalizeImportStrategies', () => {
  it('缺省时全部走「跳过该行」+ 启用', () => {
    expect(normalizeImportStrategies(undefined)).toEqual({
      onUsername: 'skip',
      onEmail: 'skip',
      onMobile: 'skip',
      defaultStatus: 'enable',
    });
  });

  it('只接受白名单里的值，脏值退回默认', () => {
    expect(
      normalizeImportStrategies({
        onUsername: 'update',
        onEmail: 'abort',
        onMobile: '爆炸',
        defaultStatus: 'disable',
      }),
    ).toEqual({ onUsername: 'update', onEmail: 'abort', onMobile: 'skip', defaultStatus: 'disable' });
  });

  it('邮箱 / 手机不接受「修改数据」（那样等于把资料塞给另一个账号）', () => {
    expect(normalizeImportStrategies({ onEmail: 'update', onMobile: 'update' })).toMatchObject({
      onEmail: 'skip',
      onMobile: 'skip',
    });
  });
});
