<script setup lang="ts">
/**
 * 通知公告管理列表：标题 / 分类 / 定时发布 / 置顶 / 通知方式 / 通知范围。
 *
 * 新增与编辑已拆成独立页面（/admin/notice/create、/admin/notice/edit/:id），
 * 本页只负责筛选、列表与删除；列表口径与服务端 notice-service.ts 一致：
 *   · 定时发布是秒级时间戳，0 = 立即；到点才对铃铛可见；
 *   · 通知范围选部门/角色时，scopeIds 是目标 id 数组，列表里展开成名称展示。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { usePermission } from '../../../composables/usePermission';
import {
  deleteNotice,
  fetchDepartments,
  fetchNotices,
  fetchRoles,
  type NoticeQuery,
} from '../../../services/permission';
import type { DepartmentItem, NoticeCategory, NoticeItem, RoleItem } from '../../../types/permission';
import { formatDateTime } from '../../../utils/format';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiAdminNotices' });

const { t } = useI18n();
const localePath = useLocalePath();
const { auth } = usePermission();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('auth.notice.title')) });

const loading = ref(false);
const list = ref<NoticeItem[]>([]);
const departments = ref<DepartmentItem[]>([]);
const roles = ref<RoleItem[]>([]);

const query = reactive<NoticeQuery>({ keyword: '', category: '', status: undefined, published: undefined });

const CATEGORY_OPTIONS = [
  { value: 'notice', labelKey: 'auth.notice.categoryNotice' },
  { value: 'bulletin', labelKey: 'auth.notice.categoryBulletin' },
  { value: 'activity', labelKey: 'auth.notice.categoryActivity' },
];
const METHOD_OPTIONS = [
  { value: 'internal', labelKey: 'auth.notice.methodInternal' },
  { value: 'email', labelKey: 'auth.notice.methodEmail' },
  { value: 'sms', labelKey: 'auth.notice.methodSms' },
];

function optionLabel(labelKey: string): string {
  return t(labelKey);
}

const departmentName = (id: number): string =>
  departments.value.find((d) => d.id === id)?.name ?? String(id);
const roleName = (id: number): string =>
  roles.value.find((r) => r.id === id)?.name ?? String(id);

function scopeText(row: NoticeItem): string {
  if (row.notifyScope === 'all') return t('auth.notice.scopeAll');
  const names = row.scopeIds.map((id) =>
    row.notifyScope === 'department' ? departmentName(id) : roleName(id),
  );
  return names.length > 2 ? `${names.slice(0, 2).join('、')} +${names.length - 2}` : names.join('、');
}

const CATEGORY_TAG: Record<NoticeCategory, 'primary' | 'success' | 'warning'> = {
  notice: 'primary',
  bulletin: 'success',
  activity: 'warning',
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [result, deptResult, roleResult] = await Promise.all([
      fetchNotices({
        keyword: query.keyword || undefined,
        category: query.category || undefined,
        status: query.status,
        published: query.published,
      }),
      fetchDepartments().catch(() => ({ list: [], total: 0 })),
      fetchRoles().catch(() => ({ list: [], total: 0, super: false })),
    ]);
    list.value = result.list;
    departments.value = deptResult.list;
    roles.value = roleResult.list;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  void navigateTo(localePath('/admin/notice/create'));
}

function openEdit(row: NoticeItem): void {
  void navigateTo(localePath(`/admin/notice/edit/${row.id}`));
}

async function remove(raw: unknown): Promise<void> {
  const row = raw as NoticeItem;
  const confirmed = await ElMessageBox.confirm(
    `${t('auth.common.confirmDelete')}\n${row.title}`,
    t('auth.notice.title'),
    {
      type: 'warning',
      confirmButtonText: t('auth.action.delete'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;
  try {
    await deleteNotice(row.id);
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function resetQuery(): void {
  query.keyword = '';
  query.category = '';
  query.status = undefined;
  query.published = undefined;
  void load();
}

onMounted(load);
</script>

<template>
  <div class="page-fill">
    <section class="page-content">
      <div class="nomi-page-toolbar">
        <span class="summary">{{ t('auth.notice.title') }} · {{ list.length }}</span>
        <ElButton v-if="auth('add')" type="primary" class="toolbar-add" @click="openCreate">
          {{ t('auth.notice.add') }}
        </ElButton>
      </div>

      <div class="notice-filter">
        <ElInput
          v-model="query.keyword"
          :placeholder="t('auth.notice.keywordPlaceholder')"
          clearable
          class="filter-input"
          @keyup.enter="load"
        />
        <ElSelect v-model="query.category" :placeholder="t('auth.notice.category')" clearable class="filter-select">
          <ElOption v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value" :label="optionLabel(opt.labelKey)" />
        </ElSelect>
        <ElSelect v-model="query.status" :placeholder="t('auth.common.status')" clearable class="filter-select">
          <ElOption :value="1" :label="t('auth.user.enableShort')" />
          <ElOption :value="0" :label="t('auth.user.disableShort')" />
        </ElSelect>
        <ElSelect v-model="query.published" :placeholder="t('auth.notice.publishState')" clearable class="filter-select">
          <ElOption :value="true" :label="t('auth.notice.published')" />
          <ElOption :value="false" :label="t('auth.notice.scheduled')" />
        </ElSelect>
        <ElButton @click="load">{{ t('auth.action.search') }}</ElButton>
        <ElButton @click="resetQuery">{{ t('auth.action.reset') }}</ElButton>
      </div>

      <div ref="tableWrap" class="nomi-table-fill">
        <ElTable
          v-loading="loading"
          :height="tableHeight"
          :data="list"
          border
          :empty-text="t('auth.notice.empty')"
        >
          <ElTableColumn prop="title" :label="t('auth.notice.title')" :min-width="isMobile ? 180 : 240">
            <template #default="{ row }">
              <span class="notice-title">
                <ElTag v-if="row.isTop" size="small" type="danger" effect="plain">{{ t('auth.notice.top') }}</ElTag>
                {{ row.title }}
              </span>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('auth.notice.category')" :width="isNarrow ? 90 : 110">
            <template #default="{ row }">
              <ElTag size="small" :type="CATEGORY_TAG[row.category as NoticeCategory]">
                {{ optionLabel(CATEGORY_OPTIONS.find((o) => o.value === row.category)?.labelKey ?? 'auth.notice.categoryNotice') }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" :label="t('auth.notice.notifyMethod')" :width="110">
            <template #default="{ row }">
              {{ optionLabel(METHOD_OPTIONS.find((o) => o.value === row.notifyMethod)?.labelKey ?? 'auth.notice.methodInternal') }}
            </template>
          </ElTableColumn>
          <ElTableColumn v-if="!isNarrow" :label="t('auth.notice.notifyScope')" :min-width="150">
            <template #default="{ row }">{{ scopeText(row as NoticeItem) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('auth.notice.publishState')" :width="isNarrow ? 100 : 170">
            <template #default="{ row }">
              <ElTag size="small" :type="row.published ? 'success' : 'warning'" effect="plain">
                {{ row.published ? t('auth.notice.published') : t('auth.notice.scheduled') }}
              </ElTag>
              <div v-if="!row.published && !isNarrow" class="notice-time">{{ formatDateTime(row.publishTime) }}</div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('auth.common.status')" :width="isNarrow ? 84 : 100">
            <template #default="{ row }">
              <ElTag size="small" :type="row.status === 1 ? 'success' : 'info'" effect="plain">
                {{ row.status === 1 ? t('auth.user.enableShort') : t('auth.user.disableShort') }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('auth.common.actions')" :width="isNarrow ? 110 : 160" fixed="right">
            <template #default="{ row }">
              <ElButton v-if="auth('edit')" link type="primary" size="small" @click="openEdit(row as NoticeItem)">
                {{ t('auth.action.edit') }}
              </ElButton>
              <ElButton v-if="auth('del')" link type="danger" size="small" @click="remove(row)">
                {{ t('auth.action.delete') }}
              </ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notice-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.filter-input {
  width: 220px;
}

.filter-select {
  width: 150px;
}

.notice-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.notice-time {
  margin-top: 2px;
  color: var(--fg-muted);
  font-size: 11px;
}
</style>
