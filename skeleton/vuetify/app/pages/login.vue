<script setup lang="ts">
import { ApiRequestError } from '~/utils/api'
import { safeRedirect } from '~/utils/navigation'
import { APP_TITLE } from '~/config/env'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const router = useRouter()
const { login } = useAuth()

const formRef = ref()
const loading = ref(false)
const form = reactive({ username: 'admin', password: '' })
const snackbar = reactive({ show: false, text: '', color: 'error' })

const required = (label: string) => (v: string) => !!v || `请输入${label}`
const minLength = (n: number) => (v: string) => !v || v.length >= n || `至少 ${n} 位`

const rules = {
  username: [required('账号')],
  password: [required('密码'), minLength(6)],
}

async function onSubmit() {
  const result = await formRef.value?.validate()
  if (!result?.valid) return                    // 校验未通过：错误由 v-text-field 展示

  loading.value = true
  try {
    await login(form.username, form.password)
    await router.push(safeRedirect(route.query.redirect))
  }
  catch (err) {
    snackbar.text = err instanceof ApiRequestError && err.status === 401
      ? '账号或密码不正确'
      : (err as Error).message
    snackbar.show = true
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <h1 class="text-h6 mb-1">
      {{ APP_TITLE }}
    </h1>
    <p class="text-caption text-medium-emphasis mb-4">
      演示账号：admin / admin123
    </p>

    <v-form ref="formRef" @submit.prevent="onSubmit">
      <v-text-field
        v-model="form.username"
        label="账号"
        prepend-inner-icon="mdi-account"
        :rules="rules.username"
        variant="outlined"
        density="comfortable"
        class="mb-1"
      />

      <v-text-field
        v-model="form.password"
        label="密码"
        type="password"
        prepend-inner-icon="mdi-lock"
        :rules="rules.password"
        variant="outlined"
        density="comfortable"
        class="mb-3"
      />

      <v-btn
        type="submit"
        color="primary"
        block
        :loading="loading"
      >
        登录
      </v-btn>
    </v-form>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>
