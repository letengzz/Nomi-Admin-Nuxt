/**
 * 菜单管理（菜单 / 页面 / 按钮权限节点）。
 *
 * 这张表是整个权限系统的「源头」：菜单、页面、按钮都在同一棵树里，
 * 勾选（角色里的授权树）就是对这里节点的引用。所以页面上要特别清楚地展示
 * 「权限标识」——它同时是接口验权的名字和前端按钮权限的 key。
 */
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import NomiFieldTip from '../../../components/layout/NomiFieldTip.vue';
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { usePermission } from '../../../composables/usePermission';
import {
  addRule,
  deleteRule,
  editRule,
  fetchRules,
  type RulePayload,
} from '../../../services/permission';
import type { AdminRule } from '../../../types/permission';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiAdminRules' });

const { t } = useI18n();
const { auth } = usePermission();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('auth.rule.title')) });

const loading = ref(false);
const tree = ref<AdminRule[]>([]);
const flat = ref<AdminRule[]>([]);

const dialogVisible = ref(false);
const submitting = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();

const form = reactive<RulePayload>({
  pid: 0,
  type: 'menu',
  title: '',
  name: '',
  path: '',
  icon: '',
  weigh: 0,
  status: 1,
  remark: '',
});

const typeLabels = computed<Record<string, string>>(() => ({
  menu_dir: t('auth.rule.types.menu_dir'),
  menu: t('auth.rule.types.menu'),
  button: t('auth.rule.types.button'),
}));

const rules = computed<FormRules>(() => ({
  title: [{ required: true, message: t('auth.rule.titleField'), trigger: 'blur' }],
  name: [{ required: true, message: t('auth.rule.name'), trigger: 'blur' }],
  path: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (form.type === 'button') return callback();
        if (!value) return callback(new Error(t('auth.rule.path')));
        return callback();
      },
      trigger: 'blur',
    },
  ],
}));

interface ParentOption {
  id: number;
  label: string;
}

/** 上级下拉：只给非按钮节点，用缩进把层级画出来（比再塞一棵树给用户点更直接）。 */
const parentOptions = computed<ParentOption[]>(() => {
  const result: ParentOption[] = [];
  const walk = (nodes: readonly AdminRule[], depth: number): void => {
    for (const node of nodes) {
      if (node.type !== 'button') {
        result.push({ id: node.id, label: `${'— '.repeat(depth)}${node.title}` });
      }
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(tree.value, 0);
  return result;
});

function flatten(nodes: readonly AdminRule[]): AdminRule[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchRules();
    tree.value = result.tree;
    flat.value = flatten(result.tree);
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function resetForm(): void {
  Object.assign(form, {
    pid: 0,
    type: 'menu',
    title: '',
    name: '',
    path: '',
    icon: '',
    weigh: 0,
    status: 1,
    remark: '',
  });
}

/** el-table 插槽的行类型是 DefaultRow，入口处收窄成业务类型。 */
function openCreate(rawParent?: unknown): void {
  const parent = rawParent as AdminRule | undefined;
  editingId.value = null;
  resetForm();
  if (parent) {
    form.pid = parent.id;
    // 在菜单/目录下新增，默认是按钮；这是最常见的一步。
    form.type = parent.type === 'menu' ? 'button' : 'menu';
  }
  dialogVisible.value = true;
  void nextTick(() => formRef.value?.clearValidate());
}

function openEdit(raw: unknown): void {
  const row = raw as AdminRule;
  editingId.value = row.id;
  Object.assign(form, {
    pid: row.pid,
    type: row.type,
    title: row.title,
    name: row.name,
    path: row.path,
    icon: row.icon,
    weigh: row.weigh,
    status: row.status,
    remark: row.remark,
  });
  dialogVisible.value = true;
  void nextTick(() => formRef.value?.clearValidate());
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    if (editingId.value) await editRule({ ...form, id: editingId.value });
    else await addRule(form);
    ElMessage.success(t('auth.common.success'));
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function remove(raw: unknown): Promise<void> {
  const row = raw as AdminRule;
  const confirmed = await ElMessageBox.confirm(
    `${t('auth.common.confirmDelete')}\n${row.title} (${row.name})`,
    t('auth.rule.title'),
    {
      type: 'warning',
      confirmButtonText: t('auth.action.delete'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;

  try {
    await deleteRule(row.id);
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

onMounted(load);
</script>

<template>
  <div class="page-fill">
    <section class="page-content">
      <div v-if="auth('add')" class="nomi-page-toolbar nomi-page-toolbar--end">
        <ElButton type="primary" @click="openCreate()">{{ t('auth.rule.add') }}</ElButton>
      </div>
      <div ref="tableWrap" class="nomi-table-fill">
        <ElTable
          v-loading="loading"
          :height="tableHeight"
          :data="tree"
          row-key="id"
          :tree-props="{ children: 'children' }"
          default-expand-all
          border
        >
          <ElTableColumn :label="t('auth.rule.titleField')" :min-width="isMobile ? 160 : 200">
            <template #default="{ row }">
              <span class="rule-title">{{ row.title.startsWith('auth.') || row.title.startsWith('layout.') ? t(row.title) : row.title }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn
            v-if="!isNarrow"
            :label="t('auth.rule.name')"
            min-width="190"
          >
            <template #default="{ row }"><code class="rule-name">{{ row.name }}</code></template>
          </ElTableColumn>
          <ElTableColumn :label="t('auth.rule.type')" :width="isNarrow ? 80 : 100">
            <template #default="{ row }">
              <ElTag size="small" :type="row.type === 'button' ? 'info' : row.type === 'menu' ? 'success' : 'warning'">
                {{ typeLabels[row.type] }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn
            v-if="!isMobile"
            :label="t('auth.rule.path')"
            min-width="210"
          >
            <template #default="{ row }"><code class="rule-name">{{ row.path || '—' }}</code></template>
          </ElTableColumn>
          <ElTableColumn v-if="!isNarrow" prop="weigh" :label="t('auth.rule.weigh')" width="90" />
          <ElTableColumn :label="t('auth.common.status')" :width="isNarrow ? 76 : 90">
            <template #default="{ row }">
              <ElTag :type="row.status === 1 ? 'success' : 'info'" size="small">
                {{ row.status === 1 ? t('auth.common.enabled') : t('auth.common.disabled') }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn
            :label="t('auth.common.actions')"
            :width="isNarrow ? 150 : 220"
            :fixed="isMobile ? false : 'right'"
          >
            <template #default="{ row }">
              <ElButton v-if="auth('add')" link type="primary" @click="openCreate(row)">
                {{ t('auth.action.add') }}
              </ElButton>
              <ElButton v-if="auth('edit')" link type="primary" @click="openEdit(row)">
                {{ t('auth.action.edit') }}
              </ElButton>
              <ElButton v-if="auth('del')" link type="danger" @click="remove(row)">
                {{ t('auth.action.delete') }}
              </ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <p class="hint">共 {{ flat.length }} 个节点。删除节点会自动从所有角色的授权里移除它。</p>
    </section>

    <ElDialog
      v-model="dialogVisible"
      :title="editingId ? t('auth.rule.edit') : t('auth.rule.add')"
      width="620px"
      destroy-on-close
    >
      <!-- 标签宽度交给内容：中文标签只有两三个字，写死 96px 会空出一截；
           英文的 Permission key 又会被裁掉（label 里的图标不让换行）。 -->
      <ElForm ref="formRef" :model="form" :rules="rules" class="tip-form" label-width="auto">
        <ElFormItem :label="t('auth.rule.parent')">
          <ElSelect v-model="form.pid" class="full">
            <ElOption :label="t('auth.rule.root')" :value="0" />
            <ElOption
              v-for="option in parentOptions"
              :key="option.id"
              :label="option.label"
              :value="option.id"
              :disabled="option.id === editingId"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem :label="t('auth.rule.type')">
          <ElSelect v-model="form.type" class="full">
            <ElOption
              v-for="(label, value) in typeLabels"
              :key="value"
              :label="label"
              :value="value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem :label="t('auth.rule.titleField')" prop="title">
          <ElInput v-model="form.title" maxlength="100" />
        </ElFormItem>
        <ElFormItem prop="name">
          <template #label>
            <span class="form-label">
              {{ t('auth.rule.name') }}
              <NomiFieldTip :content="t('auth.rule.nameHint')" />
            </span>
          </template>
          <!-- 规则已经收进标签上的图标气泡，占位符只留一段格式示例 -->
          <ElInput v-model="form.name" maxlength="100" placeholder="system/role/add" />
        </ElFormItem>
        <ElFormItem v-if="form.type !== 'button'" :label="t('auth.rule.path')" prop="path">
          <ElInput v-model="form.path" maxlength="150" placeholder="/admin/system/rules" />
        </ElFormItem>
        <ElFormItem :label="t('auth.rule.icon')">
          <ElInput v-model="form.icon" maxlength="50" placeholder="shield" />
        </ElFormItem>
        <ElFormItem :label="t('auth.rule.weigh')">
          <ElInputNumber v-model="form.weigh" :min="-9999" :max="9999" />
        </ElFormItem>
        <ElFormItem :label="t('auth.common.status')">
          <ElSwitch v-model="form.status" :active-value="1" :inactive-value="0" />
        </ElFormItem>
        <ElFormItem :label="t('auth.rule.remark')">
          <ElInput v-model="form.remark" maxlength="255" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">{{ t('auth.common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="submitting" @click="submit">
          {{ t('auth.common.save') }}
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.rule-title {
  font-weight: 500;
}

.rule-name {
  color: var(--fg-muted);
  font-size: 12px;
}

.hint {
  margin: 8px 0 0;
  color: var(--fg-muted);
  font-size: 12px;
}

.full {
  width: 100%;
}

@media (max-width: 640px) {
  /* 三个链接按钮在窄屏收紧间距，避免折行。 */
  :deep(.el-table .el-button + .el-button) {
    margin-left: 4px;
  }
}
</style>
