/**
 * SEO head 的纯计算。
 *
 * 为什么单独抽出来：这些规则（模板里没有 %s 怎么办、canonical 用哪个域名兜底、
 * 关掉收录时 robots 写什么）全是「输入确定 → 输出确定」的判断，放进 app.vue
 * 就只能靠手点页面验证。抽成纯函数后可以直接单测，组件那边只负责把结果交给
 * unhead。
 */

/** SEO 相关字段的来源：站点配置 + 当前环境地址。 */
export interface SeoHeadSource {
  /** 系统配置 seo.description，为空时回落到站点描述。 */
  description: string;
  keywords: string;
  ogImage: string;
  ogType: string;
  allowIndexing: boolean;
  /** site.name / site.description，作为兜底来源。 */
  siteName: string;
  siteDescription: string;
}

/**
 * 标题模板归一化。
 *
 * - 空 → `%s | 站点名`（保持原有观感，页面自己的 title 在前）
 * - 含 %s → 原样用，调用方自己决定顺序
 * - 不含 %s → 当成「后缀」处理，补成 `%s | 后缀`
 *
 * 第三种情况是刻意的：模板里没有占位符时，页面标题会被整段吞掉，标签页全变成
 * 同一个名字 —— 那比「多加一根竖线」难查得多。
 */
export function resolveTitleTemplate(raw: string | undefined | null, siteName: string): string {
  const template = (raw ?? '').trim();
  if (!template) return `%s | ${siteName}`;
  if (template.includes('%s')) return template;
  return `%s | ${template}`;
}

/** 描述：SEO 专用描述优先，没填就用站点描述；都没有则返回空串（不输出 meta）。 */
export function resolveDescription(seoDescription: string, siteDescription: string): string {
  return (seoDescription || '').trim() || (siteDescription || '').trim();
}

/** keywords 是逗号分隔的字符串，顺手清掉空项与多余空白。 */
export function resolveKeywords(raw: string): string {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * 规范域名归一化。
 *
 * 优先用 seo.canonicalBase（正式域名），其次当前环境的访问地址；两个都没配就
 * 返回空串 —— 交给调用方决定「保持原样」，而不是自己猜一个域名。
 *
 * 只接受 http(s) 绝对地址：写成 `www.example.com` 或 `/admin` 这种相对形式时
 * 返回空串。拼错协议头的域名若被当成 canonical，等于告诉搜索引擎「这一页属于
 * 另一个地方」，比不设置危害大得多。
 */
export function resolveSiteUrl(canonicalBase: string, envUrl: string): string {
  const base = (canonicalBase || envUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!/^https?:\/\/[^/]+/i.test(base)) return '';
  return base;
}

/** robots：关闭收录时给最严格的一档，别只写 noindex 却让爬虫照样跟进链接。 */
export function resolveRobots(allowIndexing: boolean): string {
  return allowIndexing ? 'index, follow' : 'noindex, nofollow';
}

/**
 * meta 标签用「二选一」的联合类型，而不是 `name?` + `property?` 都可选：
 * unhead 的 ResolvableMeta 要求每条至少能确定是 name 还是 property，
 * 两个都可选时它没法收窄，整块 head 会在类型检查阶段报错。
 */
export type SeoMetaTag =
  | { name: string; content: string }
  | { property: string; content: string };

/** 汇总成一组 meta 标签；空值一律不输出，避免页面里挂着 `content=""` 的废标签。 */
export function buildSeoMeta(source: SeoHeadSource): SeoMetaTag[] {
  const tags: SeoMetaTag[] = [{ name: 'robots', content: resolveRobots(source.allowIndexing) }];

  const description = resolveDescription(source.description, source.siteDescription);
  if (description) tags.push({ name: 'description', content: description });

  const keywords = resolveKeywords(source.keywords);
  if (keywords) tags.push({ name: 'keywords', content: keywords });

  const ogType = (source.ogType || 'website').trim() || 'website';
  tags.push({ property: 'og:type', content: ogType });
  tags.push({ property: 'og:site_name', content: source.siteName });
  if (description) tags.push({ property: 'og:description', content: description });

  const ogImage = (source.ogImage || '').trim();
  if (ogImage) tags.push({ property: 'og:image', content: ogImage });

  return tags;
}
