<script setup lang="ts">
/**
 * 部门管理：组织树 + 直属成员数。
 *
 * 三件事需要说清楚：
 *   1. 树是**前端拼的**：接口只给扁平表（pid 指向父级），拼树与排序都在这里做，
 *      因为「哪些节点展开过」本来就是前端状态；
 *   2. 部门决定「能看见谁」（非超管只看本部门及子部门），角色决定「能做什么」；
 *      列表由服务端按范围裁剪，所以这个页面仍然没有任何「授权」入口；
 *   3. 有子部门或有成员时不许删：删掉会留下孤儿部门和无归属的账号。
 */
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
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { usePermission } from '../../../composables/usePermission';
import NomiFieldTip from '../../../components/layout/NomiFieldTip.vue';
import { usePermissionStore } from '../../../stores/permission';
import {
  addDepartment,
  deleteDepartment,
  editDepartment,
  fetchDepartments,
  type DepartmentPayload,
} from '../../../services/permission';
import type { DepartmentItem, DepartmentNode } from '../../../types/permission';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiAdminDepartments' });

const { t } = useI18n();
const { auth } = usePermission();
const permissionStore = usePermissionStore();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('auth.dept.title')) });

const loading = ref(false);
const list = ref<DepartmentItem[]>([]);

const dialogVisible = ref(false);
const submitting = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<DepartmentPayload>({
  name: '',
  pid: 0,
  leader: '',
  phone: '',
  weigh: 0,
  status: 1,
});

const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: t('auth.dept.name'), trigger: 'blur' }],
}));

/** 扁平表 → 树。父级不在表里的节点按顶级处理，避免数据被改坏时整棵树消失。 */
function buildTree(rows: readonly DepartmentItem[]): DepartmentNode[] {
  const nodes = new Map<number, DepartmentNode>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  const roots: DepartmentNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent = nodes.get(row.pid);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (items: DepartmentNode[]): void => {
    items.sort((a, b) => b.weigh - a.weigh || a.id - b.id);
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

const tree = computed(() => buildTree(list.value));
const totalMembers = computed(() => list.value.reduce((sum, item) => sum + item.userCount, 0));

/** 上级下拉：编辑时排除自己与自己的子孙，避免把部门挂成环。 */
/**
 * 弹窗里的状态锁，与后端 `lockRootDepartmentStatus` 同口径：
 * 提交后的上级是顶级、或编辑前本来就是顶级，都不允许改状态。
 * 新建部门默认就是顶级，所以新建弹窗的开关同样是锁定的。
 */
const formIsRootDepartment = computed(() => {
  if (form.pid === 0) return true;
  if (!editingId.value) return false;
  return list.value.find((item) => item.id === editingId.value)?.pid === 0;
});

const parentOptions = computed(() => {
  if (!editingId.value) return list.value;
  const banned = new Set<number>();
  const collect = (id: number): void => {
    banned.add(id);
    for (const row of list.value) if (row.pid === id) collect(row.id);
  };
  collect(editingId.value);
  return list.value.filter((row) => !banned.has(row.id));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchDepartments();
    list.value = result.list;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function openCreate(raw?: unknown): void {
  const parent = raw as DepartmentItem | undefined;
  editingId.value = null;
  // 非超管不能新建顶级部门（服务端会拒绝 pid=0），默认挂在自己部门下。
  const defaultPid = permissionStore.isSuper ? 0 : (permissionStore.adminInfo?.departmentId ?? 0);
  Object.assign(form, {
    name: '',
    pid: parent?.id ?? defaultPid,
    leader: '',
    phone: '',
    weigh: 0,
    status: 1,
  });
  dialogVisible.value = true;
  void nextTick(() => formRef.value?.clearValidate());
}

function openEdit(raw: unknown): void {
  const row = raw as DepartmentItem;
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    pid: row.pid,
    leader: row.leader,
    phone: row.phone,
    weigh: row.weigh,
    status: row.status,
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
    // 顶级部门的状态锁：即使开关被人为改回可点，也不提交停用。
    const payload: DepartmentPayload = {
      ...form,
      status: formIsRootDepartment.value ? 1 : form.status,
    };
    if (editingId.value) await editDepartment({ ...payload, id: editingId.value });
    else await addDepartment(payload);
    ElMessage.success(t('auth.common.success'));
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

/** 启停用同样走编辑接口，只改 status：不动名称与层级。 */
async function toggleStatus(raw: unknown, enable: boolean): Promise<void> {
  const row = raw as DepartmentItem;
  if (row.pid === 0) {
    ElMessage.warning(t('auth.dept.rootStatusLocked'));
    return;
  }
  try {
    await editDepartment({
      id: row.id,
      name: row.name,
      pid: row.pid,
      leader: row.leader,
      phone: row.phone,
      weigh: row.weigh,
      status: enable ? 1 : 0,
    });
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
    await load();
  }
}

async function remove(raw: unknown): Promise<void> {
  const row = raw as DepartmentItem;
  if (row.pid === 0) {
    ElMessage.warning(t('auth.dept.rootDeleteLocked'));
    return;
  }
  const confirmed = await ElMessageBox.confirm(
    `${t('auth.common.confirmDelete')}\n${row.name}`,
    t('auth.dept.title'),
    {
      type: 'warning',
      confirmButtonText: t('auth.action.delete'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;

  try {
    await deleteDepartment(row.id);
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
      <div class="nomi-page-toolbar">
        <span class="summary">
          {{ t('auth.dept.title') }} · {{ list.length }} · {{ t('auth.dept.members') }}
          {{ totalMembers }}
        </span>
        <ElButton v-if="auth('add')" type="primary" class="toolbar-add" @click="openCreate()">
          {{ t('auth.dept.add') }}
        </ElButton>
      </div>

      <div ref="tableWrap" class="nomi-table-fill">
        <ElTable
          v-loading="loading"
          :height="tableHeight"
          :data="tree"
          row-key="id"
          default-expand-all
          :tree-props="{ children: 'children' }"
          border
          :empty-text="t('auth.dept.empty')"
        >
          <ElTableColumn :label="t('auth.dept.name')" :min-width="isMobile ? 170 : 220">
            <template #default="{ row }">
              <span class="dept-name">{{ row.name }}</span>
              <ElTag
                v-if="row.pid === 0"
                size="small"
                type="info"
                class="dept-tag"
                :title="t('auth.dept.rootDeleteLocked')"
              >
                {{ t('auth.dept.root') }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" prop="leader" :label="t('auth.dept.leader')" width="120">
            <template #default="{ row }">
              <span :class="{ muted: !row.leader }">{{ row.leader || '—' }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn v-if="!isNarrow" prop="phone" :label="t('auth.dept.phone')" width="150">
            <template #default="{ row }">
              <span :class="{ muted: !row.phone }">{{ row.phone || '—' }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="userCount" :label="t('auth.dept.members')" :width="isNarrow ? 72 : 100" />
          <ElTableColumn v-if="!isMobile" prop="weigh" :label="t('auth.dept.weigh')" width="100" />
          <ElTableColumn :label="t('auth.common.status')" :width="isNarrow ? 84 : 100">
            <template #default="{ row }">
              <ElSwitch
                :model-value="row.status === 1"
                size="small"
                width="58"
                inline-prompt
                :active-text="t('auth.user.enableShort')"
                :inactive-text="t('auth.user.disableShort')"
                style="--el-switch-off-color: var(--el-color-danger)"
                :disabled="!auth('edit') || row.pid === 0"
                :title="row.pid === 0 ? t('auth.dept.rootStatusLocked') : undefined"
                @change="(value: string | number | boolean) => toggleStatus(row, Boolean(value))"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn
            :label="t('auth.common.actions')"
            :width="isNarrow ? 150 : 230"
            :fixed="isMobile ? false : 'right'"
          >
            <template #default="{ row }">
              <ElButton v-if="auth('add')" link type="primary" @click="openCreate(row)">
                {{ t('auth.dept.addChild') }}
              </ElButton>
              <ElButton v-if="auth('edit')" link type="primary" @click="openEdit(row)">
                {{ t('auth.action.edit') }}
              </ElButton>
              <ElButton v-if="auth('del') && row.pid !== 0" link type="danger" @click="remove(row)">
                {{ t('auth.action.delete') }}
              </ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </section>

    <ElDialog
      v-model="dialogVisible"
      :title="editingId ? t('auth.dept.edit') : t('auth.dept.add')"
      width="560px"
      destroy-on-close
    >
      <ElForm ref="formRef" :model="form" :rules="rules" class="tip-form" label-width="96px">
        <ElFormItem :label="t('auth.dept.name')" prop="name">
          <ElInput v-model="form.name" maxlength="100" />
        </ElFormItem>
        <ElFormItem :label="t('auth.dept.parent')">
          <ElSelect v-model="form.pid" class="full">
            <ElOption :label="t('auth.dept.root')" :value="0" />
            <ElOption
              v-for="dept in parentOptions"
              :key="dept.id"
              :label="dept.name"
              :value="dept.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem :label="t('auth.dept.leader')">
          <ElInput v-model="form.leader" maxlength="50" />
        </ElFormItem>
        <ElFormItem :label="t('auth.dept.phone')">
          <ElInput v-model="form.phone" maxlength="30" />
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="form-label">
              {{ t('auth.dept.weigh') }}
              <NomiFieldTip :content="t('auth.dept.weighHint')" />
            </span>
          </template>
          <ElInputNumber v-model="form.weigh" :min="0" :max="9999" controls-position="right" />
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="form-label">
              {{ t('auth.common.status') }}
              <NomiFieldTip
                :content="
                  formIsRootDepartment
                    ? t('auth.dept.rootStatusLocked')
                    : t('auth.dept.statusHint')
                "
              />
            </span>
          </template>
          <ElSwitch
            v-model="form.status"
            :active-value="1"
            :inactive-value="0"
            inline-prompt
            :active-text="t('auth.user.enableShort')"
            :inactive-text="t('auth.user.disableShort')"
            style="--el-switch-off-color: var(--el-color-danger)"
            :disabled="formIsRootDepartment"
          />
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
.summary {
  color: var(--fg-muted);
  font-size: 12px;
}

.toolbar-add {
  margin-left: auto;
}

.dept-name {
  font-weight: 500;
}

.dept-tag {
  margin-left: 8px;
}

.muted {
  color: var(--fg-muted);
}

@media (max-width: 640px) {
  .toolbar-add {
    margin-left: 0;
  }

  /* 三个链接按钮在 150px 的操作列里需要收紧间距，否则会折行。 */
  :deep(.el-table .el-button + .el-button) {
    margin-left: 4px;
  }
}
</style>
