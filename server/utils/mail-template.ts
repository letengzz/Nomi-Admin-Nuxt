/**
 * 邮件正文模板。
 *
 * ## 为什么单独一个文件
 *
 * `mail.ts` 只该关心协议（EHLO / AUTH / DATA），一旦把 HTML 拼装塞进去，
 * 「怎么发」和「发什么」就缠在一起了：改个按钮颜色要读 SMTP 代码。
 * 这里只管产出 `{ subject, text, html }`，`mail.ts` 负责把它变成字节。
 *
 * ## 为什么是这种「上个时代」的写法
 *
 * 邮件客户端不是浏览器：没有 flex / grid，Outlook 走 Word 渲染引擎，
 * Gmail 会剥掉 `<style>` 和 `<head>` 里的大部分东西。所以：
 *   · 布局用 `<table role="presentation">`，不写 div + flex；
 *   · 关键样式全部内联，`<style>` 只放暗色模式这类「有就用、没有也不难看」的增强；
 *   · 不引外部 CSS、不引图片（logo 只有配了绝对地址才用），断网也不塌；
 *   · 宽度用 `max-width` + 百分比，手机上自然铺满。
 *
 * ## 安全
 *
 * 昵称、站点名、发件地址都是可以在后台改的，拼进 HTML 前一律转义。
 * 少一次转义就是一次「管理员改个昵称 → 全站收到带脚本的邮件」。
 */

/** 品牌信息。`logo` 只有是绝对 URL 时才会被渲染 —— 邮件里拿不到站点的相对路径。 */
export interface MailBrand {
  name: string;
  logo?: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const BRAND = {
  primary: '#00c16a',
  primaryDark: '#007f45',
  tint: '#effdf5',
  ink: '#111827',
  body: '#374151',
  muted: '#6b7280',
  line: '#e5e7eb',
  canvas: '#eef2f5',
  card: '#ffffff',
  warnBg: '#fffbeb',
  warnLine: '#fcd34d',
  warnInk: '#92400e',
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Roboto, Helvetica, Arial, sans-serif";
const MONO_STACK =
  "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace";

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** 只认绝对地址：相对路径在邮件里 100% 是坏图，宁可不显示也不给用户看空框。 */
function absoluteLogo(logo: string | undefined): string {
  const value = logo?.trim();
  if (!value) return '';
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : '';
}

/** 品牌头：有 logo 用 logo，没有就用首字母方块 —— 总比一行光秃秃的文字像样。 */
function brandHeader(brand: MailBrand): string {
  const name = escapeHtml(brand.name);
  const logo = absoluteLogo(brand.logo);
  const mark = logo
    ? `<img src="${escapeHtml(logo)}" alt="${name}" height="32" style="display:block;height:32px;max-height:32px;border:0;outline:none;text-decoration:none" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
         <td width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;background:${BRAND.primary};border-radius:10px;color:#ffffff;font:600 17px/34px ${FONT_STACK};text-align:center">${escapeHtml(
           (brand.name.trim()[0] ?? 'N').toUpperCase(),
         )}</td>
       </tr></table>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding:0 0 22px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle" style="padding-right:12px">${mark}</td>
            <td class="nomi-brand" valign="middle" style="font:600 16px/1.4 ${FONT_STACK};color:${BRAND.ink};letter-spacing:0.2px">${name}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

/**
 * 套一层外框：灰底 + 白卡片 + 顶部品牌色条 + 页脚。
 *
 * `preheader` 是收件箱列表里跟在标题后面的那段灰字（正文第一句），
 * 隐藏但必须存在，否则客户端会自己抓一句半截的 HTML 文案。
 */
function layout(options: {
  brand: MailBrand;
  title: string;
  preheader: string;
  content: string;
  footerNote: string;
}): string {
  const brandName = escapeHtml(options.brand.name);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(options.title)}</title>
<style>
  /* 只在支持的客户端生效；不支持时内联样式已经够看。 */
  @media (prefers-color-scheme: dark) {
    .nomi-canvas { background-color: #0b1220 !important; }
    .nomi-card { background-color: #151c2c !important; }
    .nomi-title, .nomi-brand { color: #f3f4f6 !important; }
    .nomi-text, .nomi-meta { color: #d1d5db !important; }
    .nomi-strong { color: #f3f4f6 !important; }
    .nomi-muted { color: #9ca3af !important; }
    .nomi-code { background-color: #10261d !important; color: #6ee7b7 !important; border-color: #1f6b4a !important; }
    /* 数字必须跟着反色：深蓝字压在深绿底上就是「看不见验证码」 */
    .nomi-code-text, .nomi-code-label { color: #6ee7b7 !important; }
    .nomi-chip { background-color: #10261d !important; color: #6ee7b7 !important; }
    .nomi-divider { background-color: #24303f !important; }
    .nomi-warn { background-color: #2a2110 !important; color: #fcd34d !important; }
  }
  a { text-decoration: none; }
  @media only screen and (max-width: 620px) {
    .nomi-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .nomi-code-text { font-size: 28px !important; letter-spacing: 6px !important; }
  }
</style>
</head>
<body class="nomi-canvas" style="margin:0;padding:0;width:100%;height:100%;background-color:${BRAND.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(options.preheader)}</div>
  <table class="nomi-canvas" role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas}">
    <tr>
      <td align="center" valign="top" style="padding:32px 12px">
        <!-- 限宽必须放在 div 上：给 table 同时写 width:100% 和 max-width 时，
             定宽的自适应算法会先按 max-content 排版，手机上就横着溢出了。
             div + margin:0 auto 是 MJML 同款写法，Outlook 忽略 max-width 时退化为满宽，可接受。 -->
        <div style="width:100%;max-width:560px;margin:0 auto">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td class="nomi-card" style="background-color:${BRAND.card};border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.08)">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td height="4" style="height:4px;line-height:4px;font-size:0;background-color:${BRAND.primary}">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="nomi-pad" style="padding:28px 32px 32px 32px">
                    ${brandHeader(options.brand)}
                    <div class="nomi-title" style="font:600 20px/1.4 ${FONT_STACK};color:${BRAND.ink};padding:0 0 6px 0">${escapeHtml(options.title)}</div>
                    ${options.content}
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="nomi-divider" height="1" style="height:1px;line-height:1px;font-size:0;background-color:${BRAND.line}">&nbsp;</td>
                </tr>
                <tr>
                  <td class="nomi-pad" style="padding:16px 32px 22px 32px">
                    <div class="nomi-muted" style="font:400 12px/1.7 ${FONT_STACK};color:${BRAND.muted}">${escapeHtml(options.footerNote)}</div>
                    <div class="nomi-muted" style="font:400 12px/1.7 ${FONT_STACK};color:${BRAND.muted};padding-top:4px">此邮件由 ${brandName} 系统自动发送，请勿直接回复。</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" class="nomi-muted" style="padding:16px 8px 0 8px;font:400 11px/1.6 ${FONT_STACK};color:${BRAND.muted}">${brandName}</td>
          </tr>
        </table>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** 一行「标签 / 值」，用来放请求时间、登录账号这类次要信息。 */
function metaRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:5px 0;font:400 13px/1.6 ${FONT_STACK};color:${BRAND.muted};white-space:nowrap" width="88">${escapeHtml(label)}</td>
    <td class="nomi-meta" style="padding:5px 0;font:400 13px/1.6 ${FONT_STACK};color:${BRAND.body}">${escapeHtml(value)}</td>
  </tr>`;
}

export interface CodeMailOptions {
  brand: MailBrand;
  /** 收件人的称呼，优先昵称，其次登录名。 */
  recipient: string;
  code: string;
  /** 验证码有效期（分钟）。 */
  minutes: number;
  /** 登录账号，写进邮件方便用户核对「这是给我的信」。 */
  account: string;
  /** 请求时间，默认当前时间（北京时间口径由调用方决定）。 */
  requestedAt?: string;
}

/**
 * 找回密码验证码邮件。
 *
 * 设计上只做一件事：**让人一眼看到那 6 位数字**。所以正文极简 ——
 * 没有营销语、没有多余按钮、只有一个验证码框。链接一个都不放，
 * 因为它既不是必要功能，也会立刻把「是不是钓鱼」这个问题摆到用户面前。
 */
export function renderResetCodeMail(options: CodeMailOptions): RenderedMail {
  const brandName = options.brand.name;
  const greetingName = options.recipient.trim() || options.account;
  const code = options.code.replace(/\s+/g, '');
  const requestedAt = options.requestedAt ?? new Date().toLocaleString('zh-CN', { hour12: false });
  const digits = code.split('').join(' ');

  const subject = `重置密码验证码 - ${brandName}`;

  const text = [
    `${greetingName}，您好：`,
    '',
    `我们收到了重置 ${brandName} 登录密码的请求，验证码：${code}`,
    `该验证码 ${options.minutes} 分钟内有效，只能使用一次。`,
    '',
    `登录账号：${options.account}`,
    `请求时间：${requestedAt}`,
    '',
    '如果这不是您本人的操作，请忽略本邮件 —— 您的密码不会被修改。',
    '',
    `（本邮件由 ${brandName} 系统自动发送，请勿直接回复）`,
  ].join('\r\n');

  const content = `
    <div class="nomi-text" style="font:400 14px/1.8 ${FONT_STACK};color:${BRAND.body};padding:4px 0 18px 0">
      ${escapeHtml(greetingName)}，您好：<br />
      我们收到了重置 <strong class="nomi-strong" style="color:${BRAND.ink}">${escapeHtml(brandName)}</strong> 登录密码的请求，请在页面中输入下面的验证码完成验证。
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="nomi-code" align="center" style="padding:22px 16px;background-color:${BRAND.tint};border:1px dashed #86efac;border-radius:12px">
          <div class="nomi-code-label" style="font:400 11px/1.4 ${FONT_STACK};color:${BRAND.primaryDark};letter-spacing:2px;text-align:center;padding:0 0 8px 2px">验证码</div>
          <div class="nomi-code-text" style="font:700 34px/1.1 ${MONO_STACK};color:#0f172a;letter-spacing:10px;text-align:center;padding-left:10px">${escapeHtml(digits)}</div>
          <div class="nomi-muted" style="font:400 12px/1.5 ${FONT_STACK};color:${BRAND.muted};padding-top:10px">${options.minutes} 分钟内有效 · 仅可使用一次</div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding-top:18px">
      ${metaRow('登录账号', options.account)}
      ${metaRow('请求时间', requestedAt)}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px">
      <tr>
        <td class="nomi-warn" style="padding:12px 14px;background-color:${BRAND.warnBg};border-left:3px solid ${BRAND.warnLine};border-radius:6px;font:400 12px/1.7 ${FONT_STACK};color:${BRAND.warnInk}">
          如果这不是您本人的操作，请忽略本邮件 —— 您的密码不会被修改。
        </td>
      </tr>
    </table>
  `;

  return {
    subject,
    text,
    html: layout({
      brand: options.brand,
      title: '重置登录密码',
      preheader: `您的验证码是 ${code}，${options.minutes} 分钟内有效。`,
      content,
      footerNote: '为保障账号安全，请勿将验证码以任何方式告知他人，包括自称客服或管理员的人。',
    }),
  };
}

export interface TestMailOptions {
  brand: MailBrand;
  host: string;
  port: number;
  encryption: string;
  fromAddress: string;
  sentAt?: string;
}

/** 配置自检邮件：告诉管理员「这封是刚才点的按钮发的，参数是这些」。 */
export function renderTestMail(options: TestMailOptions): RenderedMail {
  const brandName = options.brand.name;
  const sentAt = options.sentAt ?? new Date().toLocaleString('zh-CN', { hour12: false });

  const subject = `${brandName} 邮件配置自检`;

  const text = [
    '这是一封邮件配置自检邮件。',
    '',
    `发信服务器：${options.host}:${options.port}（${options.encryption}）`,
    `发件地址：${options.fromAddress}`,
    `发送时间：${sentAt}`,
    '',
    '收到本邮件说明 SMTP 配置可用，找回密码的验证码也能正常投递。',
    `（本邮件由 ${brandName} 系统自动发送，请勿直接回复）`,
  ].join('\r\n');

  const content = `
    <div class="nomi-text" style="font:400 14px/1.8 ${FONT_STACK};color:${BRAND.body};padding:4px 0 16px 0">
      这是一封配置自检邮件。收到它，说明 SMTP 参数可用，找回密码的验证码也能正常投递。
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px">
      <tr>
        <td class="nomi-chip" style="padding:6px 12px;background-color:${BRAND.tint};border-radius:999px;font:600 12px/1.4 ${FONT_STACK};color:${BRAND.primaryDark}">● 配置可用</td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${metaRow('发信服务器', `${options.host}:${options.port}`)}
      ${metaRow('加密方式', options.encryption.toUpperCase())}
      ${metaRow('发件地址', options.fromAddress)}
      ${metaRow('发送时间', sentAt)}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px">
      <tr>
        <td class="nomi-warn" style="padding:12px 14px;background-color:${BRAND.warnBg};border-left:3px solid ${BRAND.warnLine};border-radius:6px;font:400 12px/1.7 ${FONT_STACK};color:${BRAND.warnInk}">
          若您并未在后台点击「发送测试邮件」，请检查发件账号的密码或授权码是否泄露。
        </td>
      </tr>
    </table>
  `;

  return {
    subject,
    text,
    html: layout({
      brand: options.brand,
      title: '邮件配置自检',
      preheader: `SMTP ${options.host}:${options.port} 配置可用。`,
      content,
      footerNote: `本邮件用于验证发信通道，不含任何账号操作入口。`,
    }),
  };
}
