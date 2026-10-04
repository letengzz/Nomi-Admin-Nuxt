<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ApiRequestError } from '~/utils/api'
import { safeRedirect } from '~/utils/navigation'
import { APP_TITLE } from '~/config/env'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const router = useRouter()
const { login } = useAuth()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: 'admin', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

async function onSubmit() {
  // 校验不通过时 validate() 会 reject，这里直接吞掉：错误已由表单展示
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return

  loading.value = true
  try {
    await login(form.username, form.password)
    ElMessage.success('登录成功')
    await router.push(safeRedirect(route.query.redirect))
  }
  catch (err) {
    // 401 与「网络异常」要分开说：前者是用户输错了，后者不是
    const msg = err instanceof ApiRequestError && err.status === 401
      ? '账号或密码不正确'
      : (err as Error).message
    ElMessage.error(msg)
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

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      @submit.prevent="onSubmit"
    >
      <el-form-item label="账号" prop="username">
        <el-input v-model="form.username" :prefix-icon="User" placeholder="请输入账号" />
      </el-form-item>

      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          :prefix-icon="Lock"
          type="password"
          show-password
          placeholder="请输入密码"
        />
      </el-form-item>

      <el-button
        type="primary"
        class="login__submit"
        :loading="loading"
        native-type="submit"
      >
        登录
      </el-button>
    </el-form>
  </div>
</template>

<style scoped>
.login__title { margin: 0 0 4px; font-size: 20px; }
.login__hint { margin: 0 0 20px; font-size: 12px; color: var(--el-text-color-secondary); }
.login__submit { width: 100%; }
</style>
