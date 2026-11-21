<script setup lang="ts">
/**
 * 用户管理：左侧部门树 + 右侧账号列表。
 *
 * 四条边界，代码里都能找到对应实现：
 *   1. 账号 = 部门 + 一组角色，没有「类型」。谁能看什么只由角色决定；
 *   2. 「能不能动这一行」由服务端算（`operable`），前端照抄 —— 同级不能管同级，
 *      超管只有超管能动，自己不能删自己/停用自己；
 *   3. 重置密码、停用、删除都会让该账号的 token 立即失效（服务端做），前端只提示；
 *   4. 左树的节点只是**筛选条件**：可见范围由服务端按登录账号的
 *      「本部门 + 子部门」强制裁剪（超管不限），前端传什么都不能越界；
 *      非超管时根节点文案与部门列表都同步成自己的范围。
 *
 * 列表是服务端分页 + 服务端搜索：数据量一旦上千，前端过滤会先卡在「拉全量」上。
 * 表格用**固定列**：序号 / 昵称 / 操作钉在两侧，中间几列横向滚动 ——
 * 字段多到一屏放不下时，把人认出来的那几列必须一直在视野里。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  ElButton,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
  ElTree,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import NomiFieldTip from '../../../components/layout/NomiFieldTip.vue';
import NomiSpinner from '../../../components/layout/NomiSpinner.vue';
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { usePermission } from '../../../composables/usePermission';
import { usePermissionStore } from '../../../stores/permission';
import {
  addUser,
  deleteUsers,
  editUser,
  fetchDepartments,
  fetchLogs,
  fetchRoles,
  fetchUsers,
  resetUserPassword,
  setUsersStatus,
  type UserPayload,
} from '../../../services/permission';
import type {
  AdminLogItem,
  DepartmentItem,
  DepartmentNode,
  UserItem,
} from '../../../types/permission';
import { formatDateTime } from '../../../utils/format';

// pageFill：内容区铺满一屏，滚动只发生在表格内部（见 NomiPageContent 与 layout.scss）。
definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiAdminUsers' });

const { t } = useI18n();
const { auth } = usePermission();
const permissionStore = usePermissionStore();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
// 窄屏收起次要列、取消钉列：几列固定列加起来比手机屏还宽，中间什么也看不见。
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('auth.user.title')) });

const loading = ref(false);
const list = ref<UserItem[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const keyword = ref('');
const status = ref<'' | 'enable' | 'disable'>('');
const gender = ref<'' | 'unknown' | 'male' | 'female'>('');
/** 全库账号总数（不带任何筛选）：部门树根节点专用，不随筛选变化。 */
const allTotal = ref(0);
const selection = ref<UserItem[]>([]);

/** 左侧树：全部部门（id 0）作为根，下面挂真实的组织树。 */
const departments = ref<DepartmentItem[]>([]);
const deptKeyword = ref('');
const departmentId = ref(0);
const deptTreeRef = ref<InstanceType<typeof ElTree>>();

const roleOptions = ref<Array<{ id: number; name: string }>>([]);

const dialogVisible = ref(false);
const submitting = ref(false);
const editingId = ref<number | null>(null);
/** 正在编辑的是不是自己：自己的状态不能改，服务端也会再拦一次。 */
const editingSelf = ref(false);
const formRef = ref<FormInstance>();

const form = reactive({
  username: '',
  password: '',
  nickname: '',
  email: '',
  mobile: '',
  motto: '',
  gender: 'unknown' as 'unknown' | 'male' | 'female',
  status: 'enable',
  departmentId: 0,
  roles: [] as number[],
});

const detailVisible = ref(false);
const detailTarget = ref<UserItem | null>(null);
const detailLogs = ref<AdminLogItem[]>([]);
const detailLoading = ref(false);

const assignVisible = ref(false);
const assignTarget = ref<UserItem | null>(null);
const assignRoles = ref<number[]>([]);
const assignSubmitting = ref(false);

/** 分配部门：与分配角色一样，走编辑接口但只改 departmentId。 */
const deptAssignVisible = ref(false);
const deptAssignTarget = ref<UserItem | null>(null);
const deptAssignId = ref(0);
const deptAssignSubmitting = ref(false);

const passwordVisible = ref(false);
const passwordSubmitting = ref(false);
const passwordTarget = ref<UserItem | null>(null);
const passwordFormRef = ref<FormInstance>();
const passwordForm = reactive({ password: '' });

const canBatch = computed(() => auth('del') || auth('status'));

/**
 * 首屏加载：列表还是空的、请求还在飞。
 *
 * 这时候右侧表格里只有表头、左侧树也只有根节点，整页看上去像一张白纸 ——
 * 表格自身的 v-loading 只覆盖表体，撑不起「页面还活着」这个信号，所以这段时间
 * 改成整页转圈。翻页/刷新时列表里已有数据，仍旧用表体自己的遮罩，避免闪一下全屏。
 */
const pageLoading = computed(() => loading.value && list.value.length === 0);

const dialogTitle = computed(() =>
  editingId.value ? t('auth.user.edit') : t('auth.user.add'),
);

/** 扁平部门 → 树。父级缺失的节点按顶级处理，避免一次错数据让整棵树消失。 */
function buildDeptTree(rows: readonly DepartmentItem[]): DepartmentNode[] {
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

  /**
   * 节点数字 = 自己 + 所有下级部门的人数，和列表「点部门（含子部门）」的筛选口径一致。
   * 这是组织树的静态统计，不受搜索/状态/性别筛选影响。
   */
  const sumMembers = (node: DepartmentNode): number => {
    node.userCount += node.children.reduce((sum, child) => sum + sumMembers(child), 0);
    return node.userCount;
  };
  roots.forEach(sumMembers);
  return roots;
}

/** 非超管的「全部」其实只是本部门及下级，文案不能骗人。 */
const isScoped = computed(() => !permissionStore.isSuper);

/** 树的根节点 id 固定 0 —— 点它就是取消部门筛选。 */
const deptTree = computed<DepartmentNode[]>(() => [
  {
    id: 0,
    pid: -1,
    name: isScoped.value ? t('auth.user.departmentScope') : t('auth.user.departmentAll'),
    leader: '',
    phone: '',
    weigh: 0,
    status: 1,
    // 不用筛选后的 total：切部门/搜索时这个数字应该一直是「可见的全部人员」。
    userCount: allTotal.value,
    createTime: 0,
    updateTime: 0,
    children: buildDeptTree(departments.value),
  },
]);

const deptTreeProps = { label: 'name', children: 'children' } as const;

const rules = computed<FormRules>(() => ({
  username: [
    { required: true, message: t('auth.user.username'), trigger: 'blur' },
    { min: 3, max: 20, message: t('auth.user.usernameHint'), trigger: 'blur' },
    {
      pattern: /^[A-Za-z0-9_-]+$/,
      message: t('auth.user.usernameHint'),
      trigger: 'blur',
    },
  ],
  password: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        // 编辑不走这个字段：改密码在「重置密码」里，入口唯一才不会两处规则不一致。
        if (!editingId.value && !value) return callback(new Error(t('auth.user.password')));
        if (value && value.length < 6) return callback(new Error(t('auth.user.passwordHint')));
        return callback();
      },
      trigger: 'blur',
    },
  ],
  roles: [
    {
      validator: (_rule: unknown, value: number[], callback: (error?: Error) => void) => {
        if (!value || value.length === 0) return callback(new Error(t('auth.user.assignEmpty')));
        return callback();
      },
      trigger: 'change',
    },
  ],
  email: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (!value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return callback();
        return callback(new Error(t('auth.user.emailHint')));
      },
      trigger: 'blur',
    },
  ],
  mobile: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (!value || /^[0-9+\-() ]{5,20}$/.test(value)) return callback();
        return callback(new Error(t('auth.user.mobileHint')));
      },
      trigger: 'blur',
    },
  ],
}));

const passwordRules = computed<FormRules>(() => ({
  password: [
    { required: true, message: t('auth.user.password'), trigger: 'blur' },
    { min: 6, message: t('auth.user.passwordHint'), trigger: 'blur' },
  ],
}));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchUsers({
      page: page.value,
      limit: limit.value,
      keyword: keyword.value,
      status: status.value,
      gender: gender.value,
      departmentId: departmentId.value,
    });
    list.value = result.list;
    total.value = result.total;
    allTotal.value = result.allTotal;
    // 删掉当前页最后一条后别停在空页：往前退一页再拉。
    if (result.list.length === 0 && result.total > 0 && page.value > 1) {
      page.value -= 1;
      await load();
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

/** 左树数据：进页面就拉一次，之后只在增删改部门后才需要刷新。 */
async function loadDepartments(): Promise<void> {
  try {
    const result = await fetchDepartments();
    departments.value = result.list;
  } catch {
    // 没有部门管理权限时不打断用户列表：树里只剩「全部部门」。
    departments.value = [];
  }
}

/** 角色与部门只在打开弹窗时取：没有这些权限的人也能正常浏览账号列表。 */
async function ensureRoleOptions(): Promise<void> {
  if (roleOptions.value.length > 0) return;
  try {
    const result = await fetchRoles();
    roleOptions.value = result.list
      .filter((role) => role.assignable && role.status === 1)
      .map((role) => ({ id: role.id, name: role.name }));
  } catch {
    roleOptions.value = [];
  }
}

function search(): void {
  page.value = 1;
  void load();
}

function resetFilter(): void {
  keyword.value = '';
  status.value = '';
  gender.value = '';
  departmentId.value = 0;
  deptKeyword.value = '';
  page.value = 1;
  void load();
}

/** 点树只做一件事：换筛选条件。可见范围由服务端兜底，越界参数也只会得到空列表。 */
function onDeptClick(data: DepartmentNode): void {
  if (departmentId.value === data.id) return;
  departmentId.value = data.id;
  page.value = 1;
  void load();
}

/** el-tree 自带的过滤：命中的节点连同它的父链一起保留。 */
function filterDept(value: string, data: unknown): boolean {
  if (!value) return true;
  return String((data as DepartmentNode).name ?? '').includes(value);
}

watch(deptKeyword, (value) => {
  deptTreeRef.value?.filter(value.trim());
});

function onSelectionChange(rows: UserItem[]): void {
  selection.value = rows;
}

/** 自己这一行不能批量操作：服务端会拒绝「对自己执行」，与其报错不如不让选。 */
function selectable(raw: unknown): boolean {
  return !(raw as UserItem).self;
}

/** el-table 插槽的行类型是 DefaultRow，入口处统一收窄成业务类型。 */
function initial(raw: unknown): string {
  const row = raw as UserItem;
  return (row.nickname || row.username).slice(0, 1).toUpperCase();
}

/** 序号跨页连续：第 2 页第 1 行是 11，不是 1。 */
function rowIndex(index: number): number {
  return (page.value - 1) * limit.value + index + 1;
}

function openCreate(): void {
  editingId.value = null;
  editingSelf.value = false;
  Object.assign(form, {
    username: '',
    password: '',
    nickname: '',
    email: '',
    mobile: '',
    motto: '',
    gender: 'unknown' as const,
    status: 'enable',
    // 在某个部门下点「新增账号」时，默认就落在这个部门里 —— 少一次选择。
    // 非超管站在根节点(0)时退回自己部门：服务端不允许把新账号建成「未分配」。
    departmentId: isScoped.value
      ? (departmentId.value || permissionStore.adminInfo?.departmentId || 0)
      : departmentId.value,
    roles: [],
  });
  dialogVisible.value = true;
  void ensureRoleOptions();
  void nextTick(() => formRef.value?.clearValidate());
}

function openEdit(raw: unknown): void {
  const row = raw as UserItem;
  editingId.value = row.id;
  editingSelf.value = row.self;
  Object.assign(form, {
    username: row.username,
    password: '',
    nickname: row.nickname,
    email: row.email,
    mobile: row.mobile,
    motto: row.motto,
    gender: (row.gender || 'unknown') as 'unknown' | 'male' | 'female',
    status: row.status,
    departmentId: row.departmentId,
    roles: row.roles.map((role) => role.id),
  });
  dialogVisible.value = true;
  void ensureRoleOptions();
  void nextTick(() => formRef.value?.clearValidate());
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const payload: UserPayload = {
      username: form.username,
      nickname: form.nickname,
      email: form.email,
      mobile: form.mobile,
      motto: form.motto,
      gender: form.gender,
      status: form.status,
      departmentId: form.departmentId,
      roles: form.roles,
      ...(form.password ? { password: form.password } : {}),
    };
    if (editingId.value) await editUser({ ...payload, id: editingId.value });
    else await addUser(payload);
    ElMessage.success(t('auth.common.success'));
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function confirm(
  message: string,
  title: string,
  confirmText = t('auth.common.save'),
): Promise<boolean> {
  const result = await ElMessageBox.confirm(message, title, {
    type: 'warning',
    confirmButtonText: confirmText,
    cancelButtonText: t('auth.common.cancel'),
  }).catch(() => false);
  return Boolean(result);
}

async function remove(raw: unknown): Promise<void> {
  const row = raw as UserItem;
  const okToDelete = await confirm(
    `${t('auth.common.confirmDelete')}\n${row.username}`,
    t('auth.user.title'),
    t('auth.action.delete'),
  );
  if (!okToDelete) return;

  try {
    await deleteUsers([row.id]);
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function batchRemove(): Promise<void> {
  if (selection.value.length === 0) return;
  const okToDelete = await confirm(
    t('auth.user.confirmBatchDelete', { count: selection.value.length }),
    t('auth.user.batchDelete'),
    t('auth.action.delete'),
  );
  if (!okToDelete) return;

  try {
    await deleteUsers(selection.value.map((row) => row.id));
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function applyStatus(ids: number[], next: 'enable' | 'disable'): Promise<void> {
  if (next === 'disable') {
    const okToDisable = await confirm(
      t('auth.user.confirmDisable', { count: ids.length }),
      t('auth.user.title'),
      t('auth.user.disable'),
    );
    if (!okToDisable) return;
  }
  try {
    await setUsersStatus(ids, next);
    ElMessage.success(t('auth.common.success'));
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function toggleStatus(raw: unknown, enable: boolean): void {
  const row = raw as UserItem;
  void applyStatus([row.id], enable ? 'enable' : 'disable');
}

function batchStatus(next: 'enable' | 'disable'): void {
  if (selection.value.length === 0) return;
  void applyStatus(
    selection.value.map((row) => row.id),
    next,
  );
}

/**
 * 详情：资料 + 该账号最近的操作。
 *
 * 日志是全员可见的（服务端不再按登录人裁剪），所以这里不需要再判超管。
 */
async function openDetail(raw: unknown): Promise<void> {
  const row = raw as UserItem;
  detailTarget.value = row;
  detailLogs.value = [];
  detailVisible.value = true;

  detailLoading.value = true;
  try {
    const result = await fetchLogs({ userId: row.id, limit: 8 });
    detailLogs.value = result.list;
  } catch {
    // 日志是附加信息，拉不到不影响看账号资料。
    detailLogs.value = [];
  } finally {
    detailLoading.value = false;
  }
}

/** 分配角色：走编辑接口但只改角色，不动其他字段。 */
function openAssign(raw: unknown): void {
  const row = raw as UserItem;
  assignTarget.value = row;
  assignRoles.value = row.roles.map((role) => role.id);
  assignVisible.value = true;
  void ensureRoleOptions();
}

async function submitAssign(): Promise<void> {
  const row = assignTarget.value;
  if (!row) return;
  if (assignRoles.value.length === 0) {
    ElMessage.warning(t('auth.user.assignEmpty'));
    return;
  }

  assignSubmitting.value = true;
  try {
    await editUser({
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      mobile: row.mobile,
      motto: row.motto,
      gender: row.gender || 'unknown',
      status: row.status,
      departmentId: row.departmentId,
      roles: assignRoles.value,
    });
    ElMessage.success(t('auth.common.success'));
    assignVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    assignSubmitting.value = false;
  }
}

/** 操作列的「三个圆点」下拉：把低频且有破坏性的动作收进去。 */
function onRowCommand(command: unknown, raw: unknown): void {
  switch (String(command)) {
    case 'roles':
      openAssign(raw);
      break;
    case 'department':
      openAssignDepartment(raw);
      break;
    case 'delete':
      void remove(raw);
      break;
  }
}

function openAssignDepartment(raw: unknown): void {
  const row = raw as UserItem;
  deptAssignTarget.value = row;
  deptAssignId.value = Number(row.departmentId ?? 0) || 0;
  deptAssignVisible.value = true;
  if (departments.value.length === 0) void loadDepartments();
}

async function submitAssignDepartment(): Promise<void> {
  const row = deptAssignTarget.value;
  if (!row) return;
  deptAssignSubmitting.value = true;
  try {
    await editUser({
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      mobile: row.mobile,
      motto: row.motto,
      gender: row.gender || 'unknown',
      status: row.status,
      departmentId: deptAssignId.value,
      roles: row.roles.map((role) => role.id),
    });
    ElMessage.success(t('auth.common.success'));
    deptAssignVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    deptAssignSubmitting.value = false;
  }
}

/** 性别展示：未知值按「保密」处理，和写入侧的白名单保持一致。 */
function genderText(value: string | undefined): string {
  if (value === 'male') return t('auth.user.genderMale');
  if (value === 'female') return t('auth.user.genderFemale');
  return t('auth.user.genderUnknown');
}

/** 日志里的 title 存的是 i18n key（如 auth.action.delete），展示前翻一下。 */
function logTitle(log: AdminLogItem): string {
  const title = log.title || log.url;
  return title.startsWith('auth.') || title.startsWith('layout.') ? t(title) : title;
}

function openReset(raw: unknown): void {
  const row = raw as UserItem;
  passwordTarget.value = row;
  passwordForm.password = '';
  passwordVisible.value = true;
  void nextTick(() => passwordFormRef.value?.clearValidate());
}

async function submitReset(): Promise<void> {
  if (!passwordFormRef.value || !passwordTarget.value) return;
  const valid = await passwordFormRef.value.validate().catch(() => false);
  if (!valid) return;

  passwordSubmitting.value = true;
  try {
    await resetUserPassword(passwordTarget.value.id, passwordForm.password);
    ElMessage.success(t('auth.common.success'));
    passwordVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    passwordSubmitting.value = false;
  }
}

onMounted(() => {
  void load();
  void loadDepartments();
});
</script>

<template>
  <div class="page-fill users-page">
    <!-- 首屏（整页还是空的）用整页转圈；有数据之后的翻页/搜索交给表格自己的遮罩 -->
    <div v-if="pageLoading" class="users-loading">
      <NomiSpinner :size="58" :label="t('app.loading')" />
    </div>

    <div class="users-layout">
      <!-- 左侧：部门树。搜索框在上、树在下，树自己滚（整页不滚）。 -->
      <aside class="dept-panel">
        <ElInput
          v-model="deptKeyword"
          class="dept-search"
          :placeholder="t('auth.user.departmentSearch')"
          clearable
        />
        <p v-if="isScoped" class="scope-hint">{{ t('auth.user.scopeHint') }}</p>
        <div class="dept-tree">
          <ElTree
            ref="deptTreeRef"
            :data="deptTree"
            :props="deptTreeProps"
            node-key="id"
            :current-node-key="departmentId"
            :filter-node-method="filterDept"
            default-expand-all
            highlight-current
            :expand-on-click-node="false"
            @node-click="onDeptClick"
          >
            <template #default="{ data }">
              <span class="dept-node">
                <span class="dept-node__label">{{ data.name }}</span>
                <span v-if="data.userCount" class="dept-node__count">{{ data.userCount }}</span>
              </span>
            </template>
          </ElTree>
        </div>
      </aside>

      <section class="page-content">
        <div class="toolbar">
          <ElInput
            v-model="keyword"
            class="toolbar-search"
            :placeholder="t('auth.user.keyword')"
            clearable
            @keyup.enter="search"
            @clear="search"
          />
          <ElSelect v-model="status" class="toolbar-status" clearable @change="search">
            <ElOption :label="t('auth.common.all')" value="" />
            <ElOption :label="t('auth.common.enabled')" value="enable" />
            <ElOption :label="t('auth.common.disabled')" value="disable" />
          </ElSelect>
          <ElSelect
            v-model="gender"
            class="toolbar-gender"
            clearable
            :placeholder="t('auth.user.gender')"
            @change="search"
          >
            <ElOption :label="t('auth.common.all')" value="" />
            <ElOption :label="t('auth.user.genderUnknown')" value="unknown" />
            <ElOption :label="t('auth.user.genderMale')" value="male" />
            <ElOption :label="t('auth.user.genderFemale')" value="female" />
          </ElSelect>
          <div class="toolbar-actions">
            <ElButton type="primary" @click="search">{{ t('auth.action.search') }}</ElButton>
            <ElButton @click="resetFilter">{{ t('auth.action.reset') }}</ElButton>
          </div>
          <ElButton v-if="auth('add')" class="toolbar-add" type="primary" @click="openCreate">
            {{ t('auth.user.add') }}
          </ElButton>
        </div>

        <div v-if="selection.length > 0" class="batch-bar">
          <span class="batch-count">{{ t('auth.user.selected', { count: selection.length }) }}</span>
          <ElButton v-if="auth('status')" size="small" @click="batchStatus('enable')">
            {{ t('auth.user.batchEnable') }}
          </ElButton>
          <ElButton v-if="auth('status')" size="small" @click="batchStatus('disable')">
            {{ t('auth.user.batchDisable') }}
          </ElButton>
          <ElButton v-if="auth('del')" size="small" type="danger" plain @click="batchRemove">
            {{ t('auth.user.batchDelete') }}
          </ElButton>
        </div>

        <div ref="tableWrap" class="nomi-table-fill">
          <!--
            固定列：序号 + 昵称（左）、操作（右）。中间几列给固定宽度而不是 min-width，
            否则 Element 会「拉伸填满」而不是「溢出滚动」，横向滚动条永远不会出现。
          -->
          <ElTable
            v-loading="loading && list.length > 0"
            :height="tableHeight"
            :data="list"
            row-key="id"
            border
            stripe
            :empty-text="t('auth.user.empty')"
            @selection-change="onSelectionChange"
          >
            <ElTableColumn
              v-if="canBatch"
              type="selection"
              :width="isNarrow ? 40 : 46"
              :fixed="isMobile ? false : 'left'"
              :selectable="selectable"
            />
            <ElTableColumn
              :label="t('auth.user.seq')"
              :width="isNarrow ? 48 : 62"
              :fixed="isMobile ? false : 'left'"
            >
              <template #default="{ $index }">{{ rowIndex($index) }}</template>
            </ElTableColumn>
            <ElTableColumn
              :label="t('auth.user.nickname')"
              :width="isMobile ? 130 : 220"
              :fixed="isMobile ? false : 'left'"
            >
              <template #default="{ row }">
                <div class="user-cell">
                  <span class="user-avatar">{{ initial(row) }}</span>
                  <span class="user-meta">
                    <span class="user-name-line">
                      <strong class="user-name">{{ row.nickname || row.username }}</strong>
                      <ElTag v-if="row.self" size="small" type="success">{{ t('auth.user.self') }}</ElTag>
                      <ElTag v-if="row.isSuper" size="small" type="danger">{{ t('auth.user.super') }}</ElTag>
                    </span>
                    <span class="user-account">@{{ row.username }}</span>
                  </span>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!isMobile" :label="t('auth.user.department')" width="140">
              <template #default="{ row }">
                <span :class="{ muted: !row.departmentName }">
                  {{ row.departmentName || t('auth.user.departmentNone') }}
                </span>
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!isMobile" :label="t('auth.user.roles')" width="160">
              <template #default="{ row }">
                <ElTag v-for="role in row.roles" :key="role.id" size="small" class="role-tag">
                  {{ role.name }}
                </ElTag>
                <span v-if="row.roles.length === 0" class="muted">{{ t('auth.user.noGroups') }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!isMobile" :label="t('auth.user.contact')" width="180">
              <template #default="{ row }">
                <div class="contact-cell">
                  <span :class="{ muted: !row.email }">{{ row.email || '—' }}</span>
                  <span class="contact-mobile" :class="{ muted: !row.mobile }">{{ row.mobile || '—' }}</span>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!isMobile" :label="t('auth.user.gender')" width="80">
              <template #default="{ row }">{{ genderText(row.gender) }}</template>
            </ElTableColumn>
            <!-- 状态统一用开关：无权限/不能动自己时置灰，仍然显示真实状态；停用态是红色 -->
            <ElTableColumn :label="t('auth.common.status')" :width="isNarrow ? 76 : 92">
              <template #default="{ row }">
                <ElSwitch
                  :model-value="row.status === 'enable'"
                  size="small"
                  width="58"
                  inline-prompt
                  :active-text="t('auth.user.enableShort')"
                  :inactive-text="t('auth.user.disableShort')"
                  style="--el-switch-off-color: var(--el-color-danger)"
                  :disabled="!auth('status') || !row.operable || row.self"
                  @change="(value: string | number | boolean) => toggleStatus(row, Boolean(value))"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn v-if="!isMobile" :label="t('auth.user.lastLogin')" width="170">
              <template #default="{ row }">
                <div v-if="row.lastLoginTime" class="login-cell">
                  <span>{{ formatDateTime(row.lastLoginTime) }}</span>
                  <span v-if="row.lastLoginIp" class="login-ip">{{ row.lastLoginIp }}</span>
                </div>
                <span v-else class="muted">{{ t('auth.user.neverLogin') }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn
              :label="t('auth.common.actions')"
              :width="isMobile ? 132 : 220"
              :fixed="isMobile ? false : 'right'"
            >
              <template #default="{ row }">
                <ElButton link type="primary" @click="openDetail(row)">
                  {{ t('auth.user.detail') }}
                </ElButton>
                <ElButton v-if="auth('edit') && row.operable" link type="primary" @click="openEdit(row)">
                  {{ t('auth.user.modify') }}
                </ElButton>
                <ElButton
                  v-if="auth('resetPwd') && row.operable"
                  link
                  type="primary"
                  @click="openReset(row)"
                >
                  {{ t('auth.user.resetPassword') }}
                </ElButton>
                <!--
                  低频、且有破坏性的三个动作（分配角色 / 分配部门 / 删除）收进「三个圆点」下拉，
                  操作列只留 详情 / 修改 / 重置密码 三个高频入口。
                  触发器刻意用原生 button 而不是 link 态 ElButton：link 按钮把 hover 背景
                  写死成 transparent，圆点想要一块 hover 底色得反复提优先级，不值当。
                -->
                <ElDropdown
                  v-if="(auth('edit') && row.operable) || (auth('del') && row.operable && !row.self)"
                  class="row-more-dropdown"
                  trigger="click"
                  placement="bottom-end"
                  popper-class="user-row-more-menu"
                  @command="(command: unknown) => onRowCommand(command, row)"
                >
                  <button
                    type="button"
                    class="row-more"
                    :title="t('auth.user.moreActions')"
                    :aria-label="t('auth.user.moreActions')"
                  >
                    <span class="more-dots" aria-hidden="true"><i /><i /><i /></span>
                  </button>
                  <template #dropdown>
                    <ElDropdownMenu>
                      <ElDropdownItem v-if="auth('edit') && row.operable" command="roles">
                        {{ t('auth.user.assignRole') }}
                      </ElDropdownItem>
                      <ElDropdownItem v-if="auth('edit') && row.operable" command="department">
                        {{ t('auth.user.assignDepartment') }}
                      </ElDropdownItem>
                      <ElDropdownItem
                        v-if="auth('del') && row.operable && !row.self"
                        class="is-danger"
                        command="delete"
                        divided
                      >
                        {{ t('auth.action.delete') }}
                      </ElDropdownItem>
                    </ElDropdownMenu>
                  </template>
                </ElDropdown>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>

        <div class="pager">
          <ElPagination
            v-model:current-page="page"
            v-model:page-size="limit"
            :total="total"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
            @size-change="search"
            @current-change="load"
          />
        </div>
      </section>
    </div>

    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      class="nomi-user-dialog"
      width="720px"
      top="6vh"
      destroy-on-close
    >
      <!-- 两列栅格：字段多，单列会被迫滚动；这里一屏放完，窄屏自动退化成一列 -->
      <!-- 108px 按英文最长的 Department 留的：标签右对齐，中文看不出差别，英文也不会顶到弹窗边缘 -->
      <ElForm ref="formRef" :model="form" :rules="rules" class="tip-form" label-width="108px">
        <div class="user-form-grid">
          <ElFormItem prop="username">
            <template #label>
              <span class="form-label">
                {{ t('auth.user.username') }}
                <NomiFieldTip :content="t('auth.user.usernameHint')" />
              </span>
            </template>
            <ElInput v-model="form.username" :disabled="Boolean(editingId)" maxlength="20" />
          </ElFormItem>
          <ElFormItem v-if="!editingId" prop="password" required>
            <template #label>
              <span class="form-label">
                {{ t('auth.user.password') }}
                <NomiFieldTip :content="t('auth.user.passwordHint')" />
              </span>
            </template>
            <ElInput
              v-model="form.password"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </ElFormItem>
          <ElFormItem :label="t('auth.user.nickname')">
            <ElInput v-model="form.nickname" maxlength="50" :placeholder="t('auth.user.nicknameHint')" />
          </ElFormItem>
          <ElFormItem :label="t('auth.user.gender')">
            <ElSelect v-model="form.gender" class="full">
              <ElOption :label="t('auth.user.genderUnknown')" value="unknown" />
              <ElOption :label="t('auth.user.genderMale')" value="male" />
              <ElOption :label="t('auth.user.genderFemale')" value="female" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem>
            <template #label>
              <span class="form-label">
                {{ t('auth.user.department') }}
                <NomiFieldTip :content="t('auth.user.departmentHint')" />
              </span>
            </template>
            <ElSelect v-model="form.departmentId" class="full" clearable>
              <ElOption
                v-if="!isScoped || form.departmentId === 0"
                :label="t('auth.user.departmentNone')"
                :value="0"
              />
              <ElOption
                v-for="dept in departments"
                :key="dept.id"
                :label="dept.name"
                :value="dept.id"
                :disabled="dept.status !== 1"
              />
            </ElSelect>
          </ElFormItem>
          <!-- 编辑态没有密码字段，半宽项会变成奇数：状态占满一行，避免右侧留空 -->
          <ElFormItem :class="{ 'span-2': Boolean(editingId) }">
            <template #label>
              <span class="form-label">
                {{ t('auth.common.status') }}
                <NomiFieldTip v-if="editingSelf" :content="t('auth.user.selfHint')" />
              </span>
            </template>
            <ElSwitch
              :model-value="form.status === 'enable'"
              inline-prompt
              :active-text="t('auth.user.enableShort')"
              :inactive-text="t('auth.user.disableShort')"
              style="--el-switch-off-color: var(--el-color-danger)"
              :disabled="editingSelf"
              @change="(value: string | number | boolean) => (form.status = Boolean(value) ? 'enable' : 'disable')"
            />
          </ElFormItem>
          <ElFormItem :label="t('auth.user.email')" prop="email">
            <ElInput v-model="form.email" maxlength="100" />
          </ElFormItem>
          <ElFormItem :label="t('auth.user.mobile')" prop="mobile">
            <ElInput v-model="form.mobile" maxlength="20" />
          </ElFormItem>
          <ElFormItem class="span-2" prop="roles">
            <template #label>
              <span class="form-label">
                {{ t('auth.user.roles') }}
                <NomiFieldTip :content="t('auth.user.groupsHint')" />
              </span>
            </template>
            <ElSelect v-model="form.roles" multiple class="full">
              <ElOption
                v-for="role in roleOptions"
                :key="role.id"
                :label="role.name"
                :value="role.id"
              />
            </ElSelect>
          </ElFormItem>
          <ElFormItem class="span-2" :label="t('auth.user.motto')">
            <ElInput
              v-model="form.motto"
              type="textarea"
              :rows="2"
              maxlength="255"
              show-word-limit
            />
          </ElFormItem>
        </div>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">{{ t('auth.common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="submitting" @click="submit">
          {{ t('auth.common.save') }}
        </ElButton>
      </template>
    </ElDialog>

    <ElDrawer v-model="detailVisible" :title="t('auth.user.detailTitle')" size="440px">
      <template v-if="detailTarget">
        <div class="detail-head">
          <span class="user-avatar detail-avatar">
            {{ (detailTarget.nickname || detailTarget.username).slice(0, 1).toUpperCase() }}
          </span>
          <div class="detail-identity">
            <strong>{{ detailTarget.nickname || detailTarget.username }}</strong>
            <span class="detail-account">@{{ detailTarget.username }}</span>
          </div>
          <ElTag v-if="detailTarget.isSuper" size="small" type="danger">
            {{ t('auth.user.super') }}
          </ElTag>
        </div>

        <h3 class="detail-title">{{ t('auth.user.basicInfo') }}</h3>
        <dl class="detail-list">
          <div>
            <dt>{{ t('auth.user.department') }}</dt>
            <dd>{{ detailTarget.departmentName || t('auth.user.departmentNone') }}</dd>
          </div>
          <div>
            <dt>{{ t('auth.user.gender') }}</dt>
            <dd>{{ genderText(detailTarget.gender) }}</dd>
          </div>
          <div>
            <dt>{{ t('auth.common.status') }}</dt>
            <dd>{{ detailTarget.status === 'enable' ? t('auth.common.enabled') : t('auth.common.disabled') }}</dd>
          </div>
          <div>
            <dt>{{ t('auth.user.roles') }}</dt>
            <dd>
              {{
                detailTarget.roles.length
                  ? detailTarget.roles.map((role) => role.name).join('、')
                  : t('auth.user.noGroups')
              }}
            </dd>
          </div>
          <div><dt>{{ t('auth.user.email') }}</dt><dd>{{ detailTarget.email || '—' }}</dd></div>
          <div><dt>{{ t('auth.user.mobile') }}</dt><dd>{{ detailTarget.mobile || '—' }}</dd></div>
          <div><dt>{{ t('auth.user.motto') }}</dt><dd>{{ detailTarget.motto || '—' }}</dd></div>
          <div><dt>{{ t('auth.user.createTime') }}</dt><dd>{{ formatDateTime(detailTarget.createTime) }}</dd></div>
          <div>
            <dt>{{ t('auth.user.lastLogin') }}</dt>
            <dd>
              <template v-if="detailTarget.lastLoginTime">
                <span class="detail-line">{{ formatDateTime(detailTarget.lastLoginTime) }}</span>
                <span v-if="detailTarget.lastLoginIp" class="detail-line muted">
                  {{ detailTarget.lastLoginIp }}
                </span>
              </template>
              <span v-else class="muted">{{ t('auth.user.neverLogin') }}</span>
            </dd>
          </div>
          <div>
            <dt>{{ t('auth.user.loginFailure') }}</dt>
            <dd>{{ detailTarget.loginFailure }}</dd>
          </div>
        </dl>

        <h3 class="detail-title">{{ t('auth.user.recentOps') }}</h3>
        <div v-loading="detailLoading" class="detail-logs">
          <div v-for="log in detailLogs" :key="log.id" class="detail-log">
            <span class="detail-log-time">{{ formatDateTime(log.create_time) }}</span>
            <span class="detail-log-title" :title="log.url">{{ logTitle(log) }}</span>
            <span class="detail-log-ip">{{ log.ip }}</span>
          </div>
          <p v-if="!detailLoading && detailLogs.length === 0" class="muted">
            {{ t('auth.user.noOps') }}
          </p>
        </div>
      </template>

      <template #footer>
        <ElButton @click="detailVisible = false">{{ t('auth.common.close') }}</ElButton>
      </template>
    </ElDrawer>

    <ElDialog v-model="assignVisible" :title="t('auth.user.assignTitle')" width="460px" destroy-on-close>
      <p class="assign-target">
        {{ assignTarget?.nickname || assignTarget?.username }}
        <span class="muted">@{{ assignTarget?.username }}</span>
      </p>
      <ElForm class="tip-form" label-width="auto">
        <ElFormItem>
          <template #label>
            <span class="form-label">
              {{ t('auth.user.roles') }}
              <NomiFieldTip :content="t('auth.user.assignHint')" />
            </span>
          </template>
          <ElSelect v-model="assignRoles" multiple class="full">
            <ElOption
              v-for="role in roleOptions"
              :key="role.id"
              :label="role.name"
              :value="role.id"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="assignVisible = false">{{ t('auth.common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="assignSubmitting" @click="submitAssign">
          {{ t('auth.common.save') }}
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="deptAssignVisible"
      :title="t('auth.user.assignDepartmentTitle')"
      width="460px"
      destroy-on-close
    >
      <p class="assign-target">
        {{ deptAssignTarget?.nickname || deptAssignTarget?.username }}
        <span class="muted">@{{ deptAssignTarget?.username }}</span>
      </p>
      <ElForm class="tip-form" label-width="auto">
        <ElFormItem>
          <template #label>
            <span class="form-label">
              {{ t('auth.user.department') }}
              <NomiFieldTip :content="t('auth.user.assignDepartmentHint')" />
            </span>
          </template>
          <ElSelect v-model="deptAssignId" class="full">
            <ElOption
              v-if="!isScoped || deptAssignId === 0"
              :label="t('auth.user.departmentNone')"
              :value="0"
            />
            <ElOption
              v-for="dept in departments"
              :key="dept.id"
              :label="dept.name"
              :value="dept.id"
              :disabled="dept.status === 0"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="deptAssignVisible = false">{{ t('auth.common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="deptAssignSubmitting" @click="submitAssignDepartment">
          {{ t('auth.common.save') }}
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="passwordVisible" :title="t('auth.user.resetTitle')" width="420px" destroy-on-close>
      <ElForm
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        class="tip-form"
        label-width="auto"
      >
        <ElFormItem :label="t('auth.user.username')">
          <span>{{ passwordTarget?.nickname || passwordTarget?.username }}</span>
        </ElFormItem>
        <ElFormItem prop="password">
          <template #label>
            <span class="form-label">
              {{ t('auth.user.password') }}
              <NomiFieldTip :content="t('auth.user.resetHint')" />
            </span>
          </template>
          <ElInput
            v-model="passwordForm.password"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="passwordVisible = false">{{ t('auth.common.cancel') }}</ElButton>
        <ElButton type="primary" :loading="passwordSubmitting" @click="submitReset">
          {{ t('auth.common.save') }}
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
/* 整页加载遮罩：首屏列表还没回来时盖住整页（左树 + 右表），
   别让人对着一张像白纸的空页面猜「是不是卡了」。 */
.users-page {
  position: relative;
}

.users-loading {
  position: absolute;
  z-index: 12;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(2px);
  border-radius: calc(var(--nomi-radius, 12px) / 2 + 2px);
}

/* 左右两栏：左树定宽，右侧卡片吃掉剩余宽度。整页不滚，树和表格各自滚。 */
.users-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 14px;
}

.dept-panel {
  display: flex;
  width: 236px;
  flex: 0 0 236px;
  min-height: 0;
  flex-direction: column;
  padding: 14px;
  background: var(--nomi-card);
  border: 1px solid var(--nomi-border);
  border-radius: calc(var(--nomi-radius) / 2 + 2px);
  box-shadow: var(--nomi-shadow);
}

.dept-search {
  margin-bottom: 10px;
}

.scope-hint {
  margin: -2px 0 10px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.dept-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.dept-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  overflow: hidden;
}

.dept-node__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dept-node__count {
  flex-shrink: 0;
  color: var(--fg-muted);
  font-size: 11px;
}

.users-layout .page-content {
  flex: 1;
  min-width: 0;
}

@media (max-width: 980px) {
  .users-layout {
    flex-direction: column;
  }

  .dept-panel {
    width: 100%;
    flex: 0 0 auto;
    max-height: 220px;
  }
}

/* 新增/编辑弹窗：两列栅格，避免字段排成一长列需要滚动。 */
.user-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.user-form-grid .span-2 {
  grid-column: 1 / -1;
}

/*
 * label 的 32px 行高正好和输入框对齐，本来居中就行；但校验失败时输入框下方会
 * 多出一行红字，居中会把这一行的 label 一起往下推，和旁边那列的标签错位。
 * 统一顶对齐，标签永远贴着输入框的顶边。
 */
.user-form-grid :deep(.el-form-item) {
  align-items: flex-start;
}

@media (max-width: 720px) {
  .user-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 操作列是五个文字按钮，Element 默认的 12px 间距会把最后一个挤到第二行。 */
:deep(.el-table .el-button + .el-button) {
  margin-left: 8px;
}

/* 下拉触发器外面包了一层 .el-dropdown，相邻兄弟选择器管不到它，间距单独给。 */
.row-more-dropdown {
  margin-top: 0;
  margin-left: 8px;
  vertical-align: middle;
}

/*
 * 「更多」= 24px 圆形热区 + 三个圆点。
 * 圆点用 3.5px 的方块各自成圆，比字符「…」在各字体下的基线稳定得多。
 */
.row-more {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--el-color-primary);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s var(--ease, ease);
}

.row-more:hover,
.row-more:focus-visible {
  background: var(--nomi-hover);
  outline: none;
}

.more-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.more-dots i {
  display: block;
  width: 3.5px;
  height: 3.5px;
  background: currentColor;
  border-radius: 50%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

/* Element Plus 给相邻按钮塞了 margin-left:12px，会和 flex 的 gap 叠加成 22px。
   工具栏里统一清掉，间距只由 gap 决定。 */
.toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-search {
  width: 220px;
}

.toolbar-add {
  margin-left: auto;
}

.toolbar-status,
.toolbar-gender {
  width: 110px;
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--nomi-hover);
  border-radius: 8px;
}

.batch-count {
  color: var(--fg-muted);
  font-size: 12px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-avatar {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: var(--nomi-hover);
  border-radius: 50%;
  font-size: 12px;
}

.user-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  overflow: hidden;
}

.user-name {
  overflow: hidden;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-account {
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-tag {
  margin-right: 4px;
}

.contact-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.contact-mobile {
  color: var(--fg-muted);
  font-size: 12px;
}

.login-cell {
  display: flex;
  flex-direction: column;
}

.login-ip {
  color: var(--fg-muted);
  font-size: 12px;
}

.muted {
  color: var(--fg-muted);
}

.full {
  width: 100%;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

@media (max-width: 640px) {
  .toolbar-search,
  .toolbar-status,
  .toolbar-gender {
    width: 100%;
  }
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--nomi-border);
}

.detail-avatar {
  width: 44px;
  height: 44px;
  font-size: 16px;
}

.detail-identity {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.detail-account {
  color: var(--fg-muted);
  font-size: 12px;
}

.detail-title {
  margin: 18px 0 10px;
  font-size: 13px;
  font-weight: 600;
}

.detail-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
  margin: 0;
}

.detail-list dt {
  color: var(--fg-muted);
  font-size: 12px;
}

.detail-line {
  display: block;
}

.detail-list dd {
  margin: 2px 0 0;
  font-size: 13px;
  word-break: break-all;
}

.detail-logs {
  display: flex;
  min-height: 60px;
  flex-direction: column;
  gap: 8px;
}

.detail-log {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 10px;
  background: var(--nomi-hover);
  border-radius: 6px;
  font-size: 12px;
}

.detail-log-time {
  color: var(--fg-muted);
  white-space: nowrap;
}

.detail-log-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-log-ip {
  color: var(--fg-muted);
}

.assign-target {
  margin: 0 0 10px;
  font-size: 13px;
}
</style>

<style>
/*
 * 行内「更多」下拉的菜单由 el-popper teleport 到 body，scoped 选择器够不到，
 * 这里用 popper-class 兜住唯一需要改的一条：删除项永远是危险色。
 */
.user-row-more-menu .is-danger {
  color: var(--el-color-danger);
}

.user-row-more-menu .is-danger:hover,
.user-row-more-menu .is-danger:focus {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
</style>
