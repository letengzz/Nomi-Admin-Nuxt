<script setup lang="ts">
import type { UserRow } from '~/types/admin'
import { PAGE_SIZE_OPTIONS } from '~/config/env'
import { request } from '~/utils/api'

const {
  items, total, page, size, loading, error, filters,
  load, search, changePage, changeSize, reload,
} = useCrud<UserRow, { keyword: string }>({ url: '/api/users' }, { keyword: '' })

const notify = useNotify()

// 纯 CSS 档：页面内联一份 toast（与布局里那份同一个队列）
interface Toast { id: number, text: string, level: string }
const toasts = ref<Toast[]>([])
let toastSeq = 0

watch(() => notify.queue.value, () => {
  for (const m of notify.take()) {
    const id = ++toastSeq
    toasts.value.push({
      id,
      level: m.level,
      text: m.description ? `${m.title}（${m.description}）` : m.title,
    })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 8000)
  }
}, { flush: 'post', immediate: true })

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const rowCount = computed(() => items.value.length)

// 原生 <dialog>：遮罩、Esc、焦点陷阱由浏览器提供
const dialogRef = ref<HTMLDialogElement>()
const submitting = ref(false)
const draft = reactive({ username: '', displayName: '' })
const draftError = ref('')

function openDialog() {
  draft.username = ''
  draft.displayName = ''
  draftError.value = ''
  dialogRef.value?.showModal()
}

async function submit() {
  if (!draft.username.trim() || !draft.displayName.trim()) {
    draftError.value = '账号与姓名都不能为空'
    return
  }
  submitting.value = true
  try {
    await request('/api/users', { method: 'POST', body: { ...draft } })
    dialogRef.value?.close()
    notify.success('新增成功')
    page.value = 1
    await reload()
  }
  catch (err) {
    draftError.value = (err as Error).message
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
      <input
        v-model="filters.keyword"
        class="bar__input"
        type="search"
        placeholder="搜索账号或姓名"
        @keyup.enter="search"
      >
      <button class="btn" type="button" @click="search">
        查询
      </button>
      <span class="bar__gap" />
      <button class="btn btn--primary" type="button" @click="openDialog">
        新增用户
      </button>
    </div>

    <p v-if="error" class="alert" role="alert">
      {{ error.message }}（错误码 {{ error.code }}）
    </p>

    <table class="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>账号</th>
          <th>姓名</th>
          <th>角色</th>
          <th>创建时间</th>
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
        <tr v-if="loading">
          <td colspan="5" class="table__empty">
            加载中…
          </td>
        </tr>
        <tr v-else-if="!rowCount">
          <td colspan="5" class="table__empty">
            没有匹配的数据
          </td>
        </tr>
      </tbody>
    </table>

    <div class="pager">
      <select
        class="pager__size"
        :value="size"
        @change="changeSize(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="n in PAGE_SIZE_OPTIONS" :key="n" :value="n">
          {{ n }} 条/页
        </option>
      </select>
      <span class="pager__total">共 {{ total }} 条</span>
      <button class="btn" type="button" :disabled="page <= 1" @click="changePage(page - 1)">
        上一页
      </button>
      <span class="pager__page">{{ page }} / {{ pageCount }}</span>
      <button class="btn" type="button" :disabled="page >= pageCount" @click="changePage(page + 1)">
        下一页
      </button>
    </div>

    <dialog ref="dialogRef" class="dialog">
      <h3 class="dialog__title">
        新增用户
      </h3>
      <p v-if="draftError" class="dialog__error" role="alert">
        {{ draftError }}
      </p>
      <label class="field">
        <span class="field__label">账号</span>
        <input v-model="draft.username" class="field__input" type="text" placeholder="登录账号">
      </label>
      <label class="field">
        <span class="field__label">姓名</span>
        <input v-model="draft.displayName" class="field__input" type="text" placeholder="显示姓名">
      </label>
      <div class="dialog__actions">
        <button class="btn" type="button" @click="dialogRef?.close()">
          取消
        </button>
        <button class="btn btn--primary" type="button" :disabled="submitting" @click="submit">
          确定
        </button>
      </div>
    </dialog>

    <div class="toasts" role="status" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.level}`">
        {{ t.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.bar__input {
  width: 260px; height: 34px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); color: var(--fg);
}
.bar__gap { flex: 1; }

.btn {
  height: 34px; padding: 0 14px; cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); color: var(--fg); font-size: 14px;
}
.btn:disabled { opacity: .5; cursor: default; }
.btn--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }

.alert {
  margin: 0 0 var(--sp-3); padding: 8px 12px; font-size: 13px;
  color: var(--danger); background: var(--danger-bg);
  border: 1px solid var(--danger); border-radius: var(--radius);
}

.table { width: 100%; border-collapse: collapse; background: var(--bg); font-size: 14px; }
.table th, .table td { padding: 9px 12px; border: 1px solid var(--border); text-align: left; }
.table thead th { background: var(--bg-subtle); font-weight: 600; }
.table__empty { text-align: center; color: var(--fg-muted); }

.pager { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: var(--sp-3); }
.pager__size {
  height: 34px; border: 1px solid var(--border); border-radius: var(--radius);
  padding: 0 6px; background: var(--bg); color: var(--fg);
}
.pager__total, .pager__page { font-size: 13px; color: var(--fg-muted); }

.dialog {
  width: 380px; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--bg); color: var(--fg);
  box-shadow: 0 12px 40px rgb(0 0 0 / 18%);
}
.dialog::backdrop { background: rgb(15 23 42 / 35%); }
.dialog__title { margin: 0 0 14px; font-size: 16px; }
.dialog__error { margin: 0 0 10px; font-size: 13px; color: var(--danger); }
.dialog__actions { display: flex; justify-content: flex-end; gap: var(--sp-2); margin-top: var(--sp-4); }

.field { display: grid; gap: 6px; margin-bottom: var(--sp-3); }
.field__label { font-size: 13px; color: var(--fg); }
.field__input {
  height: 34px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); color: var(--fg);
}

.toasts { position: fixed; top: var(--sp-4); right: var(--sp-4); display: grid; gap: var(--sp-2); z-index: 50; }
.toast {
  padding: 10px 14px; font-size: 14px; background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
}
.toast--error { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); }
.toast--success { border-color: var(--brand-500); color: var(--brand-700); }
.toast--warning { border-color: var(--warn); color: var(--warn); background: var(--warn-bg); }
</style>
