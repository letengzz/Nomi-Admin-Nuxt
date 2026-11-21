<script setup lang="ts">
/**
 * 公告表单（新增 / 编辑共用），供独立页面调用。
 *
 * 从原列表弹窗原样迁移，字段口径与服务端 notice-service.ts 保持一致：
 *   · 分类 notice/bulletin/activity、方式 internal/email/sms、范围 all/department/role；
 *   · 定时发布是秒级时间戳，0 = 立即；范围选部门/角色时 scopeIds 是目标 id 数组。
 * 编辑模式按 noticeId 拉取管理端单条接口回填（含定时中/停发的公告）。
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import {
  ElCol,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElOption,
  ElRow,
  ElSelect,
  ElSwitch,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import NomiRichEditor from './NomiRichEditor.vue';
import {
  addNotice,
  editNotice,
  fetchDepartments,
  fetchNoticeForEdit,
  fetchRoles,
  type NoticePayload,
} from '../../services/permission';
import type { DepartmentItem, NoticeCategory, RoleItem } from '../../types/permission';

defineOptions({ name: 'NomiNoticeForm' });

const props = defineProps<{
  /** 有值即编辑模式；为空则新增。 */
  noticeId?: number | null;
}>();

const emit = defineEmits<{
  saved: [id: number];
}>();

const { t } = useI18n();

const submitting = ref(false);
const loadError = ref('');
const formRef = ref<FormInstance>();
const departments = ref<DepartmentItem[]>([]);
const roles = ref<RoleItem[]>([]);

/** 日期控件绑定毫秒字符串（value-format="x"），提交时转秒。0 表示立即发布。 */
interface NoticeForm {
  title: string;
  category: NoticeCategory;
  content: string;
  publishTimeMs: string;
  isTop: number;
  notifyMethod: string;
  notifyScope: string;
  scopeIds: number[];
  status: number;
}

const form = reactive<NoticeForm>(emptyForm());

function emptyForm(): NoticeForm {
  return {
    title: '',
    category: 'notice',
    content: '',
    publishTimeMs: '',
    isTop: 0,
    notifyMethod: 'internal',
    notifyScope: 'all',
    scopeIds: [],
    status: 1,
  };
}

/** 富文本空值时编辑器会给出 `<p><br></p>`，去掉标签/空白后判定是否真的填了内容。 */
function hasContent(html: string): boolean {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim()
    .length > 0;
}

const rules = computed<FormRules>(() => ({
  title: [{ required: true, message: t('auth.notice.titleRequired'), trigger: 'blur' }],
  content: [
    {
      validator: (_rule, value: string, callback) => {
        if (hasContent(value)) callback();
        else callback(new Error(t('auth.notice.contentRequired')));
      },
      trigger: 'change',
    },
  ],
  scopeIds: [
    {
      validator: (_rule, value: number[], callback) => {
        if (form.notifyScope !== 'all' && (!value || value.length === 0)) {
          callback(new Error(t('auth.notice.scopeRequired')));
        } else {
          callback();
        }
      },
      trigger: 'change',
    },
  ],
}));

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
const SCOPE_OPTIONS = [
  { value: 'all', labelKey: 'auth.notice.scopeAll' },
  { value: 'department', labelKey: 'auth.notice.scopeDepartment' },
  { value: 'role', labelKey: 'auth.notice.scopeRole' },
];

function optionLabel(labelKey: string): string {
  return t(labelKey);
}

/** 范围目标下拉：部门或角色，随通知范围切换。 */
const targetOptions = computed(() =>
  form.notifyScope === 'department'
    ? departments.value.map((d) => ({ value: d.id, label: d.name }))
    : roles.value.map((r) => ({ value: r.id, label: r.name })),
);

/**
 * 老公告的正文是纯文本，wangEditor 吃 HTML：不含标签的内容按纯文本转义后包 <p>，
 * 已经是 HTML 的原样交给编辑器（服务端已净化过，不会再带脚本）。
 */
function toEditorHtml(content: string): string {
  if (!content) return '';
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

onMounted(async () => {
  const jobs: Promise<unknown>[] = [
    fetchDepartments()
      .then((result) => { departments.value = result.list; })
      .catch(() => { departments.value = []; }),
    fetchRoles()
      .then((result) => { roles.value = result.list; })
      .catch(() => { roles.value = []; }),
  ];

  if (props.noticeId) {
    jobs.push(
      fetchNoticeForEdit(props.noticeId)
        .then((notice) => {
          Object.assign(form, {
            title: notice.title,
            category: notice.category,
            content: toEditorHtml(notice.content),
            publishTimeMs: notice.publishTime ? String(notice.publishTime * 1000) : '',
            isTop: notice.isTop,
            notifyMethod: notice.notifyMethod,
            notifyScope: notice.notifyScope,
            scopeIds: [...notice.scopeIds],
            status: notice.status,
          });
        })
        .catch((error: Error) => {
          loadError.value = error.message || t('auth.notice.detail.notFound');
        }),
    );
  }

  await Promise.all(jobs);
  void nextTick(() => formRef.value?.clearValidate());
});

/** 切换范围时清空已选目标，避免把上一个范围的 id 带到新范围。 */
function onScopeChange(): void {
  form.scopeIds = [];
  void nextTick(() => formRef.value?.validateField('scopeIds').catch(() => false));
}

async function submit(): Promise<void> {
  if (!formRef.value || submitting.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const publishTime = form.publishTimeMs
      ? Math.floor(Number(form.publishTimeMs) / 1000)
      : 0;
    const payload: NoticePayload = {
      title: form.title.trim(),
      category: form.category,
      content: form.content.trim(),
      publishTime,
      isTop: form.isTop,
      notifyMethod: form.notifyMethod,
      notifyScope: form.notifyScope,
      scopeIds: form.notifyScope === 'all' ? [] : form.scopeIds,
      status: form.status,
    };
    const result = props.noticeId
      ? await editNotice({ ...payload, id: props.noticeId })
      : await addNotice(payload);
    ElMessage.success(t('auth.common.success'));
    emit('saved', result.id);
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

defineExpose({ submit });
</script>

<template>
  <div v-if="loadError" class="notice-form-error">
    <p>{{ loadError }}</p>
  </div>
  <div v-else class="notice-form-card">
    <ElForm ref="formRef" :model="form" :rules="rules" label-width="110px" class="notice-form">
      <ElRow :gutter="16">
        <ElCol :span="24">
          <ElFormItem :label="t('auth.notice.title')" prop="title">
            <ElInput v-model="form.title" :placeholder="t('auth.notice.titlePlaceholder')" maxlength="200" show-word-limit />
          </ElFormItem>
        </ElCol>
        <ElCol :span="12">
          <ElFormItem :label="t('auth.notice.category')" prop="category">
            <ElSelect v-model="form.category" class="form-block">
              <ElOption v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value" :label="optionLabel(opt.labelKey)" />
            </ElSelect>
          </ElFormItem>
        </ElCol>
        <ElCol :span="12">
          <ElFormItem :label="t('auth.notice.notifyMethod')" prop="notifyMethod">
            <ElSelect v-model="form.notifyMethod" class="form-block">
              <ElOption v-for="opt in METHOD_OPTIONS" :key="opt.value" :value="opt.value" :label="optionLabel(opt.labelKey)" />
            </ElSelect>
          </ElFormItem>
        </ElCol>
        <ElCol :span="12">
          <ElFormItem :label="t('auth.notice.notifyScope')" prop="notifyScope">
            <ElSelect v-model="form.notifyScope" class="form-block" @change="onScopeChange">
              <ElOption v-for="opt in SCOPE_OPTIONS" :key="opt.value" :value="opt.value" :label="optionLabel(opt.labelKey)" />
            </ElSelect>
          </ElFormItem>
        </ElCol>
        <ElCol :span="12">
          <ElFormItem :label="t('auth.common.status')">
            <ElSwitch v-model="form.status" :active-value="1" :inactive-value="0" />
          </ElFormItem>
        </ElCol>
        <ElCol v-if="form.notifyScope !== 'all'" :span="24">
          <ElFormItem :label="form.notifyScope === 'department' ? t('auth.notice.targetDepartment') : t('auth.notice.targetRole')" prop="scopeIds">
            <ElSelect v-model="form.scopeIds" multiple filterable collapse-tags class="form-block" :placeholder="t('auth.notice.targetPlaceholder')">
              <ElOption v-for="opt in targetOptions" :key="opt.value" :value="opt.value" :label="opt.label" />
            </ElSelect>
          </ElFormItem>
        </ElCol>
        <ElCol :span="12">
          <ElFormItem :label="t('auth.notice.publishTime')">
            <ElDatePicker
              v-model="form.publishTimeMs"
              type="datetime"
              value-format="x"
              :placeholder="t('auth.notice.publishTimePlaceholder')"
              class="form-block"
            />
            <div class="form-hint">{{ t('auth.notice.publishTimeHint') }}</div>
          </ElFormItem>
        </ElCol>
        <ElCol :span="12">
          <ElFormItem :label="t('auth.notice.isTop')">
            <ElSwitch v-model="form.isTop" :active-value="1" :inactive-value="0" />
          </ElFormItem>
        </ElCol>
        <ElCol :span="24">
          <ElFormItem :label="t('auth.notice.content')" prop="content">
            <NomiRichEditor v-model="form.content" />
          </ElFormItem>
        </ElCol>
      </ElRow>
    </ElForm>

    <div class="notice-form-actions">
      <slot name="actions" :submit="submit" :submitting="submitting" />
    </div>
  </div>
</template>

<style scoped>
.notice-form-card {
  padding: 4px 0;
}

.form-block {
  width: 100%;
}

.form-hint {
  margin-top: 4px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.notice-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.notice-form-error {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
}

.notice-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  margin-top: 4px;
  border-top: 1px solid var(--nomi-border);
}

/* 窄屏两列放不下：回到单列。 */
@media only screen and (max-width: 640px) {
  .notice-form :deep(.el-col) {
    max-width: 100%;
    flex: 0 0 100%;
  }
}
</style>
