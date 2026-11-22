/**
 * 角色管理：左「角色列表」/ 右「功能权限 + 角色用户」的主从版面。
 *
 * 三件事：角色 CRUD（含编码）、给选中角色分配权限树、看该角色下的账号。
 *
 * 授权树的提交规则（对应文档 7.6.2）：`checked + halfChecked` 一起提交。
 * 只提交 checked 会丢掉「有子项被选中、自己处于半选」的目录/菜单节点，
 * 结果就是菜单看起来授权了、侧边栏却不显示父级。
 */
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  ElTree,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { usePermission } from '../../../composables/usePermission';
import NomiFieldTip from '../../../components/layout/NomiFieldTip.vue';
import {
  addRole,
  changeRoleUsers,
  deleteRole,
  editRole,
  fetchRoles,
  fetchRules,
  fetchUsers,
  type RolePayload,
} from '../../../services/permission';
import type { AdminRule, RoleItem, UserItem } from '../../../types/permission';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiAdminRoles' });

const { t } = useI18n();
const { auth, isSuper, permission } = usePermission();
const { wrapRef: usersWrap, tableHeight: usersTableHeight } = useFillTable();
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('auth.role.title')) });

const loading = ref(false);
const roles = ref<RoleItem[]>([]);
const ruleTree = ref<AdminRule[]>([]);
const treeRef = ref<InstanceType<typeof ElTree>>();

const keyword = ref('');
const selectedId = ref(0);
const activeTab = ref<'permissions' | 'users'>('permissions');

const dialogVisible = ref(false);
const submitting = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<RolePayload>({ name: '', code: '', pid: 0, status: 1, rules: [] });

const roleUsers = ref<UserItem[]>([]);
const roleUserTotal = ref(0);
const userLoading = ref(false);
const userPage = ref(1);
const userLimit = 10;
const userKeyword = ref('');
const selectedUsers = ref<UserItem[]>([]);
/** ElTable 是泛型函数组件，拿不到 InstanceType；只声明我们要用的方法。 */
const roleUsersTableRef = ref<{ clearSelection: () => void }>();

/** 「分配用户」弹窗：候选账号 = 还没加入这个角色的人。 */
const assignDialogVisible = ref(false);
const assignLoading = ref(false);
const assigning = ref(false);
const candidates = ref<UserItem[]>([]);
const candidateTotal = ref(0);
const candidatePage = ref(1);
const candidateLimit = 10;
const candidateKeyword = ref('');
const selectedCandidates = ref<UserItem[]>([]);
const candidateTableRef = ref<{ clearSelection: () => void }>();

const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: t('auth.role.name'), trigger: 'blur' }],
  code: [
    {
      pattern: /^[a-zA-Z0-9_-]{2,50}$/,
      message: t('auth.role.codeHint'),
      trigger: 'blur',
    },
  ],
}));

/** 搜索同时匹配名称与编码，大小写不敏感（编码在服务端统一小写）。 */
const filteredRoles = computed(() => {
  const key = keyword.value.trim().toLowerCase();
  if (!key) return roles.value;
  return roles.value.filter(
    (role) => role.name.toLowerCase().includes(key) || role.code.toLowerCase().includes(key),
  );
});

const selected = computed(() => roles.value.find((role) => role.id === selectedId.value));

/** 当前选中的是不是超管角色：它的 rules 是 `'*'` 哨兵，不允许在树里改。 */
const selectedIsSuper = computed(() => selected.value?.isSuper ?? false);
/** 编辑弹窗里正在编辑的是不是超管角色：状态开关要置灰，提交时强制启用。 */
const editingIsSuper = computed(
  () => roles.value.find((role) => role.id === editingId.value)?.isSuper ?? false,
);

/** 上级下拉：只给非超管角色，避免把普通角色挂到超管下面。 */
const parentOptions = computed(() => roles.value.filter((role) => !role.isSuper));
const canEditSelected = computed(
  () => !!selected.value && auth('edit') && selected.value.assignable && !selected.value.isSuper,
);
/** 成员管理与权限树不同：超管角色也能加减人（不能停用它，但可以让别人成为超管）。 */
const canManageMembers = computed(
  () => !!selected.value && auth('edit') && selected.value.assignable,
);
/** 超管角色只剩一个成员时，连「取消分配」都不给点：后端也有同一条硬校验。 */
const superRoleAtMinMember = computed(
  () => !!selected.value?.isSuper && (selected.value?.memberCount ?? 0) <= 1,
);

const treeProps = { label: 'title', children: 'children' } as const;

function ruleCountText(role: RoleItem): string {
  return role.isSuper
    ? t('auth.role.allRuleCountText')
    : t('auth.role.ruleCountText', { count: role.rules.length });
}

/** 默认勾选只给叶子节点：非叶子交给 el-tree 自动算成半选，避免「一勾父级全勾子级」。 */
function leafRuleIds(nodes: readonly AdminRule[], selectedIds: Set<number>): number[] {
  const result: number[] = [];
  for (const node of nodes) {
    if (node.children?.length) result.push(...leafRuleIds(node.children, selectedIds));
    else if (selectedIds.has(node.id)) result.push(node.id);
  }
  return result;
}

/** 每次切角色都要把树重新勾一遍；超管角色是 '*'，树不勾也不能改。 */
function syncTree(): void {
  void nextTick(() => {
    const role = selected.value;
    if (!role || role.isSuper) {
      treeRef.value?.setCheckedKeys([], false);
      return;
    }
    treeRef.value?.setCheckedKeys(leafRuleIds(ruleTree.value, new Set(role.rules)), false);
  });
}

function selectRole(role: RoleItem): void {
  selectedId.value = role.id;
  syncTree();
}

function keepSelection(): void {
  if (!roles.value.some((role) => role.id === selectedId.value)) {
    selectedId.value = roles.value[0]?.id ?? 0;
  }
  syncTree();
  if (activeTab.value === 'users') void loadRoleUsers();
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [roleResult, ruleResult] = await Promise.all([fetchRoles(), fetchRules()]);
    roles.value = roleResult.list;
    ruleTree.value = ruleResult.tree;
    keepSelection();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function loadRoleUsers(): Promise<void> {
  if (!selectedId.value) return;
  userLoading.value = true;
  try {
    const result = await fetchUsers({
      roleId: selectedId.value,
      keyword: userKeyword.value,
      page: userPage.value,
      limit: userLimit,
    });
    roleUsers.value = result.list;
    roleUserTotal.value = result.total;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    userLoading.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab === 'users') void loadRoleUsers();
});

watch(selectedId, () => {
  userPage.value = 1;
  clearUserSelection();
  if (activeTab.value === 'users') void loadRoleUsers();
});

/** 搜索输入是即时的，但接口要防抖：每敲一个字都查库没必要。 */
let userKeywordTimer: ReturnType<typeof setTimeout> | undefined;
watch(userKeyword, () => {
  if (userKeywordTimer) clearTimeout(userKeywordTimer);
  userKeywordTimer = setTimeout(() => {
    userPage.value = 1;
    void loadRoleUsers();
  }, 300);
});

let candidateKeywordTimer: ReturnType<typeof setTimeout> | undefined;
watch(candidateKeyword, () => {
  if (candidateKeywordTimer) clearTimeout(candidateKeywordTimer);
  candidateKeywordTimer = setTimeout(() => {
    candidatePage.value = 1;
    void loadCandidates();
  }, 300);
});

function clearUserSelection(): void {
  selectedUsers.value = [];
  roleUsersTableRef.value?.clearSelection();
}

function onUserSelectionChange(rows: unknown): void {
  selectedUsers.value = rows as UserItem[];
}

function onCandidateSelectionChange(rows: unknown): void {
  selectedCandidates.value = rows as UserItem[];
}

async function loadCandidates(): Promise<void> {
  if (!selectedId.value) return;
  assignLoading.value = true;
  try {
    const result = await fetchUsers({
      excludeRoleId: selectedId.value,
      excludeSelf: true,
      keyword: candidateKeyword.value,
      page: candidatePage.value,
      limit: candidateLimit,
    });
    candidates.value = result.list;
    candidateTotal.value = result.total;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    assignLoading.value = false;
  }
}

function openAssignDialog(): void {
  selectedCandidates.value = [];
  candidateKeyword.value = '';
  candidatePage.value = 1;
  assignDialogVisible.value = true;
  void loadCandidates();
}

async function confirmAssign(): Promise<void> {
  const ids = selectedCandidates.value.map((user) => user.id);
  if (ids.length === 0) {
    ElMessage.warning(t('auth.role.selectUsersFirst'));
    return;
  }
  assigning.value = true;
  try {
    const result = await changeRoleUsers(selectedId.value, ids, 'add');
    ElMessage.success(t('auth.role.assignUsersSuccess', { count: result.affected }));
    assignDialogVisible.value = false;
    await load();
    await loadRoleUsers();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    assigning.value = false;
  }
}

async function confirmUnassign(): Promise<void> {
  if (superRoleAtMinMember.value) {
    ElMessage.warning(t('auth.role.superRoleMinMember'));
    return;
  }
  const ids = selectedUsers.value.map((user) => user.id);
  if (ids.length === 0) {
    ElMessage.warning(t('auth.role.selectUsersFirst'));
    return;
  }
  const confirmed = await ElMessageBox.confirm(
    t('auth.role.confirmUnassign', { count: ids.length }),
    t('auth.role.unassignUsers'),
    {
      type: 'warning',
      confirmButtonText: t('auth.common.save'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;

  assigning.value = true;
  try {
    const result = await changeRoleUsers(selectedId.value, ids, 'remove');
    ElMessage.success(t('auth.role.unassignUsersSuccess', { count: result.affected }));
    clearUserSelection();
    await load();
    await loadRoleUsers();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    assigning.value = false;
  }
}

function openCreate(): void {
  editingId.value = null;
  Object.assign(form, { name: '', code: '', pid: 0, status: 1, rules: [] });
  dialogVisible.value = true;
  void nextTick(() => formRef.value?.resetFields());
}

function openEdit(): void {
  const role = selected.value;
  if (!role) return;
  editingId.value = role.id;
  Object.assign(form, {
    name: role.name,
    code: role.code,
    pid: role.pid,
    status: role.status,
    rules: [...role.rules],
  });
  dialogVisible.value = true;
  void nextTick(() => formRef.value?.clearValidate());
}

/** 提交时把半选父节点补上：菜单目录必须和子项一起授权。 */
function collectRules(): number[] {
  if (!treeRef.value) return selected.value?.rules ?? [];
  const checked = treeRef.value.getCheckedKeys(false) as number[];
  const half = treeRef.value.getHalfCheckedKeys() as number[];
  return [...new Set([...checked, ...half])];
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    // 弹窗只改基本信息；权限在右侧「功能权限」里单独保存，
    // 所以编辑时要把已有 rules 原样带上，否则保存资料会顺手清空授权。
    const payload: RolePayload = { ...form, rules: [...form.rules] };
    // 双保险：即使前端开关被人改回可点，也不把超管角色提交成停用。
    if (editingIsSuper.value) payload.status = 1;
    if (editingId.value) {
      const id = await editRole({ ...payload, id: editingId.value });
      selectedId.value = id.id;
    } else {
      const created = await addRole({ ...payload, rules: [] });
      selectedId.value = created.id;
    }
    ElMessage.success(t('auth.common.success'));
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

/**
 * 改的权限是否影响当前登录人。
 *
 * 自己的角色被改了（或自己是超管、能看到全局），侧栏菜单 / 按钮权限必须立刻跟上，
 * 否则会出现「刚取消的菜单还在」「刚禁用的按钮还能点」——服务端已经是正确的，
 * 旧的只是前端没重拉的权限快照。
 */
async function refreshIfSelfAffected(roleId: number): Promise<void> {
  const mine = permission.adminInfo?.roles ?? [];
  if (permission.isSuper || mine.some((role) => role.id === roleId)) {
    await permission.refresh();
  }
}

/** 右侧「保存权限」：只提交授权，不动名称/编码/状态。 */
async function saveRules(): Promise<void> {
  const role = selected.value;
  if (!role || !canEditSelected.value) return;
  submitting.value = true;
  try {
    await editRole({
      id: role.id,
      name: role.name,
      code: role.code,
      pid: role.pid,
      status: role.status,
      rules: collectRules(),
    });
    ElMessage.success(t('auth.common.success'));
    await refreshIfSelfAffected(role.id);
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

/** 列表里的启停用：走编辑接口，但只改 status，不动名字与授权。 */
async function toggleStatus(enable: boolean): Promise<void> {
  const role = selected.value;
  if (!role) return;
  try {
    await editRole({
      id: role.id,
      name: role.name,
      code: role.code,
      pid: role.pid,
      status: enable ? 1 : 0,
      rules: [...role.rules],
    });
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
    await load();
  }
}

async function remove(): Promise<void> {
  const role = selected.value;
  if (!role) return;
  const confirmed = await ElMessageBox.confirm(
    `${t('auth.common.confirmDelete')}\n${role.name}`,
    t('auth.role.title'),
    {
      type: 'warning',
      confirmButtonText: t('auth.action.delete'),
      cancelButtonText: t('auth.common.cancel'),
    },
  ).catch(() => false);
  if (!confirmed) return;

  try {
    await deleteRole(role.id);
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
      <div v-loading="loading" class="role-layout">
        <!-- 左：搜索 / 新建 / 角色列表 -->
        <aside class="role-side">
          <div class="role-side-toolbar">
            <ElInput
              v-model="keyword"
              class="role-search"
              :placeholder="t('auth.role.search')"
              clearable
            />
            <ElButton v-if="auth('add')" type="primary" @click="openCreate">
              {{ t('auth.role.add') }}
            </ElButton>
          </div>
          <div class="role-side-list">
            <div
              v-for="role in filteredRoles"
              :key="role.id"
              class="role-item"
              :class="{ 'is-active': role.id === selectedId }"
              @click="selectRole(role)"
            >
              <div class="role-item-line">
                <span class="role-item-name">{{ role.name }}</span>
                <ElTag v-if="role.isSuper" size="small" type="danger">
                  {{ t('auth.role.superGroup') }}
                </ElTag>
              </div>
              <div class="role-item-meta">
                <code>{{ role.code || '—' }}</code>
                <span>{{ t('auth.role.membersTotal', { total: role.memberCount }) }}</span>
                <span>{{ ruleCountText(role) }}</span>
              </div>
            </div>
            <p v-if="!filteredRoles.length" class="hint role-empty">
              {{ t('auth.role.empty') }}
            </p>
          </div>
        </aside>

        <!-- 右：功能权限 / 角色用户 -->
        <div class="role-main">
          <div v-if="!selected" class="role-placeholder">
            {{ t('auth.role.selectHint') }}
          </div>
          <template v-else>
            <header class="role-main-head">
              <div class="role-head-title">
                <h2>{{ selected.name }}</h2>
                <code>{{ selected.code || '—' }}</code>
                <span class="role-head-count">
                  {{ t('auth.role.membersTotal', { total: selected.memberCount }) }}
                </span>
              </div>
              <div class="role-head-actions">
                <ElSwitch
                  :model-value="selected.status === 1"
                  size="small"
                  width="58"
                  inline-prompt
                  :active-text="t('auth.user.enableShort')"
                  :inactive-text="t('auth.user.disableShort')"
                  style="--el-switch-off-color: var(--el-color-danger)"
                  :disabled="!auth('edit') || !selected.assignable || selected.isSuper"
                  @change="(value: string | number | boolean) => toggleStatus(Boolean(value))"
                />
                <ElButton v-if="auth('edit') && selected.assignable" @click="openEdit">
                  {{ t('auth.action.edit') }}
                </ElButton>
                <ElButton
                  v-if="auth('del') && selected.assignable && !selected.isSuper"
                  type="danger"
                  plain
                  @click="remove"
                >
                  {{ t('auth.action.delete') }}
                </ElButton>
              </div>
            </header>

            <ElTabs v-model="activeTab" class="role-tabs">
              <ElTabPane name="permissions" :label="t('auth.role.tabPermissions')">
                <div v-if="selectedIsSuper" class="super-hint">
                  {{ t('auth.role.allPermissions') }}
                </div>
                <template v-else>
                  <div class="tree-toolbar">
                    <span class="hint">{{ t('auth.role.permissionHint') }}</span>
                    <ElButton
                      v-if="canEditSelected"
                      type="primary"
                      :loading="submitting"
                      @click="saveRules"
                    >
                      {{ t('auth.role.saveRules') }}
                    </ElButton>
                  </div>
                  <div class="tree-box">
                    <ElTree
                      ref="treeRef"
                      :data="ruleTree"
                      :props="treeProps"
                      node-key="id"
                      show-checkbox
                      default-expand-all
                      :check-strictly="false"
                    >
                      <template #default="{ data }">
                        <span class="tree-node">
                          <span>{{
                            data.title.startsWith('auth.') || data.title.startsWith('layout.')
                              ? t(data.title)
                              : data.title
                          }}</span>
                          <code class="tree-node-name">{{ data.name }}</code>
                        </span>
                      </template>
                    </ElTree>
                  </div>
                </template>
              </ElTabPane>

              <ElTabPane name="users" :label="t('auth.role.tabUsers')">
                <div class="users-toolbar">
                  <ElInput
                    v-model="userKeyword"
                    class="users-search"
                    :placeholder="t('auth.role.searchUser')"
                    clearable
                  />
                  <ElButton v-if="canManageMembers" type="primary" @click="openAssignDialog">
                    {{ t('auth.role.assignUsers') }}
                  </ElButton>
                  <ElButton
                    v-if="canManageMembers"
                    type="danger"
                    plain
                    :disabled="selectedUsers.length === 0 || superRoleAtMinMember"
                    :title="superRoleAtMinMember ? t('auth.role.superRoleMinMember') : undefined"
                    @click="confirmUnassign"
                  >
                    {{ t('auth.role.unassignUsers') }}
                    <span v-if="selectedUsers.length">({{ selectedUsers.length }})</span>
                  </ElButton>
                  <span v-if="superRoleAtMinMember" class="hint users-lock-hint">
                    {{ t('auth.role.superRoleMinMember') }}
                  </span>
                </div>
                <div ref="usersWrap" class="nomi-table-fill role-users-wrap">
                  <ElTable
                    ref="roleUsersTableRef"
                    v-loading="userLoading"
                    :height="usersTableHeight"
                    :data="roleUsers"
                    row-key="id"
                    border
                    stripe
                    @selection-change="onUserSelectionChange"
                  >
                    <ElTableColumn type="selection" :width="isNarrow ? 40 : 46" />
                    <ElTableColumn
                      prop="username"
                      :label="t('auth.role.account')"
                      :min-width="isNarrow ? 110 : 140"
                    />
                    <ElTableColumn
                      v-if="!isNarrow"
                      prop="nickname"
                      :label="t('auth.user.nickname')"
                      min-width="140"
                    />
                    <ElTableColumn
                      v-if="!isMobile"
                      prop="departmentName"
                      :label="t('auth.user.department')"
                      min-width="140"
                    >
                      <template #default="{ row }">
                        {{ row.departmentName || t('auth.user.departmentNone') }}
                      </template>
                    </ElTableColumn>
                    <ElTableColumn :label="t('auth.common.status')" :width="isNarrow ? 80 : 100">
                      <template #default="{ row }">
                        <ElTag :type="row.status === 'enable' ? 'success' : 'danger'" size="small">
                          {{
                            row.status === 'enable'
                              ? t('auth.common.enabled')
                              : t('auth.common.disabled')
                          }}
                        </ElTag>
                      </template>
                    </ElTableColumn>
                  </ElTable>
                </div>
                <div class="pager role-pager">
                  <ElPagination
                    v-model:current-page="userPage"
                    :page-size="userLimit"
                    :total="roleUserTotal"
                    layout="total, prev, pager, next"
                    background
                    @current-change="loadRoleUsers"
                  />
                  <span class="hint role-users-note">{{ t('auth.role.assignUsersNote') }}</span>
                </div>
              </ElTabPane>
            </ElTabs>
          </template>
        </div>
      </div>

      <p v-if="!isSuper" class="hint">{{ t('auth.role.parentHint') }}</p>
    </section>

    <ElDialog
      v-model="dialogVisible"
      :title="editingId ? t('auth.role.edit') : t('auth.role.add')"
      class="nomi-role-dialog"
      width="560px"
      destroy-on-close
    >
      <ElForm ref="formRef" :model="form" :rules="rules" class="tip-form" label-width="96px">
        <ElFormItem :label="t('auth.role.name')" prop="name">
          <ElInput v-model="form.name" maxlength="100" />
        </ElFormItem>
        <ElFormItem prop="code">
          <template #label>
            <span class="form-label">
              {{ t('auth.role.code') }}
              <NomiFieldTip :content="t('auth.role.codeHint')" />
            </span>
          </template>
          <!-- 规则已经收进标签上的问号气泡，占位符不再复述长句（原本会被输入框截断） -->
          <ElInput v-model="form.code" maxlength="50" />
        </ElFormItem>
        <ElFormItem :label="t('auth.role.parent')">
          <ElSelect v-model="form.pid" class="full">
            <ElOption :label="t('auth.rule.root')" :value="0" />
            <ElOption
              v-for="role in parentOptions"
              :key="role.id"
              :label="role.name"
              :value="role.id"
              :disabled="role.id === editingId"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="form-label">
              {{ t('auth.common.status') }}
              <NomiFieldTip v-if="editingIsSuper" :content="t('auth.role.allPermissions')" />
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
            :disabled="editingIsSuper"
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

    <ElDialog
      v-model="assignDialogVisible"
      :title="t('auth.role.assignUsersTitle')"
      width="720px"
      destroy-on-close
    >
      <p class="hint assign-dialog-hint">{{ t('auth.role.assignUsersHint') }}</p>
      <ElInput
        v-model="candidateKeyword"
        class="assign-dialog-search"
        :placeholder="t('auth.role.searchUser')"
        clearable
      />
      <ElTable
        ref="candidateTableRef"
        v-loading="assignLoading"
        :data="candidates"
        height="320"
        row-key="id"
        border
        stripe
        @selection-change="onCandidateSelectionChange"
      >
        <ElTableColumn type="selection" :width="isNarrow ? 40 : 46" />
        <ElTableColumn
          prop="username"
          :label="t('auth.role.account')"
          :min-width="isNarrow ? 110 : 140"
        />
        <ElTableColumn
          v-if="!isNarrow"
          prop="nickname"
          :label="t('auth.user.nickname')"
          min-width="140"
        />
        <ElTableColumn
          v-if="!isMobile"
          prop="departmentName"
          :label="t('auth.user.department')"
          min-width="140"
        >
          <template #default="{ row }">
            {{ row.departmentName || t('auth.user.departmentNone') }}
          </template>
        </ElTableColumn>
        <ElTableColumn :label="t('auth.common.status')" :width="isNarrow ? 80 : 100">
          <template #default="{ row }">
            <ElTag :type="row.status === 'enable' ? 'success' : 'danger'" size="small">
              {{ row.status === 'enable' ? t('auth.common.enabled') : t('auth.common.disabled') }}
            </ElTag>
          </template>
        </ElTableColumn>
        <template #empty>{{ t('auth.role.candidateEmpty') }}</template>
      </ElTable>
      <div class="pager role-pager">
        <ElPagination
          v-model:current-page="candidatePage"
          :page-size="candidateLimit"
          :total="candidateTotal"
          layout="total, prev, pager, next"
          background
          @current-change="loadCandidates"
        />
      </div>
      <template #footer>
        <ElButton @click="assignDialogVisible = false">{{ t('auth.common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="assigning" @click="confirmAssign">
          {{ t('auth.role.confirmAssign') }}
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.role-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
}

.role-side,
.role-main {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--nomi-border, var(--el-border-color-lighter));
  border-radius: 10px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.role-side {
  width: 300px;
  flex: 0 0 300px;
  border-radius: 0;
}

.role-main {
  flex: 1;
  min-width: 0;
}

.role-side-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--nomi-border, var(--el-border-color-lighter));
}

.role-search {
  flex: 1;
  min-width: 0;
}

.role-side-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.role-item {
  padding: 10px 12px;
  /* 左侧列表用直角，和右侧圆角卡片区分开 */
  border-radius: 0;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.role-item:hover {
  background: var(--el-fill-color-light);
}

.role-item.is-active {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}

.role-item-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.role-item-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-item-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 12px;
}

.role-item-meta code {
  color: var(--el-color-primary);
  font-size: 12px;
}

.role-empty {
  padding: 24px 8px;
  text-align: center;
}

.role-placeholder {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 14px;
}

.role-main-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--nomi-border, var(--el-border-color-lighter));
}

.role-head-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.role-head-title h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.role-head-title code,
.role-head-count {
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 12px;
}

.role-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.role-tabs {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.role-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0;
  padding: 0 16px;
}

.role-tabs :deep(.el-tabs__content),
.role-tabs :deep(.el-tab-pane) {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.role-tabs :deep(.el-tab-pane) {
  padding: 12px 16px;
  overflow: hidden;
}

.tree-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.tree-toolbar .hint {
  margin: 0;
}

.tree-box {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
  border: 1px solid var(--nomi-border, var(--el-border-color-lighter));
  border-radius: 8px;
}

.super-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 13px;
}

.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.tree-node-name {
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 11px;
}

.users-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.users-search {
  flex: 1;
  min-width: 0;
  max-width: 320px;
}

.users-lock-hint {
  flex: 1 1 100%;
  margin: 0;
  color: var(--el-color-warning);
}

.role-users-wrap {
  border: 1px solid var(--nomi-border, var(--el-border-color-lighter));
  border-radius: 8px;
}

.assign-dialog-hint {
  margin: 0 0 10px;
}

.assign-dialog-search {
  margin-bottom: 10px;
}

.role-users-note {
  flex: 1;
  margin: 0;
  align-self: center;
}

.role-pager {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  padding-top: 10px;
}

.hint {
  margin: 8px 0 0;
  color: var(--fg-muted, var(--el-text-color-secondary));
  font-size: 12px;
  line-height: 1.6;
}

.full {
  width: 100%;
}

/*
 * 窄屏：左侧 300px 角色列表会把右侧挤没了。这里把主从版面改为上下排布，
 * 角色列表退化成一行可横向滚动的 chip，点选逻辑不变（同一套 selectRole）。
 */
@media (max-width: 800px) {
  .role-layout {
    flex-direction: column;
  }

  .role-side {
    width: 100%;
    flex: 0 0 auto;
  }

  .role-side-list {
    display: flex;
    flex-direction: row;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 12px;
    scrollbar-width: thin;
  }

  .role-item {
    flex: 0 0 168px;
    padding: 8px 10px;
    border: 1px solid var(--nomi-border, var(--el-border-color-lighter));
  }

  .role-item.is-active {
    box-shadow: inset 0 -3px 0 var(--el-color-primary);
  }

  .role-item-meta {
    gap: 6px;
    font-size: 11px;
  }

  .role-main {
    flex: 1;
  }
}

@media (max-width: 640px) {
  .role-main-head {
    flex-wrap: wrap;
    padding: 10px 12px;
  }

  .role-head-actions {
    flex-wrap: wrap;
  }

  .role-tabs :deep(.el-tabs__header) {
    padding: 0 12px;
  }

  .role-tabs :deep(.el-tab-pane) {
    padding: 10px 12px;
  }

  .users-search {
    max-width: none;
  }

  .role-pager {
    flex-wrap: wrap;
    gap: 6px;
  }
}
</style>
