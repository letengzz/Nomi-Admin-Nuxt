<script setup lang="ts">
import { ApiRequestError } from '~/utils/api'
import { safeRedirect } from '~/utils/navigation'
import { APP_TITLE } from '~/config/env'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const router = useRouter()
const { login } = useAuth()
const toast = useToast()

const loading = ref(false)
const form = reactive({ username: 'admin', password: '' })
const errors = reactive<{ username: string; password: string }>({ username: '', password: '' })

/** 规则只有两条，手写比引 schema 库更省 */
function validate(): boolean {
  errors.username = form.username.trim() ? '' : '请输入账号'
  errors.password = form.password
    ? (form.password.length >= 6 ? '' : '密码至少 6 位')
    : '请输入密码'
  return !errors.username && !errors.password
}

// 输入时清掉已有错误，避免「改对了红字还在」
watch(() => form.username, () => { errors.username = '' })
watch(() => form.password, () => { errors.password = '' })

async function onSubmit() {
  if (!validate()) return

  loading.value = true
  try {
    await login(form.username, form.password)
    toast.add({ title: '登录成功', color: 'success' })
    await router.push(safeRedirect(route.query.redirect))
  }
  catch (err) {
    const title = err instanceof ApiRequestError && err.status === 401
      ? '账号或密码不正确'
      : (err as Error).message
    toast.add({ title, color: 'error' })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <h1 class="mb-1 text-xl font-semibold">
      {{ APP_TITLE }}
    </h1>
    <p class="mb-5 text-xs text-muted">
      演示账号：admin / admin123
    </p>

    <form class="grid gap-4" @submit.prevent="onSubmit">
      <UFormField label="账号" :error="errors.username">
        <UInput
          v-model="form.username"
          icon="i-lucide-user"
          placeholder="请输入账号"
          class="w-full"
        />
      </UFormField>

      <UFormField label="密码" :error="errors.password">
        <UInput
          v-model="form.password"
          type="password"
          icon="i-lucide-lock"
          placeholder="请输入密码"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        block
        :loading="loading"
      >
        登录
      </UButton>
    </form>
  </div>
</template>
