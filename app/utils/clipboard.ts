/**
 * 复制到剪贴板。
 *
 * `navigator.clipboard` 只在安全上下文（https / localhost）里可用，
 * 局域网 IP 调试、内网 http 部署时它是 undefined —— 这时退回到
 * 隐藏 textarea + `execCommand('copy')`，虽然老但仍然是唯一可行的路子。
 *
 * 返回是否成功，由调用方决定提示文案（成功/失败的处理各页面不同）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (import.meta.client && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒（Safari 需要用户手势、http 页面等）→ 走兜底
    }
  }

  if (!import.meta.client) return false;

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
