/** 语言管理接口封装。写操作统一走 `system/language/edit` 节点（见服务端注释）。 */
import { apiFetch } from '../utils/request';
import type {
  LanguageEntryPayload,
  LanguageEntryQuery,
  LanguageEntryResult,
  LanguageOverview,
  LanguagePayload,
} from '../types/language';

export function fetchLanguages(): Promise<LanguageOverview> {
  return apiFetch<LanguageOverview>('/api/admin/languages/list');
}

export function fetchLanguageEntries(
  query: LanguageEntryQuery = {},
): Promise<LanguageEntryResult> {
  return apiFetch<LanguageEntryResult>('/api/admin/languages/entries', {
    query: query as Record<string, unknown>,
  });
}

export function saveLanguage(payload: LanguagePayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/languages/save', {
    method: 'POST',
    body: payload,
  });
}

export function deleteLanguage(id: number): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/languages/del', {
    method: 'POST',
    body: { id },
  });
}

export function saveLanguageEntry(payload: LanguageEntryPayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/languages/entry', {
    method: 'POST',
    body: payload,
  });
}

export function deleteLanguageEntry(id: number): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/languages/entry-del', {
    method: 'POST',
    body: { id },
  });
}
