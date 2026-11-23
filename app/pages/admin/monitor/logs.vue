<script setup lang="ts">
/**
 * 系统日志：两个 Tab 共用一页。
 *
 * · 登录日志 = login_log（登录/退出/失败/锁定/强退）
 * · 操作日志 = operation_log（写接口审计），点「操作时间」在右侧抽屉看一次请求的完整上下文
 *
 * 详情按需加载：列表不返回响应体这类大字段，只有打开抽屉时才按 id 取，
 * 翻一页不会把几十 KB 报文拉到浏览器；打开过的行会缓存，来回点不重复请求。
 * 抽屉里把报文拆成「请求信息 / 响应信息」两块，各自切换请求头/请求体、响应头/响应体，
 * 并各自带复制按钮 —— 一次能同时看到请求和响应，不必在四块报文间来回切。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  ElButton,
  ElDrawer,
  ElInput,
  ElMessage,
  ElOption,
  ElPagination,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
} from 'element-plus';
import { useFillTable } from '../../../composables/useFillTable';
import {
  fetchLoginLogs,
  fetchOperationLogDetail,
  fetchOperationLogs,
} from '../../../services/monitor';
import type { LoginLogItem, OperationLogDetail, OperationLogItem } from '../../../types/monitor';
import { copyText } from '../../../utils/clipboard';
import { formatDateTime } from '../../../utils/format';
import { highlightJson, prettifyJson } from '../../../utils/json-highlight';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiMonitorLogs' });

const { t, te } = useI18n();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
useHead({ title: computed(() => t('monitor.logs.title')) });

type TabName = 'login' | 'operation';
type PayloadKind = 'request' | 'response';
type PayloadPart = 'headers' | 'body';

const activeTab = ref<TabName>('login');
const loaded = reactive<Record<TabName, boolean>>({ login: false, operation: false });

// 两个 Tab 各留一份筛选与分页：切回来时还停在上次看的那一页。
const loginState = reactive({ list: [] as LoginLogItem[], total: 0, page: 1, size: 20, loading: false, keyword: '', behavior: '', status: '' });
const opState = reactive({ list: [] as OperationLogItem[], total: 0, page: 1, size: 20, loading: false, keyword: '', module: '', status: '' });

// 抽屉：一次只开一行；`details` 按 id 缓存，同一行重复打开不再请求。
const drawerVisible = ref(false);
const drawerRow = ref<OperationLogItem | null>(null);
const drawerDetail = ref<OperationLogDetail | null>(null);
const drawerLoading = ref(false);
// 两块报文各自记住当前看到的是头还是体；默认展示体（排障最常见）。
const requestPart = ref<PayloadPart>('body');
const responsePart = ref<PayloadPart>('body');
const details = reactive<Record<number, OperationLogDetail>>({});

const behaviorOptions = computed(() => [
  { value: 'login', label: t('monitor.loginLog.behaviorLogin') },
  { value: 'logout', label: t('monitor.loginLog.behaviorLogout') },
  { value: 'failed', label: t('monitor.loginLog.behaviorFailed') },
  { value: 'locked', label: t('monitor.loginLog.behaviorLocked') },
  { value: 'kick', label: t('monitor.loginLog.behaviorKick') },
]);
const statusOptions = computed(() => [
  { value: 'success', label: t('monitor.common.success') },
  { value: 'fail', label: t('monitor.common.fail') },
]);
const moduleOptions = computed(() => [
  'monitor.module.user', 'monitor.module.department', 'monitor.module.role',
  'monitor.module.rule', 'monitor.module.language', 'monitor.module.log',
  'monitor.module.monitor', 'monitor.module.auth', 'monitor.module.settings',
  'monitor.module.profile', 'monitor.module.business', 'monitor.module.other',
].map((key) => ({ value: key, label: t(key) })));

// 两块报文各自的按钮组：体在前，头在后。
const requestOptions = computed<Array<{ value: PayloadPart; label: string }>>(() => [
  { value: 'body', label: t('monitor.detail.requestBody') },
  { value: 'headers', label: t('monitor.detail.requestHeaders') },
]);
const responseOptions = computed<Array<{ value: PayloadPart; label: string }>>(() => [
  { value: 'body', label: t('monitor.detail.responseBody') },
  { value: 'headers', label: t('monitor.detail.responseHeaders') },
]);

/** 日志里的 title / module / 地点存的都是词条键，命中就翻译，否则原样显示。 */
function entryText(raw?: string): string {
  if (!raw) return '—';
  return te(raw) ? t(raw) : raw;
}

function locationText(raw?: string): string {
  // 历史日志里可能存着空串（当时没配归属地服务），给明确文案而不是一个破折号。
  if (!raw) return t('monitor.location.unknown');
  return te(raw) ? t(raw) : raw;
}

function behaviorText(value: string): string {
  const map: Record<string, string> = {
    login: 'behaviorLogin', logout: 'behaviorLogout', failed: 'behaviorFailed',
    locked: 'behaviorLocked', kick: 'behaviorKick',
  };
  return map[value] ? t(`monitor.loginLog.${map[value]}`) : value || '—';
}

function rowIndex(index: number, page: number, size: number): number {
  return (page - 1) * size + index + 1;
}

/** 按钮组的值 → 详情字段。库里是 snake_case，请求体那一列叫 data。 */
const PAYLOAD_FIELD: Record<PayloadKind, Record<PayloadPart, 'request_headers' | 'data' | 'response_headers' | 'response_body'>> = {
  request: { headers: 'request_headers', body: 'data' },
  response: { headers: 'response_headers', body: 'response_body' },
};

/** 指定报文块当前选中的原文。 */
function payloadRaw(kind: PayloadKind, part: PayloadPart): string | null {
  const detail = drawerDetail.value;
  if (!detail) return null;
  return detail[PAYLOAD_FIELD[kind][part]];
}

const requestRaw = computed(() => payloadRaw('request', requestPart.value));
const responseRaw = computed(() => payloadRaw('response', responsePart.value));
const requestText = computed(() => prettifyJson(requestRaw.value));
const requestHtml = computed(() => highlightJson(requestRaw.value));
const responseText = computed(() => prettifyJson(responseRaw.value));
const responseHtml = computed(() => highlightJson(responseRaw.value));

async function loadLogin(): Promise<void> {
  if (loginState.loading) return;
  loginState.loading = true;
  try {
    const result = await fetchLoginLogs({
      page: loginState.page,
      limit: loginState.size,
      keyword: loginState.keyword,
      behavior: loginState.behavior,
      status: loginState.status,
    });
    loginState.list = result.list;
    loginState.total = result.total;
    loaded.login = true;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loginState.loading = false;
  }
}

async function loadOperation(): Promise<void> {
  if (opState.loading) return;
  opState.loading = true;
  try {
    const result = await fetchOperationLogs({
      page: opState.page,
      limit: opState.size,
      keyword: opState.keyword,
      module: opState.module,
      status: opState.status,
    });
    opState.list = result.list;
    opState.total = result.total;
    loaded.operation = true;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    opState.loading = false;
  }
}

function load(): void {
  if (activeTab.value === 'login') void loadLogin();
  else void loadOperation();
}

function search(): void {
  if (activeTab.value === 'login') loginState.page = 1;
  else opState.page = 1;
  load();
}

function resetFilter(): void {
  if (activeTab.value === 'login') {
    loginState.keyword = '';
    loginState.behavior = '';
    loginState.status = '';
    loginState.page = 1;
  } else {
    opState.keyword = '';
    opState.module = '';
    opState.status = '';
    opState.page = 1;
  }
  load();
}

async function openDetail(raw: unknown): Promise<void> {
  // ElTableColumn 插槽的 row 是 DefaultRow，这里收窄成日志行类型。
  const row = raw as OperationLogItem;
  drawerRow.value = row;
  // 换一行重新打开时，两块都回到「体」；同一行重复打开也保持简洁的默认视图。
  requestPart.value = 'body';
  responsePart.value = 'body';
  drawerDetail.value = details[row.id] ?? null;
  drawerVisible.value = true;

  if (drawerDetail.value) return;
  drawerLoading.value = true;
  try {
    const detail = await fetchOperationLogDetail(row.id);
    details[row.id] = detail;
    // 加载期间可能被关掉、又点了另一行：只认当前这一行。
    if (drawerRow.value?.id === row.id) drawerDetail.value = detail;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    drawerLoading.value = false;
  }
}

function onDrawerClosed(): void {
  drawerDetail.value = null;
  drawerRow.value = null;
}

async function copyPayload(kind: PayloadKind): Promise<void> {
  const text = kind === 'request' ? requestText.value : responseText.value;
  if (!text) return;
  const ok = await copyText(text);
  if (ok) ElMessage.success(t('monitor.detail.copied'));
  else ElMessage.error(t('monitor.detail.copyFailed'));
}

watch(activeTab, () => {
  if (!loaded[activeTab.value]) load();
});

onMounted(load);
</script>

<template>
  <div class="page-fill">
    <section class="page-content">
      <ElTabs v-model="activeTab" class="log-tabs">
        <ElTabPane :label="t('monitor.logs.tabLogin')" name="login" />
        <ElTabPane :label="t('monitor.logs.tabOperation')" name="operation" />
      </ElTabs>

      <div v-if="activeTab === 'login'" class="nomi-page-toolbar">
        <ElInput
          v-model="loginState.keyword"
          :placeholder="t('monitor.logs.keywordLogin')"
          clearable
          class="search"
          @keyup.enter="search"
          @clear="search"
        />
        <ElSelect v-model="loginState.behavior" clearable :placeholder="t('monitor.logs.behaviorAll')" class="filter-select" @change="search">
          <ElOption v-for="option in behaviorOptions" :key="option.value" :label="option.label" :value="option.value" />
        </ElSelect>
        <ElSelect v-model="loginState.status" clearable :placeholder="t('monitor.logs.statusAll')" class="filter-select" @change="search">
          <ElOption v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
        </ElSelect>
        <ElButton type="primary" @click="search">{{ t('monitor.common.search') }}</ElButton>
        <ElButton @click="resetFilter">{{ t('monitor.common.reset') }}</ElButton>
      </div>

      <div v-else class="nomi-page-toolbar">
        <ElInput
          v-model="opState.keyword"
          :placeholder="t('monitor.logs.keywordOperation')"
          clearable
          class="search"
          @keyup.enter="search"
          @clear="search"
        />
        <ElSelect v-model="opState.module" clearable :placeholder="t('monitor.logs.moduleAll')" class="filter-select" @change="search">
          <ElOption v-for="option in moduleOptions" :key="option.value" :label="option.label" :value="option.value" />
        </ElSelect>
        <ElSelect v-model="opState.status" clearable :placeholder="t('monitor.logs.statusAll')" class="filter-select" @change="search">
          <ElOption v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
        </ElSelect>
        <ElButton type="primary" @click="search">{{ t('monitor.common.search') }}</ElButton>
        <ElButton @click="resetFilter">{{ t('monitor.common.reset') }}</ElButton>
      </div>

      <div ref="tableWrap" class="nomi-table-fill">
        <ElTable
          v-if="activeTab === 'login'"
          v-loading="loginState.loading"
          :height="tableHeight"
          :data="loginState.list"
          row-key="id"
          border
          stripe
          :empty-text="t('monitor.logs.empty')"
        >
          <ElTableColumn :label="t('monitor.loginLog.seq')" width="62" fixed="left">
            <template #default="{ $index }">{{ rowIndex($index, loginState.page, loginState.size) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.time')" width="170">
            <template #default="{ row }"><span class="mono">{{ formatDateTime(row.create_time) }}</span></template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.nickname')" width="180">
            <template #default="{ row }">
              <span>{{ row.nickname || row.username || '—' }}</span>
              <span v-if="row.nickname && row.username" class="muted-cell">@{{ row.username }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.behavior')" width="120">
            <template #default="{ row }">{{ behaviorText(row.behavior) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.status')" width="120">
            <template #default="{ row }">
              <div>
                <ElTag :type="row.status === 1 ? 'success' : 'danger'" effect="light" size="small">
                  {{ row.status === 1 ? t('monitor.loginLog.statusSuccess') : t('monitor.loginLog.statusFail') }}
                </ElTag>
              </div>
              <span v-if="row.message" class="muted-cell" :title="row.message">{{ row.message }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.ip')" width="140">
            <template #default="{ row }"><span class="mono">{{ row.ip || '—' }}</span></template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.location')" width="130">
            <template #default="{ row }">{{ locationText(row.ip_location) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.browser')" width="140">
            <template #default="{ row }">{{ row.browser || '—' }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.loginLog.os')" width="130">
            <template #default="{ row }">{{ row.os || '—' }}</template>
          </ElTableColumn>
        </ElTable>

        <ElTable
          v-else
          v-loading="opState.loading"
          :height="tableHeight"
          :data="opState.list"
          row-key="id"
          border
          stripe
          :empty-text="t('monitor.logs.empty')"
        >
          <ElTableColumn :label="t('monitor.operationLog.seq')" width="62" fixed="left">
            <template #default="{ $index }">{{ rowIndex($index, opState.page, opState.size) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.time')" width="176" fixed="left">
            <template #default="{ row }">
              <button type="button" class="time-link" :title="t('monitor.logs.expandHint')" @click="openDetail(row)">
                {{ formatDateTime(row.create_time) }}
              </button>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.operator')" width="130">
            <template #default="{ row }">{{ row.username || '—' }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.content')" width="170">
            <template #default="{ row }">
              <span class="ellipsis" :title="entryText(row.title)">{{ entryText(row.title) }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.module')" width="130">
            <template #default="{ row }">{{ entryText(row.module) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.status')" width="100">
            <template #default="{ row }">
              <ElTag :type="row.status === 'success' ? 'success' : 'danger'" effect="light" size="small">
                {{ row.status === 'success' ? t('monitor.operationLog.statusSuccess') : t('monitor.operationLog.statusFail') }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.ip')" width="140">
            <template #default="{ row }"><span class="mono">{{ row.ip || '—' }}</span></template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.location')" width="130">
            <template #default="{ row }">{{ locationText(row.ip_location) }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.duration')" width="100">
            <template #default="{ row }"><span class="mono">{{ row.duration }} ms</span></template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.browser')" width="140">
            <template #default="{ row }">{{ row.browser || '—' }}</template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.operationLog.os')" width="130">
            <template #default="{ row }">{{ row.os || '—' }}</template>
          </ElTableColumn>
        </ElTable>

        <ElDrawer
          v-model="drawerVisible"
          :title="`${t('monitor.logs.detail')}${drawerRow ? ` #${drawerRow.id}` : ''}`"
          size="min(760px, 94vw)"
          @closed="onDrawerClosed"
        >
          <div v-loading="drawerLoading" class="log-detail">
            <template v-if="drawerDetail">
              <h4>{{ t('monitor.logs.basic') }}</h4>
              <dl class="detail-grid">
                <div><dt>{{ t('monitor.detail.logId') }}</dt><dd class="mono">{{ drawerDetail.id }}</dd></div>
                <div><dt>{{ t('monitor.detail.traceId') }}</dt><dd class="mono">{{ drawerDetail.trace_id || '—' }}</dd></div>
                <div><dt>{{ t('monitor.detail.operator') }}</dt><dd>{{ drawerDetail.username || '—' }}</dd></div>
                <div><dt>{{ t('monitor.detail.time') }}</dt><dd class="mono">{{ formatDateTime(drawerDetail.create_time) }}</dd></div>
                <div><dt>{{ t('monitor.detail.content') }}</dt><dd>{{ entryText(drawerDetail.title) }}</dd></div>
                <div><dt>{{ t('monitor.detail.module') }}</dt><dd>{{ entryText(drawerDetail.module) }}</dd></div>
                <div><dt>{{ t('monitor.detail.ip') }}</dt><dd class="mono">{{ drawerDetail.ip || '—' }}</dd></div>
                <div><dt>{{ t('monitor.detail.location') }}</dt><dd>{{ locationText(drawerDetail.ip_location) }}</dd></div>
                <div><dt>{{ t('monitor.detail.browser') }}</dt><dd>{{ drawerDetail.browser || '—' }}</dd></div>
                <div><dt>{{ t('monitor.detail.os') }}</dt><dd>{{ drawerDetail.os || '—' }}</dd></div>
                <div>
                  <dt>{{ t('monitor.detail.status') }}</dt>
                  <dd>
                    <ElTag :type="drawerDetail.status === 'success' ? 'success' : 'danger'" size="small" effect="light">
                      {{ drawerDetail.status === 'success' ? t('monitor.operationLog.statusSuccess') : t('monitor.operationLog.statusFail') }}
                    </ElTag>
                  </dd>
                </div>
                <div><dt>{{ t('monitor.detail.duration') }}</dt><dd class="mono">{{ drawerDetail.duration }} ms</dd></div>
                <div class="span-2"><dt>{{ t('monitor.detail.requestUri') }}</dt><dd class="mono">{{ drawerDetail.url || '—' }}</dd></div>
                <div v-if="drawerDetail.error_msg" class="span-2">
                  <dt>{{ t('monitor.detail.errorMsg') }}</dt><dd class="error-text">{{ drawerDetail.error_msg }}</dd>
                </div>
              </dl>

              <div class="payload-block">
                <div class="payload-head">
                  <h4>{{ t('monitor.logs.request') }}</h4>
                  <div class="payload-actions">
                    <ElRadioGroup v-model="requestPart" size="small" class="payload-switch">
                      <ElRadioButton
                        v-for="option in requestOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </ElRadioButton>
                    </ElRadioGroup>
                    <ElButton size="small" :disabled="!requestText" @click="copyPayload('request')">
                      {{ t('monitor.detail.copy') }}
                    </ElButton>
                  </div>
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -- highlightJson 对每段文本都做了 HTML 转义，见 app/utils/json-highlight.ts -->
                <pre v-if="requestText" class="payload json-view" v-html="requestHtml" />
                <p v-else class="payload-empty">{{ t('monitor.detail.noData') }}</p>
              </div>

              <div class="payload-block">
                <div class="payload-head">
                  <h4>{{ t('monitor.logs.response') }}</h4>
                  <div class="payload-actions">
                    <ElRadioGroup v-model="responsePart" size="small" class="payload-switch">
                      <ElRadioButton
                        v-for="option in responseOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </ElRadioButton>
                    </ElRadioGroup>
                    <ElButton size="small" :disabled="!responseText" @click="copyPayload('response')">
                      {{ t('monitor.detail.copy') }}
                    </ElButton>
                  </div>
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -- highlightJson 对每段文本都做了 HTML 转义，见 app/utils/json-highlight.ts -->
                <pre v-if="responseText" class="payload json-view" v-html="responseHtml" />
                <p v-else class="payload-empty">{{ t('monitor.detail.noData') }}</p>
              </div>
            </template>
            <p v-else-if="!drawerLoading" class="payload-empty">{{ t('monitor.detail.noData') }}</p>
          </div>
        </ElDrawer>
      </div>

      <div class="pager">
        <ElPagination
          v-if="activeTab === 'login'"
          v-model:current-page="loginState.page"
          v-model:page-size="loginState.size"
          :total="loginState.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="search"
          @current-change="loadLogin"
        />
        <ElPagination
          v-else
          v-model:current-page="opState.page"
          v-model:page-size="opState.size"
          :total="opState.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="search"
          @current-change="loadOperation"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.log-tabs {
  margin-bottom: 4px;
}

.log-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.search {
  width: 260px;
}

.filter-select {
  width: 150px;
}

.mono {
  font-family: var(--nomi-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}

.muted-cell {
  display: block;
  margin-left: 0;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ellipsis {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.time-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  cursor: pointer;
  font-family: var(--nomi-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  text-align: left;
}

.time-link:hover {
  text-decoration: underline;
}

.log-detail {
  min-height: 140px;
}

.log-detail h4 {
  margin: 16px 0 8px;
  color: var(--fg-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.log-detail h4:first-child {
  margin-top: 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 8px 20px;
  margin: 0;
}

.detail-grid > div {
  display: flex;
  gap: 10px;
  min-width: 0;
  font-size: 12.5px;
}

.detail-grid .span-2 {
  grid-column: span 2;
}

.detail-grid dt {
  flex: 0 0 84px;
  color: var(--fg-muted);
}

.detail-grid dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.error-text {
  color: var(--el-color-danger);
}

/* 请求 / 响应两块报文：上下排列，中间一条分隔线，各自带自己的切换按钮和复制。 */
.payload-block + .payload-block {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--nomi-border);
}

/* 报文区：标题在左，按钮组 + 复制在右；窄了整体换行，复制按钮跟着走到行尾 */
.payload-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.payload-head h4 {
  margin: 0;
}

.payload-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.payload-switch :deep(.el-radio-button__inner) {
  padding: 6px 12px;
  font-size: 12px;
}

.payload {
  max-height: min(38vh, 380px);
  overflow: auto;
  margin: 10px 0 0;
  padding: 12px 14px;
  border: 1px solid var(--nomi-border);
  border-radius: 8px;
  background: var(--nomi-code-bg, #f6f7f9);
  font-family: var(--nomi-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}

/* JSON 记号配色：亮色走深色系，暗色整体提亮 —— 深底上低饱和的蓝绿看不清。
   `--nomi-code-bg` 只在有代码块时才有意义，全局没有定义，就在这里按主题给值，
   否则暗色下会沿用亮色兜底，抽屉里出现一块突兀的白板。 */
.json-view {
  --nomi-code-bg: #f6f7f9;
  --json-key: #1d4ed8;
  --json-string: #0f7b46;
  --json-number: #b45309;
  --json-boolean: #7c3aed;
  --json-null: #6b7280;
}

html.dark .json-view {
  --nomi-code-bg: #0b1220;
  --json-key: #7aa7ff;
  --json-string: #6ee7b7;
  --json-number: #fbbf24;
  --json-boolean: #c4b5fd;
  --json-null: #94a3b8;
}

.json-view :deep(.json-key) {
  color: var(--json-key);
}

.json-view :deep(.json-string) {
  color: var(--json-string);
}

.json-view :deep(.json-number) {
  color: var(--json-number);
}

.json-view :deep(.json-boolean) {
  color: var(--json-boolean);
}

.json-view :deep(.json-null) {
  color: var(--json-null);
}

.payload-empty {
  margin: 10px 0 0;
  padding: 16px;
  border: 1px dashed var(--nomi-border);
  border-radius: 8px;
  color: var(--fg-muted);
  font-size: 12.5px;
  text-align: center;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

@media (max-width: 900px) {
  .detail-grid .span-2 {
    grid-column: span 1;
  }

  .payload-switch :deep(.el-radio-button__inner) {
    padding: 5px 8px;
    font-size: 11.5px;
  }
}
</style>
