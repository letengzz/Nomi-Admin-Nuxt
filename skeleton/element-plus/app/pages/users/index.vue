<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import type { UserRow } from '~/types/admin'
import { PAGE_SIZE_OPTIONS } from '~/config/env'
import { request } from '~/utils/api'

const {
  items, total, page, size, loading, error, filters,
  load, search, changePage, changeSize, reload,
} = useCrud<UserRow, { keyword: string }>({ url: '/api/users' }, { keyword: '' })

const notify = useNotify()

// 提示队列接线（本页也会触发 notify.success / notify.failure）
watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    ElMessage({
      type: m.level === 'error' ? 'error' : m.level,
      message: m.description ? `${m.title}（${m.description}）` : m.title,
    })
  }
}, { flush: 'post', immediate: true })

// ── 新增弹窗 ────────────────────────────────────────────────
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
    ElMessage.warning('账号与姓名都不能为空')
    return
  }
  submitting.value = true
  try {
    await request('/api/users', { method: 'POST', body: { ...draft } })
    dialogOpen.value = false
    notify.success('新增成功')
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
      <el-input
        v-model="filters.keyword"
        :prefix-icon="Search"
        placeholder="搜索账号或姓名"
        clearable
        class="bar__input"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">
        查询
      </el-button>
      <div class="bar__gap" />
      <el-button type="primary" :icon="Plus" @click="openDialog">
        新增用户
      </el-button>
    </div>

    <el-alert
      v-if="error"
      type="error"
      :title="error.message"
      :description="`错误码 ${error.code}`"
      show-icon
      :closable="false"
      class="mb"
    />

    <el-table v-loading="loading" :data="items" border stripe>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="username" label="账号" min-width="140" />
      <el-table-column prop="displayName" label="姓名" min-width="140" />
      <el-table-column prop="role" label="角色" width="120" />
      <el-table-column prop="createdAt" label="创建时间" min-width="180" />
      <template #empty>
        <span class="empty">没有匹配的数据</span>
      </template>
    </el-table>

    <el-pagination
      class="pager"
      :current-page="page"
      :page-size="size"
      :page-sizes="[...PAGE_SIZE_OPTIONS]"
      :total="total"
      layout="total, sizes, prev, pager, next"
      @current-change="changePage"
      @size-change="changeSize"
    />

    <el-dialog v-model="dialogOpen" title="新增用户" width="420px">
      <el-form label-width="72px">
        <el-form-item label="账号">
          <el-input v-model="draft.username" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="draft.displayName" placeholder="显示姓名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">
          取消
        </el-button>
        <el-button type="primary" :loading="submitting" @click="submit">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.bar__input { width: 260px; }
.bar__gap { flex: 1; }
.mb { margin-bottom: 12px; }
.pager { margin-top: 12px; justify-content: flex-end; }
.empty { color: #9ca3af; }
</style>
