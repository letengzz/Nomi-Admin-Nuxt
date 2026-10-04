<script setup lang="ts">
import { ApiRequestError } from '~/utils/api'
import { safeRedirect } from '~/utils/navigation'
import { APP_TITLE } from '~/config/env'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const router = useRouter()
const { login } = useAuth()

const loading = ref(false)
const form = reactive({ username: 'admin', password: '' })
const errors = reactive({ username: '', password: '' })
const message = ref('')

function validate(): boolean {
  errors.username = form.username.trim() ? '' : '请输入账号'
  errors.password = form.password
    ? (form.password.length >= 6 ? '' : '密码至少 6 位')
    : '请输入密码'
  return !errors.username && !errors.password
}

async function onSubmit() {
  message.value = ''
  if (!validate()) return

  loading.value = true
  try {
    await login(form.username, form.password)
    await router.push(safeRedirect(route.query.redirect))
  }
  catch (err) {
    message.value = err instanceof ApiRequestError && err.status === 401
      ? '账号或密码不正确'
      : (err as Error).message
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

    <p v-if="message" class="login__error" role="alert">
      {{ message }}
    </p>

    <form class="login__form" novalidate @submit.prevent="onSubmit">
      <label class="field">
        <span class="field__label">账号</span>
        <input
          v-model="form.username"
          class="field__input"
          :class="{ 'field__input--invalid': errors.username }"
          type="text"
          autocomplete="username"
          placeholder="请输入账号"
          @input="errors.username = ''"
        >
        <span v-if="errors.username" class="field__error">{{ errors.username }}</span>
      </label>

      <label class="field">
        <span class="field__label">密码</span>
        <input
          v-model="form.password"
          class="field__input"
          :class="{ 'field__input--invalid': errors.password }"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
          @input="errors.password = ''"
        >
        <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
      </label>

      <button class="login__submit" type="submit" :disabled="loading">
        {{ loading ? '登录中…' : '登录' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login__title { margin: 0 0 4px; font-size: 20px; }
.login__hint { margin: 0 0 20px; font-size: 12px; color: var(--fg-muted); }
.login__error {
  margin: 0 0 12px; padding: 8px 12px;
  font-size: 13px; color: var(--danger);
  background: var(--danger-bg); border: 1px solid var(--danger); border-radius: var(--radius);
}

.login__form { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; }
.field__label { font-size: 13px; color: var(--fg); }
.field__input {
  height: 36px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 14px; outline: none;
  background: var(--bg); color: var(--fg);
}
.field__input:focus { border-color: var(--brand-500); box-shadow: 0 0 0 3px rgb(0 220 130 / 18%); }
.field__input--invalid { border-color: var(--danger); }
.field__error { font-size: 12px; color: var(--danger); }

.login__submit {
  height: 38px; border: 0; border-radius: var(--radius);
  background: var(--brand-600); color: #fff; font-size: 14px; cursor: pointer;
}
.login__submit:disabled { opacity: .6; cursor: default; }
</style>
