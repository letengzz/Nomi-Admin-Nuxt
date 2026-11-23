/**
 * 上传表格的准入检查（`server/utils/spreadsheet-guard.ts`）+ 解析器的规模上限。
 *
 * 这里造的是**结构**而不是内容：假 ZIP、假 OLE2、被改过的 `!ref`。
 * 目的不是证明「解析器安全」，而是证明「明显不该解析的输入不会进到解析器里」。
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  assertSpreadsheetReadable,
  detectSpreadsheetFormat,
  MAX_UNCOMPRESSED_BYTES,
} from '../server/utils/spreadsheet-guard';
import {
  buildUserImportTemplate,
  MAX_IMPORT_COLUMNS,
  parseUserImportFile,
} from '../server/utils/auth/user-import';

const HEADER = ['账号*', '密码*', '昵称', '邮箱', '手机号', '性别', '部门', '角色*', '状态'];

function xlsxBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '用户数据');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * 手工拼一个「只有骨架」的 ZIP：本地头 + 中央目录 + EOCD。
 *
 * `uncompressed` 就是中央目录里申报的解压后大小 —— 不需要真的塞入炸弹数据，
 * 因为守卫只看这份「报价单」，而真正的解压器同样会采信它。
 */
function skeletonZip(uncompressed: number, entries = 1): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const parts: Buffer[] = [Buffer.from('PK\x03\x04')];
  let size = 4;

  for (let index = 0; index < entries; index += 1) {
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    entry.writeUInt32LE(uncompressed, 24); // 解压后大小
    entry.writeUInt16LE(name.length, 28);
    name.copy(entry, 46);
    parts.push(entry);
    size += entry.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries, 8);
  eocd.writeUInt16LE(entries, 10);
  eocd.writeUInt32LE(size - 4, 12); // 中央目录字节数
  eocd.writeUInt32LE(4, 16); // 中央目录起始偏移
  parts.push(eocd);

  return Buffer.concat(parts);
}

describe('detectSpreadsheetFormat', () => {
  it('真实的 xlsx 认成 zip 容器', () => {
    expect(detectSpreadsheetFormat(xlsxBuffer([HEADER]))).toBe('xlsx');
  });

  it('BIFF8 的 xls 认成 OLE2 复合文档', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADER]), 'Sheet1');
    const legacy = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer;
    expect(detectSpreadsheetFormat(legacy)).toBe('xls');
  });

  it('纯文本 / 空字节 / HTML 伪装都不认', () => {
    expect(detectSpreadsheetFormat(Buffer.from('username,password\nfoo,bar'))).toBeNull();
    expect(detectSpreadsheetFormat(Buffer.alloc(0))).toBeNull();
    expect(detectSpreadsheetFormat(Buffer.from('<html><body>x</body></html>'))).toBeNull();
  });

  it('带着 ZIP 签名但不完整的文件会被判为损坏，而不是硬着头皮解析', () => {
    expect(detectSpreadsheetFormat(Buffer.from('PK\x03\x04'))).toBe('xlsx');
    expect(() => assertSpreadsheetReadable(Buffer.from('PK\x03\x04'))).toThrow(/损坏/);
  });
});

describe('assertSpreadsheetReadable', () => {
  it('解压后超过上限的 ZIP 在解析前就被拒（zip 炸弹）', () => {
    const bomb = skeletonZip(MAX_UNCOMPRESSED_BYTES + 1);
    expect(() => assertSpreadsheetReadable(bomb)).toThrow(/解压后超过/);
  });

  it('多个条目会累加，逐个都合规也可能整体超限', () => {
    const each = Math.floor(MAX_UNCOMPRESSED_BYTES / 2) + 1024;
    expect(() => assertSpreadsheetReadable(skeletonZip(each, 2))).toThrow(/解压后超过/);
  });

  it('申报 0xFFFFFFFF（ZIP64）按「过大」处理，而不是跳过统计', () => {
    expect(() => assertSpreadsheetReadable(skeletonZip(0xffffffff))).toThrow(/文件过大/);
  });

  it('条目数异常多直接拒绝', () => {
    const bomb = skeletonZip(1024, 5000);
    expect(() => assertSpreadsheetReadable(bomb)).toThrow(/结构异常/);
  });

  it('没有 EOCD 的截断 ZIP 被判为损坏', () => {
    expect(() => assertSpreadsheetReadable(Buffer.from('PK\x03\x04garbage'))).toThrow(/损坏/);
  });

  it('正常的 xlsx 放行', () => {
    expect(() => assertSpreadsheetReadable(xlsxBuffer([HEADER]))).not.toThrow();
  });
});

describe('parseUserImportFile 的规模上限', () => {
  it('非表格字节不会被送进解析器', () => {
    expect(() => parseUserImportFile(Buffer.from('这不是 Excel'))).toThrow(/文件解析失败/);
  });

  it('`!ref` 被改宽到超过列数上限时拒绝', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([HEADER, ['zhangsan', '123456', '', '', '', '', '', '普通用户', '']]);
    // 手工把范围撑到第 65 列（BM），模拟「右键插入了一堆空列」的表格
    sheet['!ref'] = `A1:BM2`;
    XLSX.utils.book_append_sheet(workbook, sheet, '用户数据');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    expect(() => parseUserImportFile(buffer)).toThrow(new RegExp(`列数过多`));
  });

  it('刚好等于列数上限时仍然可以解析', () => {
    const wide = [...HEADER, ...Array.from({ length: MAX_IMPORT_COLUMNS - HEADER.length }, () => '备注')];
    const row = ['zhangsan', '123456', '', '', '', '', '', '普通用户', '', ...Array(MAX_IMPORT_COLUMNS - HEADER.length).fill('')];
    expect(() => parseUserImportFile(xlsxBuffer([wide, row]))).not.toThrow();
  });

  it('超长单元格被截断，不会把整段文本带进后续校验', () => {
    const huge = 'a'.repeat(5000);
    const rows = parseUserImportFile(
      xlsxBuffer([HEADER, ['zhangsan', '123456', huge, '', '', '', '', '普通用户', '']]),
    );
    expect(rows[0]!.cells.nickname.length).toBe(512);
    // 截断后依然超过 50 字符上限，所以「昵称过长」仍然会报错 —— 行为没有被放过。
    expect(rows[0]!.cells.nickname.length).toBeGreaterThan(50);
  });

  it('模板文件（真实产出的 xlsx）仍然可以正常解析', () => {
    expect(() => parseUserImportFile(buildUserImportTemplate())).not.toThrow();
  });
});
