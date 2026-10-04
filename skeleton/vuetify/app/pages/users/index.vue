<script setup lang="ts">
import type { UserRow } from '~/types/admin'
import { PAGE_SIZE_OPTIONS } from '~/config/env'
import { request } from '~/utils/api'

const {
  items, total, page, size, loading, error, filters,
  load, search, changePage, changeSize, reload,
} = useCrud<UserRow, { keyword: string }>({ url: '/api/users' }, { keyword: '' })

// Vuetify 没有全局提示 API：本页自己搭一份 snackbar
const snackbar = reactive({ show: false, text: '', color: 'success' })
const notify = useNotify()

watch(() => notify.queue.value, () => {
  const list = notify.take()
  if (!list.length) return
  const first = list[0]!
  snackbar.text = first.description ? `${first.title}（${first.description}）` : first.title
  snackbar.color = first.level === 'error' ? 'error' : first.level
  snackbar.show = true
}, { flush: 'post', immediate: true })

const headers = [
  { title: 'ID', key: 'id' },
  { title: '账号', key: 'username' },
  { title: '姓名', key: 'displayName' },
  { title: '角色', key: 'role' },
  { title: '创建时间', key: 'createdAt' },
]

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const sizeItems = PAGE_SIZE_OPTIONS.map(n => ({ title: `${n} 条/页`, value: n }))
const sizeModel = computed({
  get: () => size.value,
  set: (v: number) => { changeSize(v) },
})

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
    snackbar.text = '账号与姓名都不能为空'
    snackbar.color = 'warning'
    snackbar.show = true
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
    <div class="d-flex align-center ga-2 mb-3">
      <v-text-field
        v-model="filters.keyword"
        label="搜索账号或姓名"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 280px"
        @keyup.enter="search"
      />
      <v-btn color="primary" variant="tonal" @click="search">
        查询
      </v-btn>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openDialog">
        新增用户
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-3"
      :title="error.message"
      :text="`错误码 ${error.code}`"
    />

    <v-table hover>
      <thead>
        <tr>
          <th v-for="h in headers" :key="h.key">
            {{ h.title }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td>{{ row.id }}</td>
          <td>{{ row.username }}</td>
          <td>{{ row.displayName }}</td>
          <td>{{ row.role }}</td>
          <td>{{ row.createdAt }}</td>
        </tr>
        <tr v-if="!loading && !items.length">
          <td :colspan="headers.length" class="text-center text-medium-emphasis">
            没有匹配的数据
          </td>
        </tr>
        <tr v-if="loading">
          <td :colspan="headers.length" class="text-center">
            <v-progress-linear indeterminate color="primary" />
          </td>
        </tr>
      </tbody>
    </v-table>

    <div class="d-flex align-center justify-end ga-3 mt-3">
      <v-select
        v-model="sizeModel"
        :items="sizeItems"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 130px"
      />
      <span class="text-caption text-medium-emphasis">共 {{ total }} 条</span>
      <v-pagination
        :model-value="page"
        :length="pageCount"
        density="comfortable"
        @update:model-value="changePage"
      />
    </div>

    <v-dialog v-model="dialogOpen" max-width="420">
      <v-card title="新增用户">
        <v-card-text class="d-grid ga-4">
          <v-text-field v-model="draft.username" label="账号" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-model="draft.displayName" label="姓名" variant="outlined" density="comfortable" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialogOpen = false">
            取消
          </v-btn>
          <v-btn color="primary" :loading="submitting" @click="submit">
            确定
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>
