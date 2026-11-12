<script setup lang="ts">
/**
 * 首页：模板的能力索引，用最少的元素说明「这是什么」和「接下来去哪」。
 *
 * 纪律：
 *   ① 只用 app/assets/styles 里的 CSS 变量与 UnoCSS，不写死颜色 —— 否则切到
 *      暗色模式时这里会留一块白底；
 *   ② 不承载业务。真正的业务从 app/pages/admin/ 开始长。
 */
import { APP_VERSION } from '../utils/version';

const { t } = useI18n();
const { appName } = useRuntimeConfig().public;

const stack = [
  'Nuxt 4',
  'Vue 3',
  'TypeScript',
  'Element Plus',
  'Pinia',
  'UnoCSS',
  'Sass',
  'Nuxt i18n',
  'Vitest',
];

const entries = [
  { file: 'nuxt.config.ts', key: 'config' },
  { file: 'app/app.vue', key: 'app' },
  { file: 'app/plugins/', key: 'plugins' },
] as const;

useHead({ title: computed(() => `${appName} · ${t('home.badge')}`) });
</script>

<template>
  <main class="home">
    <div class="home-head">
      <span class="badge">{{ t('home.badge') }}</span>
      <span class="version">v{{ APP_VERSION }}</span>
    </div>

    <h1>{{ appName }}</h1>
    <p class="lead">{{ t('home.lead') }}</p>

    <div class="actions">
      <NuxtLink class="btn btn-primary" to="/login">{{ t('home.ctaLogin') }}</NuxtLink>
      <!-- 不写成链接：/api/health 是 Nitro 路由而不是页面路由，链过去只会拿到 JSON -->
      <code class="endpoint">{{ t('home.ctaHealth') }} · /api/health</code>
    </div>

    <section>
      <h2>{{ t('home.stackTitle') }}</h2>
      <ul class="chips">
        <li v-for="item in stack" :key="item">{{ item }}</li>
      </ul>
    </section>

    <section>
      <h2>{{ t('home.entryTitle') }}</h2>
      <dl class="entries">
        <template v-for="entry in entries" :key="entry.file">
          <dt><code>{{ entry.file }}</code></dt>
          <dd>{{ t(`home.entry.${entry.key}`) }}</dd>
        </template>
      </dl>
    </section>
  </main>
</template>

<style scoped>
.home {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--sp-8) var(--sp-4);
}

.home-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.badge {
  padding: 2px var(--sp-2);
  font-size: var(--text-sm);
  color: var(--brand-700);
  background: color-mix(in srgb, var(--brand-500) 14%, transparent);
  border-radius: 999px;
}

.version {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}

h1 {
  margin: var(--sp-3) 0 var(--sp-2);
  font-size: 2.25rem;
}

.lead {
  max-width: 60ch;
  color: var(--fg-muted);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--text-sm);
  color: var(--fg);
  text-decoration: none;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s var(--ease), background-color 0.15s var(--ease);
}

.btn:hover {
  border-color: var(--brand-600);
}

.btn-primary {
  color: #fff;
  background: var(--brand-600);
  border-color: var(--brand-600);
}

.btn-primary:hover {
  background: var(--brand-700);
  border-color: var(--brand-700);
}

.endpoint {
  display: inline-flex;
  align-items: center;
  padding: var(--sp-2) var(--sp-3);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

section {
  margin-top: var(--sp-8);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.chips li {
  padding: 2px var(--sp-2);
  font-size: var(--text-sm);
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.entries {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sp-2) var(--sp-4);
  margin: 0;
}

.entries dt code {
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.entries dd {
  margin: 0;
  color: var(--fg-muted);
}

@media (max-width: 640px) {
  h1 {
    font-size: 1.75rem;
  }

  .entries {
    grid-template-columns: 1fr;
    gap: var(--sp-1);
  }

  .entries dd {
    margin-bottom: var(--sp-3);
  }
}
</style>
