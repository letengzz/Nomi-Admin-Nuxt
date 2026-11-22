/**
 * 把服务端回来的 base64 文件存到本地。
 *
 * 为什么要绕这一圈：管理端所有接口都走 `{ code, msg, data }` 信封，
 * 二进制流会变成唯一的例外（前端要分两条解析路径，出错也没法统一提示）。
 * 表格文件只有几百 KB，base64 的额外开销换来的是「下载失败也能弹出人话」。
 */
import type { SpreadsheetFile } from '../types/permission';

export function saveBase64File(file: SpreadsheetFile): void {
  if (!import.meta.client) return;

  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const blob = new Blob([bytes], { type: file.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName || 'download';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立刻 revoke 在部分浏览器上会把下载掐断，推迟一拍更稳。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
