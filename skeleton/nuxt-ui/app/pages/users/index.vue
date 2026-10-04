<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { UserRow } from '~/types/admin'
import { PAGE_SIZE_OPTIONS } from '~/config/env'
import { request } from '~/utils/api'

const {
  items, total, page, size, loading, error, filters,
  load, search, changePage, changeSize, reload,
} = useCrud<UserRow, { keyword: string }>({ url: '/api/users' }, { keyword: '' })

const notify = useNotify()
const toast = useToast()

watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    toast.add({
      title: m.title,
      description: m.description,
      color: m.level === 'error' ? 'error' : m.level,
    })
  }
}, { flush: 'post', immediate: true })

const columns: TableColumn<UserRow>[] = [
  { accessorKey: 'id', header: 'ID', size: 80 },
  { accessorKey: 'username', header: '账号' },
  { accessorKey: 'displayName', header: '姓名' },
  { accessorKey: 'role', header: '角色', size: 120 },
  { accessorKey: 'createdAt', header: '创建时间' },
]

const sizeItems = PAGE_SIZE_OPTIONS.map(n => ({ label: `${n} 条/页`, value: n }))
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
    toast.add({ title: '账号与姓名都不能为空', color: 'warning' })
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
    <div class="mb-3 flex items-center gap-2">
      <UInput
        v-model="filters.keyword"
        icon="i-lucide-search"
        placeholder="搜索账号或姓名"
        class="w-65"
        @keyup.enter="search"
      />
      <UButton color="neutral" variant="soft" @click="search">
        查询
      </UButton>
      <div class="flex-1" />
      <UButton icon="i-lucide-plus" @click="openDialog">
        新增用户
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :title="error.message"
      :description="`错误码 ${error.code}`"
      class="mb-3"
    />

    <UTable
      :data="items"
      :columns="columns"
      :loading="loading"
      class="rounded-lg border border-default"
    >
      <template #empty>
        <span class="text-muted">没有匹配的数据</span>
      </template>
    </UTable>

    <div class="mt-3 flex items-center justify-end gap-3">
      <USelect v-model="sizeModel" :items="sizeItems" class="w-30" />
      <span class="text-xs text-muted">共 {{ total }} 条</span>
      <UPagination
        :page="page"
        :total="total"
        :items-per-page="size"
        show-edges
        @update:page="changePage"
      />
    </div>

    <UModal v-model:open="dialogOpen" title="新增用户">
      <template #body>
        <div class="grid gap-4">
          <UFormField label="账号">
            <UInput v-model="draft.username" placeholder="登录账号" class="w-full" />
          </UFormField>
          <UFormField label="姓名">
            <UInput v-model="draft.displayName" placeholder="显示姓名" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="dialogOpen = false">
            取消
          </UButton>
          <UButton :loading="submitting" @click="submit">
            确定
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
