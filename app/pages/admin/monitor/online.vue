<script setup lang="ts">
/**
 * 在线用户：一行 access token = 一个会话。
 *
 * 数据全部来自 token 表 JOIN user，不另存一份「在线状态」——
 * 状态由最后活跃时间与令牌失效时间当场算，页面 30 秒自动刷新一次。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';
import { useFillTable } from '../../../composables/useFillTable';
import { useMobileLayout } from '../../../composables/useMobileLayout';
import { fetchOnlineSessions, kickOnlineSession } from '../../../services/monitor';
import type { OnlineSession, SessionStatus } from '../../../types/monitor';
import { formatDateTime } from '../../../utils/format';

definePageMeta({ layout: 'admin', pageFill: true });
defineOptions({ name: 'NomiMonitorOnline' });

const { t, te } = useI18n();
const { auth } = usePermission();
const { wrapRef: tableWrap, tableHeight } = useFillTable();
const { isMobile, isNarrow } = useMobileLayout();
useHead({ title: computed(() => t('monitor.online.title')) });

const loading = ref(false);
const list = ref<OnlineSession[]>([]);
const total = ref(0);
const keyword = ref('');
const status = ref('');
const page = reactive({ index: 1, size: 20 });
let timer: ReturnType<typeof setInterval> | undefined;

const statusOptions = computed(() => [
  { value: 'online', label: t('monitor.online.statusOnline') },
  { value: 'away', label: t('monitor.online.statusAway') },
  { value: 'expired', label: t('monitor.online.statusExpired') },
]);

function locationText(raw?: string): string {
  // 历史会话里可能存着空串（当时没配归属地服务），给明确文案而不是一个破折号。
  if (!raw) return t('monitor.location.unknown');
  return te(raw) ? t(raw) : raw;
}

function statusText(value: SessionStatus): string {
  const key = value === 'online' ? 'statusOnline' : value === 'away' ? 'statusAway' : 'statusExpired';
  return t(`monitor.online.${key}`);
}

function statusTagType(value: SessionStatus): 'success' | 'warning' | 'info' {
  return value === 'online' ? 'success' : value === 'away' ? 'warning' : 'info';
}

function rowIndex(index: number): number {
  return (page.index - 1) * page.size + index + 1;
}

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    const result = await fetchOnlineSessions({
      page: page.index,
      limit: page.size,
      keyword: keyword.value,
      status: status.value,
    });
    list.value = result.list;
    total.value = result.total;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function search(): void {
  page.index = 1;
  void load();
}

function resetFilter(): void {
  keyword.value = '';
  status.value = '';
  search();
}

async function kick(raw: unknown): Promise<void> {
  // ElTableColumn 插槽的 row 是 DefaultRow，这里收窄成会话类型。
  const row = raw as OnlineSession;
  if (row.is_self === 1) {
    ElMessage.warning(t('monitor.online.kickSelf'));
    return;
  }
  try {
    await ElMessageBox.confirm(t('monitor.online.kickConfirm'), t('monitor.online.kick'), {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await kickOnlineSession(row.session_id);
    ElMessage.success(t('monitor.online.kickSuccess'));
    if (list.value.length === 1 && page.index > 1) page.index -= 1;
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page-fill">
    <section class="page-content">
      <div class="nomi-page-toolbar">
        <ElInput
          v-model="keyword"
          :placeholder="t('monitor.online.keyword')"
          clearable
          class="search"
          @keyup.enter="search"
          @clear="search"
        />
        <ElSelect v-model="status" clearable class="status-select" @change="search">
          <ElOption
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElButton type="primary" @click="search">{{ t('monitor.common.search') }}</ElButton>
        <ElButton @click="resetFilter">{{ t('monitor.common.reset') }}</ElButton>
        <ElButton @click="load">{{ t('monitor.common.refresh') }}</ElButton>
        <span class="toolbar-total">
          {{ t('monitor.common.total') }} {{ total }} {{ t('monitor.online.sessions') }}
        </span>
      </div>

      <div ref="tableWrap" class="nomi-table-fill">
        <ElTable
          v-loading="loading"
          :height="tableHeight"
          :data="list"
          row-key="session_id"
          border
          stripe
          :empty-text="t('monitor.online.empty')"
        >
          <ElTableColumn
            :label="t('monitor.online.seq')"
            :width="isNarrow ? 48 : 62"
            :fixed="isMobile ? false : 'left'"
          >
            <template #default="{ $index }">{{ rowIndex($index) }}</template>
          </ElTableColumn>
          <ElTableColumn
            :label="t('monitor.online.nickname')"
            :width="isNarrow ? 140 : 200"
            :fixed="isMobile ? false : 'left'"
          >
            <template #default="{ row }">
              <div class="user-cell">
                <span class="user-name">{{ row.nickname || row.username || '—' }}</span>
                <ElTag v-if="row.is_self === 1" size="small" type="primary" effect="plain">
                  {{ t('monitor.online.current') }}
                </ElTag>
              </div>
              <span v-if="row.username" class="user-account">@{{ row.username }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.online.ip')" :width="isNarrow ? 120 : 140">
            <template #default="{ row }"><span class="mono">{{ row.ip || '—' }}</span></template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" :label="t('monitor.online.location')" width="130">
            <template #default="{ row }">{{ locationText(row.ip_location) }}</template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" :label="t('monitor.online.browser')" width="140">
            <template #default="{ row }">{{ row.browser || '—' }}</template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" :label="t('monitor.online.os')" width="130">
            <template #default="{ row }">{{ row.os || '—' }}</template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" :label="t('monitor.online.loginTime')" width="170">
            <template #default="{ row }"><span class="mono">{{ formatDateTime(row.login_time) }}</span></template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.online.lastActive')" :width="isNarrow ? 150 : 170">
            <template #default="{ row }"><span class="mono">{{ formatDateTime(row.last_active_time || row.login_time) }}</span></template>
          </ElTableColumn>
          <ElTableColumn v-if="!isMobile" :label="t('monitor.online.expireTime')" width="170">
            <template #default="{ row }"><span class="mono">{{ formatDateTime(row.expire_time) }}</span></template>
          </ElTableColumn>
          <ElTableColumn :label="t('monitor.online.status')" :width="isNarrow ? 82 : 100">
            <template #default="{ row }">
              <ElTag :type="statusTagType(row.status)" effect="light" size="small">
                {{ statusText(row.status) }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn v-if="!isNarrow" :label="t('monitor.online.lastRefresh')" width="170">
            <template #default="{ row }">
              <span class="mono">
                {{ row.last_refresh_time ? formatDateTime(row.last_refresh_time) : t('monitor.online.never') }}
              </span>
            </template>
          </ElTableColumn>
          <ElTableColumn
            :label="t('monitor.online.actions')"
            :width="isNarrow ? 82 : 100"
            :fixed="isMobile ? false : 'right'"
          >
            <template #default="{ row }">
              <ElButton
                v-if="auth('kick')"
                link
                type="danger"
                :disabled="row.is_self === 1"
                @click="kick(row)"
              >
                {{ t('monitor.online.kick') }}
              </ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>

      <div class="pager">
        <ElPagination
          v-model:current-page="page.index"
          v-model:page-size="page.size"
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
</template>

<style scoped>
.search {
  width: 260px;
}

.status-select {
  width: 140px;
}

.toolbar-total {
  margin-left: auto;
  color: var(--fg-muted);
  font-size: 12px;
}

.mono {
  font-family: var(--nomi-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.user-name {
  font-weight: 600;
}

.user-account {
  display: block;
  margin-top: 2px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.2;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

@media (max-width: 640px) {
  .search,
  .status-select {
    width: 100%;
  }

  .toolbar-total {
    margin-left: 0;
  }

  .pager {
    justify-content: center;
  }
}
</style>
