<script setup lang="ts">
/**
 * 授权页右上角工具条：7 个预设主色、中英切换、明暗切换、窄屏 Logo。
 * 「偏好先于身份」—— 未登录也能设置，配置持久化在 localStorage。
 */
import { computed, onMounted, ref } from 'vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus';
import { THEME_COLORS } from '../../utils/theme';
import NomiIcon from '../layout/NomiIcon.vue';
import NomiLogo from '../layout/NomiLogo.vue';
import { useSettingStore } from '../../stores/setting';
import { useSiteStore } from '../../stores/site';
import { useUserStore } from '../../stores/user';

const { locale, t } = useI18n();
const switchLocalePath = useSwitchLocalePath();
const setting = useSettingStore();
const site = useSiteStore();
const user = useUserStore();

// 主题偏好存在 localStorage，SSR 阶段拿不到：水合完成后再切换图标，避免 mismatch。
const hydrated = ref(false);
// 只驱动语言下拉的展开态视觉，不参与切换逻辑。
const languageOpen = ref(false);
onMounted(() => {
  hydrated.value = true;
});

const isDark = computed(() => hydrated.value && setting.isDark);
const currentColor = computed(() => (hydrated.value ? setting.themeColor : THEME_COLORS[0]));

const languageOptions = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
] as const;

type LocaleCode = (typeof languageOptions)[number]['value'];

async function changeLanguage(lang: LocaleCode): Promise<void> {
  if (locale.value === lang) return;
  user.setLanguage(lang);
  const path = switchLocalePath(lang);
  if (path) await navigateTo(path);
}

function changeThemeColor(color: string): void {
  setting.setThemeColor(color);
}
</script>

<template>
  <div class="auth-topbar">
    <div class="auth-topbar-brand">
      <!-- ArtLogo → NomiLogo：全站（含后台侧栏）共用同一枚品牌标记。 -->
      <NomiLogo :size="46" />
      <span>{{ site.name }}</span>
    </div>

    <div class="auth-tools">
      <div class="palette">
        <div class="palette-dots">
          <button
            v-for="(color, index) in THEME_COLORS"
            :key="color"
            type="button"
            class="palette-dot"
            :style="{ backgroundColor: color, '--dot-index': String(index) }"
            :aria-label="`${t('login.theme.palette')}: ${color}`"
            @click="changeThemeColor(color)"
          >
            <svg v-if="color === currentColor" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <button type="button" class="tool-btn" :aria-label="t('login.theme.palette')">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.8 1.8 0 0 1 1.4-2.9h1.4A3.5 3.5 0 0 0 21 11.3C20.6 6.8 16.8 3 12 3z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
            <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
            <circle cx="10" cy="7.5" r="1.2" fill="currentColor" />
            <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
          </svg>
        </button>
      </div>

      <ElDropdown @command="changeLanguage" @visible-change="languageOpen = $event">
        <button
          type="button"
          class="tool-btn"
          :class="{ 'is-active': languageOpen }"
          :aria-label="t('login.theme.language')"
        >
          <NomiIcon name="translate" :size="20" />
        </button>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="lang in languageOptions" :key="lang.value" :command="lang.value" :disabled="locale === lang.value">
              {{ lang.label }}
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>

      <button type="button" class="tool-btn" :aria-label="t('login.theme.dark')" @click="setting.toggleDark($event.currentTarget)">
        <svg v-if="isDark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M20 14.4A8.5 8.5 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.auth-topbar {
  position: absolute;
  z-index: 10;
  top: 18px;
  left: 0;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: flex-end;
}

.auth-topbar-brand {
  display: none;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
  font-size: 20px;
  font-weight: 500;
  color: var(--fg, #0f172a);
}

.auth-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
}

.tool-btn {
  --nomi-lang-secondary-opacity: 0.8;
  --nomi-lang-marker-opacity: 0;

  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--fg-muted, #64748b);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: color 0.3s ease, background-color 0.3s ease;
}

.tool-btn:hover,
.tool-btn.is-active {
  --nomi-lang-secondary-opacity: 1;

  color: var(--el-color-primary, #5d87ff);
  background: var(--bg-subtle, #f8fafc);
}

.tool-btn.is-active {
  --nomi-lang-marker-opacity: 1;
}

.palette {
  position: relative;
  display: flex;
  align-items: center;
}

.palette-dots {
  position: absolute;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 36px 8px 10px;
  background: color-mix(in srgb, var(--bg, #fff) 82%, transparent);
  border-radius: 999px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 12%);
  backdrop-filter: blur(10px);
  opacity: 0;
  pointer-events: none;
  transform: translateX(10px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.palette-dot {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgb(0 0 0 / 15%);
  cursor: pointer;
  opacity: 0;
  transform: translateX(20px) scale(0.8);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  transition-delay: calc(var(--dot-index) * 0.05s);
}

.palette:hover .palette-dots,
.palette:focus-within .palette-dots {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.palette:hover .palette-dot,
.palette:focus-within .palette-dot {
  opacity: 1;
  transform: translateX(0) scale(1);
}

.palette-dot:hover {
  transform: scale(1.15);
}

@media (max-width: 1180px) {
  .auth-topbar {
    justify-content: space-between;
  }

  .auth-topbar-brand {
    display: flex;
  }
}

@media (max-width: 640px) {
  .auth-topbar-brand {
    margin-left: 24px;
  }

  .auth-tools {
    margin-right: 20px;
  }

  .palette {
    display: none;
  }
}
</style>
