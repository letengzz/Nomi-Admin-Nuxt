<script setup lang="ts">
/**
 * 系统配置：左侧五个区块，右侧表单。
 *
 * 网站 / 安全 / 登录 / 邮件 / 存储五块都可编辑，每块独立「保存 + 恢复默认」。
 *
 * 配置读写都走接口：服务端按「区块 + 键」存，没改过的键回落到默认值，
 * 恢复默认就是删掉该区块的覆盖行，不在前端硬编码一份默认值当真相。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElSwitch,
} from 'element-plus';
import NomiIcon from '../../../components/layout/NomiIcon.vue';
import NomiLogo from '../../../components/layout/NomiLogo.vue';
import { useSiteStore } from '../../../stores/site';
import {
  EMPTY_SYSTEM_CONFIG,
  fetchSystemConfig,
  resetSystemConfig,
  saveSystemConfig,
  sendTestMail,
  uploadSiteImage,
  type ConfigSection,
  type SystemConfig,
} from '../../../services/system-config';

definePageMeta({ layout: 'admin', keepalive: true, pageFill: true });
defineOptions({ name: 'NomiAdminSystemSettings' });

const { t, te } = useI18n();
useHead({ title: computed(() => t('layout.menu.systemSettings')) });

const site = useSiteStore();

type EditableSection = ConfigSection;

const SECTIONS: readonly { key: ConfigSection; label: string; icon: string }[] = [
  { key: 'site', label: 'layout.systemConfig.sections.site', icon: 'settings' },
  { key: 'security', label: 'layout.systemConfig.sections.security', icon: 'shield' },
  { key: 'login', label: 'layout.systemConfig.sections.login', icon: 'user' },
  { key: 'email', label: 'layout.systemConfig.sections.email', icon: 'file' },
  { key: 'storage', label: 'layout.systemConfig.sections.storage', icon: 'grid' },
  { key: 'environment', label: 'layout.systemConfig.sections.environment', icon: 'monitor' },
  { key: 'seo', label: 'layout.systemConfig.sections.seo', icon: 'search' },
];

/** 三档环境的固定取值：顺序与配色都在这里，下拉与单选共用。 */
const ENV_OPTIONS = [
  { value: 'development', label: 'layout.systemConfig.environment.development' },
  { value: 'testing', label: 'layout.systemConfig.environment.testing' },
  { value: 'production', label: 'layout.systemConfig.environment.production' },
] as const;

const OG_TYPES = ['website', 'article', 'product', 'profile'] as const;

/**
 * 标题模板占位提示：把「当前站点名」填进去，比一句抽象的「请包含 %s」更好懂，
 * 用户照着这串现成的示例改就行。站点名读 store 而不是表单里的 site.name ——
 * 后者可能正被编辑成还没保存的值。
 */
const titleTemplatePlaceholder = computed(() => `%s | ${site.name}`);

const active = ref<ConfigSection>('site');
const loading = ref(false);
const saving = ref(false);
const form = reactive<SystemConfig>(structuredClone(EMPTY_SYSTEM_CONFIG));
// 预览图加载失败只影响这一格展示，不能把用户正在输入的地址悄悄清空。
const brokenPreview = reactive({ logo: false, favicon: false });
const fileInput = ref<HTMLInputElement | null>(null);
const uploadKind = ref<'logo' | 'favicon'>('logo');
const uploading = ref<'logo' | 'favicon' | null>(null);

/** 邮件自检：收件人默认填发件邮箱（给自己发一封最快能确认链路通不通）。 */
const testTo = ref('');
const testing = ref(false);

const activeMeta = computed(() => SECTIONS.find((item) => item.key === active.value)!);
const activeLabel = computed(() => t(activeMeta.value.label));

/** 「配置 {name} 已保存」这类带插值的文案统一从这里取，缺词条时退回通用提示。 */
function message(key: string, fallback: string, params?: Record<string, string>): string {
  const full = `layout.systemConfig.${key}`;
  return te(full) ? t(full, params ?? {}) : fallback;
}

function label(key: string): string {
  return t(`layout.systemConfig.${key}`);
}

/** 接口返回的是整份配置，一次覆盖全部区块：新增区块时只改这一处，不会漏字段。 */
function applyConfig(config: SystemConfig): void {
  form.site = config.site;
  form.security = config.security;
  form.login = config.login;
  form.email = config.email;
  form.storage = config.storage;
  form.environment = config.environment;
  form.seo = config.seo;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    applyConfig(await fetchSystemConfig());
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

/** 保存当前区块：只提交这一个区块，避免别的区块里没保存的草稿被顺手带上。 */
async function save(): Promise<void> {
  if (saving.value) return;
  const section = active.value as EditableSection;
  saving.value = true;
  try {
    applyConfig(await saveSystemConfig(section, form[section]));
    notifySiteUpdated(section);
    ElMessage.success(message('saved', '配置已保存'));
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

async function reset(): Promise<void> {
  if (saving.value) return;
  try {
    await ElMessageBox.confirm(
      message('resetConfirm', `确定恢复「${activeLabel.value}」的默认配置吗？`, { name: activeLabel.value }),
      label('resetTitle'),
      { type: 'warning' },
    );
  } catch {
    return;
  }
  const section = active.value as EditableSection;
  saving.value = true;
  try {
    applyConfig(await resetSystemConfig(section));
    notifySiteUpdated(section);
    ElMessage.success(message('resetDone', '已恢复默认配置'));
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

/**
 * 邮件自检：用**已保存**的配置发一封测试信。
 *
 * 未保存的草稿不参与 —— 否则等于把「填了一半的 SMTP 参数」直接往服务器上打，
 * 测出来的结果和真实运行时的行为也不一致。
 */
async function runTestMail(): Promise<void> {
  if (testing.value) return;
  const to = (testTo.value || form.email.fromAddress).trim();
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(to)) {
    ElMessage.warning(message('email.testAddressRequired', '请先填写收件地址'));
    return;
  }
  testing.value = true;
  try {
    await sendTestMail(to);
    ElMessage.success(message('email.testOk', '测试邮件已发送，请查收（含垃圾箱）'));
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    testing.value = false;
  }
}

/**
 * 品牌 / 环境 / SEO 三个区块都影响**全局外观**（标签页标题、角标、head），
 * 存完要让站点 store 重拉一次，否则要刷新才看得到效果。
 */
function notifySiteUpdated(section: ConfigSection): void {
  if (section === 'site' || section === 'environment' || section === 'seo') {
    window.dispatchEvent(new Event('nomi:site-updated'));
  }
}

/** 点预览卡 → 借隐藏的 input 选图 → 上传并立即保存这一个键。 */
function pickImage(kind: 'logo' | 'favicon'): void {
  uploadKind.value = kind;
  fileInput.value?.click();
}

async function onImageChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 清空 value，连续选同一张图也会重新触发 change。
  input.value = '';
  if (!file || uploading.value) return;
  await uploadImage(uploadKind.value, file);
}

async function uploadImage(kind: 'logo' | 'favicon', file: File): Promise<void> {
  uploading.value = kind;
  try {
    const url = await uploadSiteImage(kind, file);
    applyConfig(await saveSystemConfig('site', kind === 'logo' ? { logo: url } : { favicon: url }));
    brokenPreview[kind] = false;
    ElMessage.success(message('saved', '配置已保存'));
    window.dispatchEvent(new Event('nomi:site-updated'));
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    uploading.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-fill">
    <section class="page-content config-layout">
      <aside class="config-nav" :aria-label="t('layout.systemConfig.title')">
        <button
          v-for="item in SECTIONS"
          :key="item.key"
          type="button"
          class="config-nav-item"
          :class="{ 'is-active': active === item.key }"
          @click="active = item.key"
        >
          <NomiIcon :name="item.icon" :size="17" />
          <span>{{ t(item.label) }}</span>
        </button>
      </aside>

      <div class="config-main">
        <div class="config-head">
          <div class="config-heading">
            <h2>{{ activeLabel }}</h2>
            <p>{{ t(`layout.systemConfig.hints.${active}`) }}</p>
          </div>
          <div class="config-actions">
            <ElButton :disabled="loading || saving" @click="reset">{{ label('reset') }}</ElButton>
            <ElButton type="primary" :loading="saving" :disabled="loading" @click="save">
              {{ t('action.save') }}
            </ElButton>
          </div>
        </div>

        <div v-loading="loading" class="config-body">
          <!-- 网站配置 ------------------------------------------------------- -->
          <div v-if="active === 'site'" class="config-form">
            <input
              ref="fileInput"
              class="asset-file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,.ico"
              @change="onImageChange"
            />
            <div class="config-field">
              <label>{{ label('site.logo') }}</label>
              <button
                type="button"
                class="asset-picker"
                :disabled="loading || saving || uploading !== null"
                @click="pickImage('logo')"
              >
                <span class="asset-picker__preview preview-box preview-box--logo">
                  <img
                    v-if="form.site.logo && !brokenPreview.logo"
                    :src="form.site.logo"
                    alt="LOGO"
                    @error="brokenPreview.logo = true"
                  />
                  <NomiLogo v-else :size="30" />
                </span>
                <span class="asset-picker__text">
                  <strong>{{ uploading === 'logo' ? label('site.uploading') : label('site.clickToReplace') }}</strong>
                  <small>{{ label('site.logoHint') }}</small>
                </span>
                <NomiIcon name="upload" :size="16" />
              </button>
              <p class="config-tip">{{ label('site.uploadHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('site.favicon') }}</label>
              <button
                type="button"
                class="asset-picker"
                :disabled="loading || saving || uploading !== null"
                @click="pickImage('favicon')"
              >
                <span class="asset-picker__preview preview-box preview-box--icon">
                  <img
                    v-if="form.site.favicon && !brokenPreview.favicon"
                    :src="form.site.favicon"
                    alt="favicon"
                    @error="brokenPreview.favicon = true"
                  />
                  <img v-else src="/favicon.ico" alt="favicon" />
                </span>
                <span class="asset-picker__text">
                  <strong>{{ uploading === 'favicon' ? label('site.uploading') : label('site.clickToReplace') }}</strong>
                  <small>{{ label('site.faviconHint') }}</small>
                </span>
                <NomiIcon name="upload" :size="16" />
              </button>
              <p class="config-tip">{{ label('site.uploadHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('site.name') }}</label>
              <ElInput v-model="form.site.name" :placeholder="label('site.namePlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('site.description') }}</label>
              <ElInput v-model="form.site.description" type="textarea" :rows="3" :placeholder="label('site.descriptionPlaceholder')" />
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('site.copyrightEnabled') }}</label>
                <p class="config-tip">{{ label('site.copyrightEnabledHint') }}</p>
              </div>
              <ElSwitch v-model="form.site.copyrightEnabled" />
            </div>
            <div class="config-field">
              <label>{{ label('site.copyright') }}</label>
              <ElInput v-model="form.site.copyright" :placeholder="label('site.copyrightPlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('site.icp') }}</label>
              <ElInput v-model="form.site.icp" :placeholder="label('site.icpPlaceholder')" clearable />
            </div>
          </div>

          <!-- 安全配置 ------------------------------------------------------- -->
          <div v-else-if="active === 'security'" class="config-form config-form--grid">
            <div class="config-field">
              <label>{{ label('security.loginFailLimit') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.security.loginFailLimit" :min="1" :max="20" controls-position="right" />
                <span>{{ label('security.times') }}</span>
              </div>
            </div>
            <div class="config-field">
              <label>{{ label('security.lockMinutes') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.security.lockMinutes" :min="1" :max="1440" controls-position="right" />
                <span>{{ label('security.minutes') }}</span>
              </div>
            </div>
            <div class="config-field">
              <label>{{ label('security.passwordExpireDays') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.security.passwordExpireDays" :min="0" :max="3650" controls-position="right" />
                <span>{{ label('security.days') }}</span>
              </div>
              <p class="config-tip">{{ label('security.zeroNever') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('security.passwordExpireRemindDays') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.security.passwordExpireRemindDays" :min="0" :max="365" controls-position="right" />
                <span>{{ label('security.days') }}</span>
              </div>
            </div>
            <div class="config-field">
              <label>{{ label('security.passwordHistoryLimit') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.security.passwordHistoryLimit" :min="0" :max="20" controls-position="right" />
                <span>{{ label('security.times') }}</span>
              </div>
              <p class="config-tip">{{ label('security.zeroNever') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('security.passwordMinLength') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.security.passwordMinLength" :min="4" :max="64" controls-position="right" />
                <span>{{ label('security.chars') }}</span>
              </div>
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('security.allowPasswordUsername') }}</label>
                <p class="config-tip">{{ label('security.allowPasswordUsernameHint') }}</p>
              </div>
              <ElSwitch v-model="form.security.allowPasswordUsername" />
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('security.requireSpecialChar') }}</label>
                <p class="config-tip">{{ label('security.requireSpecialCharHint') }}</p>
              </div>
              <ElSwitch v-model="form.security.requireSpecialChar" />
            </div>
          </div>

          <!-- 登录配置 ------------------------------------------------------- -->
          <div v-else-if="active === 'login'" class="config-form">
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('login.captchaEnabled') }}</label>
                <p class="config-tip">{{ label('login.captchaHint') }}</p>
              </div>
              <ElSwitch v-model="form.login.captchaEnabled" />
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('login.maintenance') }}</label>
                <p class="config-tip">{{ label('login.maintenanceHint') }}</p>
              </div>
              <ElSwitch v-model="form.login.maintenanceEnabled" />
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('login.registration') }}</label>
                <p class="config-tip">{{ label('login.registrationHint') }}</p>
              </div>
              <ElSwitch v-model="form.login.registrationEnabled" />
            </div>
          </div>

          <!-- 邮件配置 ------------------------------------------------------- -->
          <div v-else-if="active === 'email'" class="config-form">
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('email.enabled') }}</label>
                <p class="config-tip">{{ label('email.enabledHint') }}</p>
              </div>
              <ElSwitch v-model="form.email.enabled" />
            </div>
            <div class="config-field">
              <label>{{ label('email.host') }}</label>
              <ElInput v-model="form.email.host" :placeholder="label('email.hostPlaceholder')" clearable />
            </div>
            <div class="config-form config-form--grid">
              <div class="config-field">
                <label>{{ label('email.port') }}</label>
                <div class="config-number">
                  <ElInputNumber v-model="form.email.port" :min="1" :max="65535" controls-position="right" />
                </div>
              </div>
              <div class="config-field">
                <label>{{ label('email.encryption') }}</label>
                <ElSelect v-model="form.email.encryption" class="config-select">
                  <ElOption value="ssl" :label="label('email.encryptionSsl')" />
                  <ElOption value="tls" :label="label('email.encryptionTls')" />
                  <ElOption value="none" :label="label('email.encryptionNone')" />
                </ElSelect>
              </div>
            </div>
            <div class="config-field">
              <label>{{ label('email.fromAddress') }}</label>
              <ElInput v-model="form.email.fromAddress" :placeholder="label('email.fromAddressPlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('email.fromName') }}</label>
              <ElInput v-model="form.email.fromName" :placeholder="label('email.fromNamePlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('email.username') }}</label>
              <ElInput v-model="form.email.username" :placeholder="label('email.usernamePlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('email.password') }}</label>
              <ElInput
                v-model="form.email.password"
                type="password"
                show-password
                :placeholder="label('email.passwordPlaceholder')"
                autocomplete="new-password"
              />
              <p class="config-tip">{{ label('email.passwordHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('email.testTo') }}</label>
              <div class="config-inline">
                <ElInput
                  v-model="testTo"
                  :placeholder="form.email.fromAddress || label('email.testToPlaceholder')"
                  clearable
                />
                <ElButton :loading="testing" :disabled="loading || saving" @click="runTestMail">
                  {{ label('email.testSend') }}
                </ElButton>
              </div>
              <p class="config-tip">{{ label('email.testHint') }}</p>
            </div>
          </div>

          <!-- 存储配置 ------------------------------------------------------- -->
          <div v-else-if="active === 'storage'" class="config-form">
            <div class="config-field">
              <label>{{ label('storage.driver') }}</label>
              <ElSelect v-model="form.storage.driver" class="config-select">
                <ElOption value="local" :label="label('storage.driverLocal')" />
                <ElOption value="oss" :label="label('storage.driverOss')" />
              </ElSelect>
              <p class="config-tip">{{ label('storage.driverHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('storage.localDir') }}</label>
              <ElInput v-model="form.storage.localDir" :placeholder="label('storage.localDirPlaceholder')" clearable />
              <p class="config-tip">{{ label('storage.localDirHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('storage.publicUrl') }}</label>
              <ElInput v-model="form.storage.publicUrl" :placeholder="label('storage.publicUrlPlaceholder')" clearable />
              <p class="config-tip">{{ label('storage.publicUrlHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('storage.maxFileSize') }}</label>
              <div class="config-number">
                <ElInputNumber v-model="form.storage.maxFileSize" :min="1" :max="1024" controls-position="right" />
                <span>{{ label('storage.megabytes') }}</span>
              </div>
            </div>
            <div class="config-field">
              <label>{{ label('storage.allowedExtensions') }}</label>
              <ElInput v-model="form.storage.allowedExtensions" type="textarea" :rows="3" :placeholder="label('storage.allowedExtensionsPlaceholder')" />
              <p class="config-tip">{{ label('storage.allowedExtensionsHint') }}</p>
            </div>
          </div>

          <!-- 环境配置 ------------------------------------------------------- -->
          <div v-else-if="active === 'environment'" class="config-form">
            <div class="config-field">
              <label>{{ label('environment.current') }}</label>
              <ElSelect v-model="form.environment.current" class="config-select">
                <ElOption
                  v-for="option in ENV_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                  :label="t(option.label)"
                />
              </ElSelect>
              <p class="config-tip">{{ label('environment.currentHint') }}</p>
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('environment.showBadge') }}</label>
                <p class="config-tip">{{ label('environment.showBadgeHint') }}</p>
              </div>
              <ElSwitch v-model="form.environment.showBadge" />
            </div>
            <div class="config-field">
              <label>{{ label('environment.devUrl') }}</label>
              <ElInput v-model="form.environment.devUrl" :placeholder="label('environment.devUrlPlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('environment.testUrl') }}</label>
              <ElInput v-model="form.environment.testUrl" :placeholder="label('environment.testUrlPlaceholder')" clearable />
            </div>
            <div class="config-field">
              <label>{{ label('environment.prodUrl') }}</label>
              <ElInput v-model="form.environment.prodUrl" :placeholder="label('environment.prodUrlPlaceholder')" clearable />
              <p class="config-tip">{{ label('environment.urlHint') }}</p>
            </div>
          </div>

          <!-- SEO 配置 ------------------------------------------------------ -->
          <div v-else class="config-form">
            <div class="config-field">
              <label>{{ label('seo.titleTemplate') }}</label>
              <ElInput v-model="form.seo.titleTemplate" :placeholder="titleTemplatePlaceholder" clearable />
              <p class="config-tip">{{ label('seo.titleTemplateHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('seo.description') }}</label>
              <ElInput v-model="form.seo.description" type="textarea" :rows="3" :placeholder="label('seo.descriptionPlaceholder')" />
              <p class="config-tip">{{ label('seo.descriptionHint') }}</p>
            </div>
            <div class="config-field">
              <label>{{ label('seo.keywords') }}</label>
              <ElInput v-model="form.seo.keywords" :placeholder="label('seo.keywordsPlaceholder')" clearable />
              <p class="config-tip">{{ label('seo.keywordsHint') }}</p>
            </div>
            <div class="config-form config-form--grid">
              <div class="config-field">
                <label>{{ label('seo.ogType') }}</label>
                <ElSelect v-model="form.seo.ogType" class="config-select">
                  <ElOption
                    v-for="type in OG_TYPES"
                    :key="type"
                    :value="type"
                    :label="label(`seo.ogType_${type}`)"
                  />
                </ElSelect>
              </div>
              <div class="config-field">
                <label>{{ label('seo.ogImage') }}</label>
                <ElInput v-model="form.seo.ogImage" :placeholder="label('seo.ogImagePlaceholder')" clearable />
              </div>
            </div>
            <div class="config-field">
              <label>{{ label('seo.canonicalBase') }}</label>
              <ElInput v-model="form.seo.canonicalBase" :placeholder="label('seo.canonicalBasePlaceholder')" clearable />
              <p class="config-tip">{{ label('seo.canonicalBaseHint') }}</p>
            </div>
            <div class="config-field config-field--switch">
              <div>
                <label>{{ label('seo.allowIndexing') }}</label>
                <p class="config-tip">{{ label('seo.allowIndexingHint') }}</p>
              </div>
              <ElSwitch v-model="form.seo.allowIndexing" />
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.config-layout {
  flex-direction: row;
  gap: 0;
}

.config-nav {
  display: flex;
  flex: 0 0 168px;
  flex-direction: column;
  gap: 4px;
  padding-right: 16px;
  border-right: 1px solid var(--nomi-border);
}

.config-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s, color 0.15s;
}

.config-nav-item:hover {
  background: var(--nomi-hover);
  color: var(--fg);
}

.config-nav-item.is-active {
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  color: var(--el-color-primary);
  font-weight: 600;
}

.config-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  padding-left: 24px;
}

.config-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.config-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.config-heading p {
  margin: 4px 0 0;
  color: var(--fg-muted);
  font-size: 12px;
}

.config-actions {
  display: flex;
  gap: 8px;
}

.config-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.config-form {
  display: flex;
  max-width: 760px;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 12px;
}

.config-form--grid {
  display: grid;
  max-width: 860px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 28px;
}

.config-field > label,
.config-field--switch label {
  display: block;
  margin-bottom: 8px;
  color: var(--fg);
  font-size: 13px;
  font-weight: 550;
}

.config-field--switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--nomi-border);
  border-radius: 8px;
}

.config-field--switch label {
  margin-bottom: 0;
}

.config-input-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.config-input-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.asset-file-input {
  display: none;
}

.asset-picker {
  display: flex;
  width: 100%;
  max-width: 520px;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--nomi-border);
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.asset-picker:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}

.asset-picker:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.asset-picker__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.asset-picker__text strong {
  font-size: 13px;
  font-weight: 550;
}

.asset-picker__text small {
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-picker :deep(svg) {
  flex-shrink: 0;
  color: var(--el-color-primary);
}

.preview-box {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px dashed var(--nomi-border);
  border-radius: 8px;
  background: var(--nomi-code-bg, #f6f7f9);
  color: var(--fg-muted);
  font-size: 11px;
}

.preview-box--logo {
  width: 96px;
  height: 32px;
  padding: 4px;
}

.preview-box--icon {
  width: 34px;
  height: 34px;
  padding: 4px;
}

.preview-box img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.config-number {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 「输入 + 按钮」同一行：自检收件人和触发按钮在视觉上是一件事，不该分两行。 */
.config-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-inline :deep(.el-input) {
  flex: 1 1 auto;
}

.config-select {
  width: 100%;
  max-width: 320px;
}

.config-tip {
  margin: 6px 0 0;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.config-field--switch .config-tip {
  margin-top: 4px;
}

@media (max-width: 800px) {
  .config-nav {
    flex-basis: 132px;
  }

  .config-main {
    padding-left: 16px;
  }
}

@media (max-width: 640px) {
  .config-layout {
    flex-direction: column;
  }

  .config-nav {
    flex: 0 0 auto;
    flex-direction: row;
    gap: 4px;
    overflow-x: auto;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--nomi-border);
  }

  .config-nav-item {
    flex: 0 0 auto;
  }

  .config-main {
    padding: 14px 0 0;
  }

  .config-form--grid {
    grid-template-columns: 1fr;
  }

  .config-input-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
