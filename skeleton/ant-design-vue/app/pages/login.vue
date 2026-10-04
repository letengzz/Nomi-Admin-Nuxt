<script setup lang="ts">
import { message } from 'ant-design-vue'
import { LockOutlined, UserOutlined } from '@ant-design/icons-vue'
import type { Rule } from 'ant-design-vue/es/form'
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

const rules: Record<string, Rule[]> = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

async function onSubmit() {
  try {
    await formRef.value?.validate()
  }
  catch {
    return                                    // 校验未通过：错误已由 a-form-item 展示
  }

  loading.value = true
  try {
    await login(form.username, form.password)
    message.success('登录成功')
    await router.push(safeRedirect(route.query.redirect))
  }
  catch (err) {
    const msg = err instanceof ApiRequestError && err.status === 401
      ? '账号或密码不正确'
      : (err as Error).message
    message.error(msg)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <h1 class="login__title">
      {{ APP_TITLE }}
    </h1>
    <p class="login__hint">
      演示账号：admin / admin123
    </p>

    <a-form
      ref="formRef"
      :model="form"
      :rules="rules"
      layout="vertical"
      @finish="onSubmit"
    >
      <a-form-item label="账号" name="username">
        <a-input v-model:value="form.username" placeholder="请输入账号">
          <template #prefix>
            <UserOutlined />
          </template>
        </a-input>
      </a-form-item>

      <a-form-item label="密码" name="password">
        <a-input-password v-model:value="form.password" placeholder="请输入密码">
          <template #prefix>
            <LockOutlined />
          </template>
        </a-input-password>
      </a-form-item>

      <a-button
        type="primary"
        html-type="submit"
        block
        :loading="loading"
      >
        登录
      </a-button>
    </a-form>
  </div>
</template>

<style scoped>
.login__title { margin: 0 0 4px; font-size: 20px; }
.login__hint { margin: 0 0 20px; font-size: 12px; color: rgb(0 0 0 / 45%); }
</style>
