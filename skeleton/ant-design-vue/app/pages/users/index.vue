<script setup lang="ts">
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import type { TableColumnsType } from 'ant-design-vue'
import type { UserRow } from '~/types/admin'
import { PAGE_SIZE_OPTIONS } from '~/config/env'
import { request } from '~/utils/api'

const {
  items, total, page, size, loading, error, filters,
  load, search, changePage, changeSize, reload,
} = useCrud<UserRow, { keyword: string }>({ url: '/api/users' }, { keyword: '' })

const notify = useNotify()

watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    const text = m.description ? `${m.title}（${m.description}）` : m.title
    if (m.level === 'error') message.error(text)
    else if (m.level === 'warning') message.warning(text)
    else if (m.level === 'success') message.success(text)
    else message.info(text)
  }
}, { flush: 'post', immediate: true })

const columns: TableColumnsType = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: '账号', dataIndex: 'username' },
  { title: '姓名', dataIndex: 'displayName' },
  { title: '角色', dataIndex: 'role', width: 120 },
  { title: '创建时间', dataIndex: 'createdAt', width: 200 },
]

const showTotal = (t: number) => `共 ${t} 条`

/** antd 的 @change 同时回传 page 与 pageSize，要自己分辨是哪一种变化 */
function onPagerChange(nextPage: number, nextSize: number) {
  if (nextSize !== size.value) return changeSize(nextSize)
  return changePage(nextPage)
}

const dialogOpen = ref(false)
const submitting = ref(false)
const draft = reactive({ username: '', displayName: '' })

function openDialog() {
  draft.username = ''
  draft.displayName = ''
  dialogOpen.value = true
}

async function submit() {
  if (!draft.username.trim() || !draft.displayName.trim()) {
    message.warning('账号与姓名都不能为空')
    return
  }
  submitting.value = true
  try {
    await request('/api/users', { method: 'POST', body: { ...draft } })
    dialogOpen.value = false
    message.success('新增成功')
    page.value = 1
    await reload()
  }
  catch (err) {
    notify.failure(err, '新增失败')
  }
  finally {
    submitting.value = false
  }
}

await load()
</script>

<template>
  <div>
    <div class="bar">
      <a-input-search
        v-model:value="filters.keyword"
        placeholder="搜索账号或姓名"
        allow-clear
        style="width: 260px"
        @search="search"
      />
      <div class="bar__gap" />
      <a-button type="primary" @click="openDialog">
        <template #icon>
          <PlusOutlined />
        </template>
        新增用户
      </a-button>
    </div>

    <a-alert
      v-if="error"
      type="error"
      show-icon
      class="mb"
      :message="error.message"
      :description="`错误码 ${error.code}`"
    />

    <a-table
      :data-source="items"
      :columns="columns"
      :loading="loading"
      :pagination="false"
      row-key="id"
      bordered
      size="middle"
    >
      <template #emptyText>
        <span class="empty">没有匹配的数据</span>
      </template>
    </a-table>

    <div class="pager">
      <a-pagination
        :current="page"
        :page-size="size"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS.map(String)"
        :show-total="showTotal"
        show-size-changer
        @change="onPagerChange"
      />
    </div>

    <a-modal
      v-model:open="dialogOpen"
      title="新增用户"
      :confirm-loading="submitting"
      @ok="submit"
    >
      <a-form layout="horizontal" :label-col="{ span: 5 }">
        <a-form-item label="账号">
          <a-input v-model:value="draft.username" placeholder="登录账号" />
        </a-form-item>
        <a-form-item label="姓名">
          <a-input v-model:value="draft.displayName" placeholder="显示姓名" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.bar__gap { flex: 1; }
.mb { margin-bottom: 12px; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.empty { color: rgb(0 0 0 / 25%); }
</style>
