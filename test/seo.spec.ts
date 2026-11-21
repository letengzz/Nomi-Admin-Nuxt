/**
 * SEO head 纯计算单测。
 *
 * 这些规则一旦错了，表现是「标签页标题少了半句」或者「canonical 指到别人域名」，
 * 在页面上肉眼不容易发现，只有搜索引擎收录跑偏了才暴露。所以把它钉在单测里。
 */
import { describe, expect, it } from 'vitest';
import {
  buildSeoMeta,
  resolveDescription,
  resolveKeywords,
  resolveRobots,
  resolveSiteUrl,
  resolveTitleTemplate,
} from '../shared/utils/seo';

describe('resolveTitleTemplate', () => {
  it('留空时回落到「页面标题 | 站点名」', () => {
    expect(resolveTitleTemplate('', 'Nomi Admin')).toBe('%s | Nomi Admin');
    expect(resolveTitleTemplate('   ', 'Nomi Admin')).toBe('%s | Nomi Admin');
  });

  it('含 %s 时原样使用，顺序由配置决定', () => {
    expect(resolveTitleTemplate('%s - 管理台', 'X')).toBe('%s - 管理台');
    expect(resolveTitleTemplate('管理台 %s', 'X')).toBe('管理台 %s');
  });

  it('不含 %s 时当后缀补全，避免页面标题被整段吞掉', () => {
    expect(resolveTitleTemplate('Nomi Admin', 'X')).toBe('%s | Nomi Admin');
  });
});

describe('resolveDescription / resolveKeywords', () => {
  it('SEO 描述优先，没填才用站点描述', () => {
    expect(resolveDescription('SEO 描述', '站点描述')).toBe('SEO 描述');
    expect(resolveDescription('', '站点描述')).toBe('站点描述');
    expect(resolveDescription('  ', '  ')).toBe('');
  });

  it('关键词按逗号整理并丢掉空项', () => {
    expect(resolveKeywords(' 中后台 , 管理后台,,Nuxt ')).toBe('中后台, 管理后台, Nuxt');
    expect(resolveKeywords('')).toBe('');
  });
});

describe('resolveSiteUrl', () => {
  it('优先规范域名', () => {
    expect(resolveSiteUrl('https://www.example.com', 'https://dev.example.com')).toBe(
      'https://www.example.com',
    );
  });

  it('没有规范域名时回落到环境地址', () => {
    expect(resolveSiteUrl('', 'https://dev.example.com')).toBe('https://dev.example.com');
  });

  it('去掉末尾多余斜杠（它后面还要拼路径）', () => {
    expect(resolveSiteUrl('https://www.example.com/', '')).toBe('https://www.example.com');
    expect(resolveSiteUrl('https://www.example.com///', '')).toBe('https://www.example.com');
  });

  it('都没配置、或填的不是绝对地址时返回空串，交给 site-config 的原值', () => {
    expect(resolveSiteUrl('', '')).toBe('');
    expect(resolveSiteUrl('www.example.com', '')).toBe('');
    expect(resolveSiteUrl('/admin', '')).toBe('');
  });
});

describe('resolveRobots', () => {
  it('允许收录给 index, follow，关闭时连链接也不跟', () => {
    expect(resolveRobots(true)).toBe('index, follow');
    expect(resolveRobots(false)).toBe('noindex, nofollow');
  });
});

describe('buildSeoMeta', () => {
  const base = {
    description: '',
    keywords: '',
    ogImage: '',
    ogType: 'website',
    allowIndexing: false,
    siteName: 'Nomi Admin',
    siteDescription: '基于 Nuxt 4 的企业级中后台模板',
  };

  it('robots 与 og:type / og:site_name 始终输出，描述回落到站点描述', () => {
    const tags = buildSeoMeta(base);
    const byName = (key: 'name' | 'property', value: string) =>
      tags.find((tag) => tag[key] === value)?.content;

    expect(byName('name', 'robots')).toBe('noindex, nofollow');
    expect(byName('property', 'og:type')).toBe('website');
    expect(byName('property', 'og:site_name')).toBe('Nomi Admin');
    expect(byName('name', 'description')).toBe('基于 Nuxt 4 的企业级中后台模板');
    expect(byName('property', 'og:description')).toBe('基于 Nuxt 4 的企业级中后台模板');
  });

  it('空值不输出成 content="" 的废标签', () => {
    const tags = buildSeoMeta({ ...base, siteDescription: '' });
    expect(tags.some((tag) => tag.name === 'description')).toBe(false);
    expect(tags.some((tag) => tag.property === 'og:image')).toBe(false);
    expect(tags.some((tag) => tag.name === 'keywords')).toBe(false);
  });

  it('填了关键词与分享图就带上', () => {
    const tags = buildSeoMeta({ ...base, keywords: 'a, b', ogImage: 'https://cdn/og.png' });
    expect(tags.find((tag) => tag.name === 'keywords')?.content).toBe('a, b');
    expect(tags.find((tag) => tag.property === 'og:image')?.content).toBe('https://cdn/og.png');
  });
});
