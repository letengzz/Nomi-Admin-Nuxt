/**
 * 把 i18n/locales/*.json 的扁平词条导出成服务端种子文件。
 *
 * 为什么需要它：语言管理的词条存在数据库里，但项目首次启动时数据库是空的，
 * 必须有一份「不依赖运行时读文件」的初始数据 —— 生产构建后 i18n 目录不一定还在。
 * 以后改了 zh/en.json，跑 `pnpm lang:sync` 重新生成即可（迁移会用 INSERT IGNORE 补新 key）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const zh = JSON.parse(readFileSync(`${root}/i18n/locales/zh.json`, 'utf-8'));
const en = JSON.parse(readFileSync(`${root}/i18n/locales/en.json`, 'utf-8'));

function flatten(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out.set(path, String(value ?? ''));
  }
  return out;
}

const zhFlat = flatten(zh);
const enFlat = flatten(en);
const keys = [...new Set([...zhFlat.keys(), ...enFlat.keys()])].sort();
// 项目的 ESLint 用单引号，生成物也得跟着走；JSON.stringify 会给双引号。
const str = (value) =>
  `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;

const lines = keys.map((key) => {
  const module = key.split('.')[0] ?? '';
  return `  { key: ${str(key)}, module: ${str(module)}, zh: ${str(zhFlat.get(key) ?? '')}, en: ${str(enFlat.get(key) ?? '')} },`;
});

const content = `/**
 * 由 scripts/sync-language-seed.mjs 生成，请勿手改。
 * 来源：i18n/locales/zh.json + en.json（共 ${keys.length} 个词条）。
 * 运行 \`pnpm lang:sync\` 重新生成。
 */
export interface LanguageEntrySeed {
  /** 点分路径，如 auth.user.title */
  key: string;
  /** 第一段，用于页面按模块筛选 */
  module: string;
  zh: string;
  en: string;
}

export const LANGUAGE_ENTRY_SEEDS: readonly LanguageEntrySeed[] = [
${lines.join('\n')}
];
`;

writeFileSync(`${root}/server/database/language-seed.ts`, content, 'utf-8');
console.log(`已生成 server/database/language-seed.ts：${keys.length} 个词条`);
