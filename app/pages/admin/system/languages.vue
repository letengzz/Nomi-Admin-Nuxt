<script setup lang="ts">
/**
 * 语言管理：左边语言、右边词条。
 *
 * 词条是从项目的 zh/en.json 全量导入到数据库的（迁移
 * `2026-11-15-import-language-entries`），这里改完以后会派发
 * `nomi:i18n-updated`，由 app/plugins/i18n-runtime.ts 合并进运行时 i18n，
 * 不需要重新构建或刷新整页。静态语言文件始终是兜底。
 *
 * 词条分两类（`type`）：
 *   system —— 内置语言文件导入的，是页面文案的兜底，能改译文、不能删；
 *   custom —— 后台手工新增，随便改删。
 * 语言可以随时新增，所以「译文」在表单里是一份可增删的行列表（语言 + 内容），
 * 而不是按 zh/en 写死的固定输入框。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { usePermission } from '../../../composables/usePermission';
import NomiFieldTip from '../../../components/layout/NomiFieldTip.vue';
import {
  deleteLanguage,
  deleteLanguageEntry,
  fetchLanguageEntries,
  fetchLanguages,
  saveLanguage,
  saveLanguageEntry,
} from '../../../services/language';
import type {
  LanguageEntryItem,
  LanguageEntryType,
  LanguageItem,
} from '../../../types/language';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiAdminLanguages' });

const { t } = useI18n();
const { auth } = usePermission();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('auth.language.title')) });

const loading = ref(false);
const languages = ref<LanguageItem[]>([]);
const modules = ref<string[]>([]);
const entryCounts = ref<Record<LanguageEntryType, number>>({ system: 0, custom: 0 });
const entries = ref<LanguageEntryItem[]>([]);
/** 当前筛选命中的条数（分页用） */
const total = ref(0);
/** 全库词条总数：语言完成度的分母，不随筛选变化 */
const allEntries = ref(0);
const page = ref(1);
const limit = ref(10);
const keyword = ref('');
const moduleFilter = ref('');
const typeFilter = ref<'' | LanguageEntryType>('');
const currentLang = ref('');

const enabledLanguages = computed(() => languages.value.filter((lang) => lang.status === 1));

/** 窄屏只展示当前语言的译文列；若当前语言被停用则回落到第一个启用语言。 */
const mobileLanguageColumn = computed(() =>
  enabledLanguages.value.some((lang) => lang.code === currentLang.value)
    ? currentLang.value
    : (enabledLanguages.value[0]?.code ?? ''),
);

/** 保存后通知运行时插件重新合并译文，页面文案立即生效。 */
function notifyI18nUpdated(): void {
  if (import.meta.client) window.dispatchEvent(new CustomEvent('nomi:i18n-updated'));
}

function typeLabel(type: LanguageEntryType): string {
  return type === 'system' ? t('auth.language.typeSystem') : t('auth.language.typeCustom');
}

async function loadOverview(): Promise<void> {
  const result = await fetchLanguages();
  languages.value = result.languages;
  modules.value = result.modules;
  allEntries.value = result.total;
  entryCounts.value = result.entryCounts ?? { system: 0, custom: 0 };
  if (!languages.value.some((lang) => lang.code === currentLang.value)) {
    currentLang.value = languages.value[0]?.code ?? '';
  }
}

async function loadEntries(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchLanguageEntries({
      page: page.value,
      limit: limit.value,
      keyword: keyword.value,
      module: moduleFilter.value,
      type: typeFilter.value,
    });
    entries.value = result.list;
    total.value = result.total;
    if (result.list.length === 0 && result.total > 0 && page.value > 1) {
      page.value -= 1;
      await loadEntries();
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function reloadAll(): Promise<void> {
  await loadOverview();
  await loadEntries();
}

function search(): void {
  page.value = 1;
  void loadEntries();
}

function resetFilter(): void {
  keyword.value = '';
  moduleFilter.value = '';
  typeFilter.value = '';
  page.value = 1;
  void loadEntries();
}

function translatedText(lang: LanguageItem): string {
  return t('auth.language.translated', { done: lang.translated, total: allEntries.value });
}

// --- 词条 --------------------------------------------------------------------
interface ValueRow {
  code: string;
  value: string;
}

const entryDialog = ref(false);
const entrySubmitting = ref(false);
const editingEntryId = ref(0);
const editingEntryType = ref<LanguageEntryType>('custom');
const entryForm = reactive<{ key: string; remark: string; rows: ValueRow[] }>({
  key: '',
  remark: '',
  rows: [],
});

/** 模块取词条键的第一段：新增时随输入实时推导，和服务端入库规则一致。 */
const entryModule = computed(() => entryForm.key.split('.')[0] ?? '');

const usedCodes = computed(() => new Set(entryForm.rows.map((row) => row.code)));
/** 还没进列表的语言：全部进完了就把「添加语言」按钮置灰 */
const addableLanguages = computed(() =>
  languages.value.filter((lang) => !usedCodes.value.has(lang.code)),
);

/** 当前行已选的语言要留在自己的下拉里，否则下拉一开就看不到自己。 */
function languageOptions(current: string): LanguageItem[] {
  return languages.value.filter(
    (lang) => lang.code === current || !usedCodes.value.has(lang.code),
  );
}

function openEntry(raw?: unknown): void {
  // ElTable 的 slot row 是 DefaultRow，统一在这里收窄，别让模板承担类型断言。
  const row = raw as LanguageEntryItem | undefined;
  editingEntryId.value = row?.id ?? 0;
  editingEntryType.value = row?.type ?? 'custom';
  entryForm.key = row?.key ?? '';
  entryForm.remark = row?.remark ?? '';
  // 启用的语言先铺好行（打开就能填）；停用但已有译文的也带上，别把数据藏起来。
  entryForm.rows = languages.value
    .filter((lang) => lang.status === 1 || Boolean(row?.values?.[lang.code]))
    .map((lang) => ({ code: lang.code, value: row?.values?.[lang.code] ?? '' }));
  entryDialog.value = true;
}

function addValueRow(): void {
  const next = addableLanguages.value[0];
  if (!next) {
    ElMessage.info(t('auth.language.noValueLanguage'));
    return;
  }
  entryForm.rows.push({ code: next.code, value: '' });
}

function removeValueRow(index: number): void {
  entryForm.rows.splice(index, 1);
}

async function submitEntry(): Promise<void> {
  const key = entryForm.key.trim();
  if (!key) {
    ElMessage.warning(t('auth.language.key'));
    return;
  }
  if (usedCodes.value.size !== entryForm.rows.length) {
    ElMessage.warning(t('auth.language.duplicateLanguage'));
    return;
  }
  const values: Record<string, string> = {};
  for (const row of entryForm.rows) {
    if (!row.code) continue;
    values[row.code] = row.value;
  }
  entrySubmitting.value = true;
  try {
    await saveLanguageEntry({
      id: editingEntryId.value || undefined,
      key,
      remark: entryForm.remark,
      values,
    });
    ElMessage.success(t('auth.common.success'));
    entryDialog.value = false;
    await reloadAll();
    notifyI18nUpdated();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    entrySubmitting.value = false;
  }
}

async function removeEntry(raw: unknown): Promise<void> {
  const row = raw as LanguageEntryItem;
  if (row.type === 'system') {
    ElMessage.warning(t('auth.language.systemLocked'));
    return;
  }
  const confirmed = await ElMessageBox.confirm(
    `${t('auth.language.deleteEntry')}\n${row.key}`,
    t('auth.language.title'),
    {
      type: 'warning',
      confirmButtonText: t('auth.action.delete'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;
  try {
    await deleteLanguageEntry(row.id);
    ElMessage.success(t('auth.common.success'));
    await reloadAll();
    notifyI18nUpdated();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

// --- 语言 --------------------------------------------------------------------
const langDialog = ref(false);
const langSubmitting = ref(false);
const editingLangId = ref(0);
const langForm = reactive({
  code: '',
  name: '',
  nativeName: '',
  weigh: 0,
  status: 1,
});

function openLanguage(row?: LanguageItem): void {
  editingLangId.value = row?.id ?? 0;
  Object.assign(langForm, {
    code: row?.code ?? '',
    name: row?.name ?? '',
    nativeName: row?.nativeName ?? '',
    weigh: row?.weigh ?? 0,
    status: row?.status ?? 1,
  });
  langDialog.value = true;
}

async function submitLanguage(): Promise<void> {
  if (!langForm.code.trim() || !langForm.name.trim()) {
    ElMessage.warning(t('auth.language.languageName'));
    return;
  }
  langSubmitting.value = true;
  try {
    await saveLanguage({
      id: editingLangId.value || undefined,
      code: langForm.code.trim().toLowerCase(),
      name: langForm.name.trim(),
      nativeName: langForm.nativeName.trim() || langForm.name.trim(),
      weigh: Number(langForm.weigh) || 0,
      status: langForm.status,
    });
    ElMessage.success(t('auth.common.success'));
    langDialog.value = false;
    await reloadAll();
    notifyI18nUpdated();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    langSubmitting.value = false;
  }
}

async function toggleLanguage(row: LanguageItem, enable: boolean): Promise<void> {
  try {
    await saveLanguage({
      id: row.id,
      code: row.code,
      name: row.name,
      nativeName: row.nativeName,
      weigh: row.weigh,
      status: enable ? 1 : 0,
    });
    ElMessage.success(t('auth.common.success'));
    await reloadAll();
    notifyI18nUpdated();
  } catch (error) {
    ElMessage.error((error as Error).message);
    await reloadAll();
  }
}

async function removeLanguage(row: LanguageItem): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `${t('auth.language.deleteLanguage')}\n${row.name}`,
    t('auth.language.title'),
    {
      type: 'warning',
      confirmButtonText: t('auth.action.delete'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;
  try {
    await deleteLanguage(row.id);
    ElMessage.success(t('auth.common.success'));
    await reloadAll();
    notifyI18nUpdated();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function syncFrontend(): void {
  notifyI18nUpdated();
  ElMessage.success(t('auth.language.syncSuccess'));
}

onMounted(reloadAll);
</script>

<template>
  <div class="page-fill">
    <section class="page-content">
      <!-- 语言的唯一入口说明：启停与译文都即时生效，避免再有人去改 nuxt.config -->
      <ElAlert
        class="language-tip"
        type="info"
        :closable="false"
        show-icon
        :title="t('auth.language.syncTip')"
      />
      <div v-loading="loading" class="language-layout">
        <!-- 左：语言列表 -->
        <aside class="language-side">
          <div class="language-side-toolbar">
            <span class="side-title">{{ t('auth.language.languages') }}</span>
            <ElButton v-if="auth('add')" type="primary" size="small" @click="openLanguage()">
              {{ t('auth.language.addLanguage') }}
            </ElButton>
          </div>
          <div class="language-side-list">
            <div
              v-for="lang in languages"
              :key="lang.id"
              class="language-item"
              :class="{ 'is-active': currentLang === lang.code }"
              @click="currentLang = lang.code"
            >
              <div class="lang-line">
                <span class="lang-name">{{ lang.name }}</span>
                <ElTag v-if="lang.isDefault" size="small" type="info">
                  {{ t('auth.language.defaultLanguage') }}
                </ElTag>
                <ElTag v-else-if="lang.status === 0" size="small" type="danger">
                  {{ t('auth.common.disabled') }}
                </ElTag>
              </div>
              <div class="lang-meta">
                <code>{{ lang.code }}</code>
                <span>{{ translatedText(lang) }}</span>
              </div>
              <div class="lang-actions" @click.stop>
                <ElSwitch
                  :model-value="lang.status === 1"
                  size="small"
                  inline-prompt
                  :active-text="t('auth.user.enableShort')"
                  :inactive-text="t('auth.user.disableShort')"
                  style="--el-switch-off-color: var(--el-color-danger)"
                  :disabled="!auth('edit') || lang.isDefault"
                  :title="lang.isDefault ? t('auth.language.defaultLocked') : undefined"
                  @change="(value: string | number | boolean) => toggleLanguage(lang, Boolean(value))"
                />
                <ElButton v-if="auth('edit')" link type="primary" @click="openLanguage(lang)">
                  {{ t('auth.action.edit') }}
                </ElButton>
                <ElButton
                  v-if="auth('del') && !lang.isDefault"
                  link
                  type="danger"
                  @click="removeLanguage(lang)"
                >
                  {{ t('auth.action.delete') }}
                </ElButton>
              </div>
            </div>
          </div>
        </aside>

        <!-- 右：词条 -->
        <div class="language-main">
          <div class="toolbar">
            <ElInput
              v-model="keyword"
              class="toolbar-search"
              :placeholder="t('auth.language.search')"
              clearable
              @keyup.enter="search"
              @clear="search"
            />
            <ElSelect
              v-model="moduleFilter"
              class="toolbar-module"
              clearable
              :placeholder="t('auth.language.module')"
              @change="search"
            >
              <ElOption :label="t('auth.language.moduleAll')" value="" />
              <ElOption v-for="item in modules" :key="item" :label="item" :value="item" />
            </ElSelect>
            <ElSelect
              v-model="typeFilter"
              class="toolbar-type"
              :placeholder="t('auth.language.typeAll')"
              @change="search"
            >
              <ElOption :label="t('auth.language.typeAll')" value="" />
              <ElOption
                :label="`${t('auth.language.typeSystem')} (${entryCounts.system})`"
                value="system"
              />
              <ElOption
                :label="`${t('auth.language.typeCustom')} (${entryCounts.custom})`"
                value="custom"
              />
            </ElSelect>
            <ElButton type="primary" @click="search">{{ t('auth.action.search') }}</ElButton>
            <ElButton @click="resetFilter">{{ t('auth.action.reset') }}</ElButton>
            <ElButton v-if="auth('add')" class="toolbar-add" type="primary" @click="openEntry()">
              {{ t('auth.language.addEntry') }}
            </ElButton>
            <ElButton @click="syncFrontend">{{ t('auth.language.syncFrontend') }}</ElButton>
          </div>

          <div ref="tableWrap" class="nomi-table-fill">
            <ElTable :data="entries" :height="tableHeight" row-key="id" border stripe>
              <ElTableColumn
                prop="key"
                :label="t('auth.language.key')"
                :min-width="isMobile ? 160 : 230"
                :fixed="isMobile ? false : 'left'"
                show-overflow-tooltip
              />
              <ElTableColumn
                v-if="!isMobile"
                prop="module"
                :label="t('auth.language.module')"
                width="110"
              />
              <ElTableColumn v-if="!isNarrow" :label="t('auth.language.type')" width="100">
                <template #default="{ row }">
                  <ElTag :type="row.type === 'system' ? 'info' : 'success'" size="small" effect="light">
                    {{ typeLabel(row.type) }}
                  </ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn
                v-for="lang in isMobile
                  ? enabledLanguages.filter((l) => l.code === mobileLanguageColumn)
                  : enabledLanguages"
                :key="lang.code"
                :label="`${lang.name} (${lang.code})`"
                :min-width="isNarrow ? 180 : 200"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  <span :class="{ 'lang-missing': !row.values[lang.code] }">
                    {{ row.values[lang.code] || t('auth.language.missing') }}
                  </span>
                </template>
              </ElTableColumn>
              <ElTableColumn
                :label="t('auth.common.actions')"
                :width="isNarrow ? 100 : 140"
                :fixed="isMobile ? false : 'right'"
              >
                <template #default="{ row }">
                  <ElButton v-if="auth('edit')" link type="primary" @click="openEntry(row)">
                    {{ t('auth.action.edit') }}
                  </ElButton>
                  <ElButton
                    v-if="auth('del')"
                    link
                    type="danger"
                    :disabled="row.type === 'system'"
                    :title="row.type === 'system' ? t('auth.language.systemLocked') : undefined"
                    @click="removeEntry(row)"
                  >
                    {{ t('auth.action.delete') }}
                  </ElButton>
                </template>
              </ElTableColumn>
            </ElTable>
          </div>

          <div class="pager">
            <ElPagination
              v-model:current-page="page"
              :page-size="limit"
              :total="total"
              layout="total, prev, pager, next"
              background
              @current-change="loadEntries"
            />
            <span class="hint">{{ t('auth.language.entriesTotal', { total }) }}</span>
          </div>
        </div>
      </div>

      <!-- 词条编辑：译文是一份可增删的语言行列表 -->
      <ElDialog
        v-model="entryDialog"
        :title="editingEntryId ? t('auth.language.editEntry') : t('auth.language.addEntry')"
        width="720px"
        destroy-on-close
      >
        <ElForm class="tip-form" label-width="92px">
          <ElFormItem>
            <template #label>
              <span class="form-label">
                {{ t('auth.language.key') }}
                <NomiFieldTip :content="t('auth.language.keyHint')" />
              </span>
            </template>
            <ElInput v-model="entryForm.key" :disabled="editingEntryId > 0" />
          </ElFormItem>
          <ElFormItem>
            <template #label>
              <span class="form-label">
                {{ t('auth.language.module') }}
                <NomiFieldTip :content="t('auth.language.moduleHint')" />
              </span>
            </template>
            <ElTag size="small" effect="plain">{{ entryModule || '—' }}</ElTag>
          </ElFormItem>
          <ElFormItem>
            <template #label>
              <span class="form-label">
                {{ t('auth.language.type') }}
                <NomiFieldTip
                  v-if="editingEntryType === 'system'"
                  :content="t('auth.language.systemLocked')"
                />
              </span>
            </template>
            <ElTag :type="editingEntryType === 'system' ? 'info' : 'success'" size="small" effect="light">
              {{ typeLabel(editingEntryType) }}
            </ElTag>
          </ElFormItem>
          <ElFormItem :label="t('auth.language.remark')">
            <ElInput v-model="entryForm.remark" maxlength="255" show-word-limit />
          </ElFormItem>
          <ElFormItem>
            <template #label>
              <span class="form-label">
                {{ t('auth.language.values') }}
                <NomiFieldTip :content="t('auth.language.valuesHint')" />
              </span>
            </template>
            <div class="value-list">
              <div v-for="(row, index) in entryForm.rows" :key="index" class="value-row">
                <ElSelect v-model="row.code" class="value-lang">
                  <ElOption
                    v-for="lang in languageOptions(row.code)"
                    :key="lang.code"
                    :label="`${lang.name} (${lang.code})`"
                    :value="lang.code"
                  />
                </ElSelect>
                <ElInput
                  v-model="row.value"
                  type="textarea"
                  :rows="2"
                  :placeholder="t('auth.language.missing')"
                />
                <ElButton
                  link
                  type="danger"
                  :title="t('auth.language.removeValue')"
                  @click="removeValueRow(index)"
                >
                  {{ t('auth.action.delete') }}
                </ElButton>
              </div>
              <ElButton
                class="value-add"
                :disabled="addableLanguages.length === 0"
                @click="addValueRow"
              >
                {{ t('auth.language.addValue') }}
              </ElButton>
            </div>
          </ElFormItem>
        </ElForm>
        <p class="hint dialog-hint">{{ t('auth.language.entryHint') }}</p>
        <template #footer>
          <ElButton @click="entryDialog = false">{{ t('auth.common.cancel') }}</ElButton>
          <ElButton type="primary" :loading="entrySubmitting" @click="submitEntry">
            {{ t('auth.common.save') }}
          </ElButton>
        </template>
      </ElDialog>

      <!-- 语言编辑 -->
      <ElDialog
        v-model="langDialog"
        :title="editingLangId ? t('auth.language.editLanguage') : t('auth.language.addLanguage')"
        width="520px"
        destroy-on-close
      >
        <ElForm class="tip-form" label-width="110px">
          <ElFormItem>
            <template #label>
              <span class="form-label">
                {{ t('auth.language.languageCode') }}
                <NomiFieldTip :content="t('auth.language.codeHint')" />
              </span>
            </template>
            <ElInput v-model="langForm.code" :disabled="editingLangId > 0" />
          </ElFormItem>
          <ElFormItem :label="t('auth.language.languageName')">
            <ElInput v-model="langForm.name" />
          </ElFormItem>
          <ElFormItem :label="t('auth.language.nativeName')">
            <ElInput v-model="langForm.nativeName" />
          </ElFormItem>
          <ElFormItem :label="t('auth.language.weigh')">
            <ElInputNumber v-model="langForm.weigh" :min="0" :max="9999" controls-position="right" />
          </ElFormItem>
          <ElFormItem :label="t('auth.common.status')">
            <ElSwitch
              v-model="langForm.status"
              :active-value="1"
              :inactive-value="0"
              inline-prompt
              :active-text="t('auth.user.enableShort')"
              :inactive-text="t('auth.user.disableShort')"
              style="--el-switch-off-color: var(--el-color-danger)"
              :disabled="languages.some((lang) => lang.id === editingLangId && lang.isDefault)"
            />
          </ElFormItem>
        </ElForm>
        <template #footer>
          <ElButton @click="langDialog = false">{{ t('auth.common.cancel') }}</ElButton>
          <ElButton type="primary" :loading="langSubmitting" @click="submitLanguage">
            {{ t('auth.common.save') }}
          </ElButton>
        </template>
      </ElDialog>
    </section>
  </div>
</template>

<style scoped>
.language-tip {
  flex: 0 0 auto;
  margin-bottom: 12px;
}

.language-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
}

.language-side,
.language-main {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.language-side {
  width: 280px;
  flex: 0 0 280px;
  overflow: hidden;
  border: 1px solid var(--nomi-border, var(--el-border-color-lighter));
  border-radius: 0;
  background: var(--el-bg-color);
}

.language-side-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--nomi-border, var(--el-border-color-lighter));
}

.side-title {
  font-weight: 600;
}

.language-side-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.language-item {
  padding: 10px 12px;
  border-radius: 0;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.language-item + .language-item {
  border-top: 1px solid var(--nomi-border, var(--el-border-color-lighter));
}

.language-item:hover {
  background: var(--nomi-hover, var(--el-fill-color-light));
}

.language-item.is-active {
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}

.lang-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.lang-name {
  font-weight: 600;
}

.lang-meta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 12px;
}

.lang-meta code {
  color: var(--el-color-primary);
}

.lang-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.language-main {
  flex: 1;
  min-width: 0;
}

.toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

.toolbar-search {
  width: 180px;
}

.toolbar-module {
  width: 118px;
}

.toolbar-type {
  width: 132px;
}

/* 不再把「新增词条」推到最右：那会在中等宽度下把后面的按钮挤到第二行 */
.toolbar-add {
  margin-left: 4px;
}

.pager {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}

.lang-missing {
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-style: italic;
}

.hint {
  flex: 0 0 100%;
  width: 100%;
  margin: 4px 0 0;
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 12px;
  line-height: 1.5;
}

.dialog-hint {
  margin-top: 6px;
}

.value-list {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
}

.value-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.value-lang {
  width: 150px;
  flex: 0 0 150px;
}

.value-row :deep(.el-textarea) {
  flex: 1;
}

.value-row .el-button {
  flex: 0 0 auto;
  margin-top: 6px;
}

.value-add {
  align-self: flex-start;
}

@media (max-width: 900px) {
  .language-layout {
    flex-direction: column;
  }

  .language-side {
    width: 100%;
    flex: 0 0 auto;
    max-height: 220px;
  }

  .toolbar-search,
  .toolbar-module,
  .toolbar-type {
    width: 100%;
  }

  .value-row {
    flex-wrap: wrap;
  }

  .value-lang {
    width: 100%;
    flex: 1 1 100%;
  }
}

@media (max-width: 640px) {
  .language-side {
    max-height: 180px;
  }

  .language-side-toolbar {
    padding: 10px;
  }

  .lang-actions {
    flex-wrap: wrap;
    gap: 4px;
  }

  .pager {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
