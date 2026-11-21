/** 语言管理相关的数据形状（与 server/utils/auth/language-service.ts 对齐）。 */
export interface LanguageItem {
  id: number;
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
  status: number;
  /** 已填译文数 */
  translated: number;
  isDefault: boolean;
}

export interface LanguageOverview {
  languages: LanguageItem[];
  modules: string[];
  /** 词条总数 */
  total: number;
  /** 按类型分组的词条数 */
  entryCounts: Record<LanguageEntryType, number>;
}

/**
 * system = 项目内置语言文件导入的兜底词条（可改译文，不可删）；
 * custom = 后台手工新增。
 */
export type LanguageEntryType = 'system' | 'custom';

export interface LanguageEntryItem {
  id: number;
  key: string;
  module: string;
  type: LanguageEntryType;
  remark: string;
  /** lang code → 译文（空串表示未翻译） */
  values: Record<string, string>;
}

export interface LanguageEntryQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  module?: string;
  /** '' 或省略 = 全部类型 */
  type?: '' | LanguageEntryType;
}

export interface LanguageEntryResult {
  list: LanguageEntryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface LanguagePayload {
  id?: number;
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
  status: number;
}

export interface LanguageEntryPayload {
  id?: number;
  key: string;
  remark?: string;
  values: Record<string, string>;
}
