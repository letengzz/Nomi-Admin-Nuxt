<script setup lang="ts">
/**
 * 隐私政策弹窗。
 *
 * 文档 12.4 里《隐私政策》是 RouterLink 指向不存在的路由（死链），18.1 改为
 * ElDialog：不离开注册页，已填内容全部保留。这里进一步抽成 Nomi 组件，
 * 面板只通过 defineModel 暴露开关，同意动作由父级表单决定。
 */
import { ElButton, ElDialog } from 'element-plus';
import { POLICY_VERSION } from '../../utils/register';

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ accept: [] }>();
const { t } = useI18n();

function accept(): void {
  emit('accept');
  visible.value = false;
}
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="t('register.privacyPolicy')"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="nomi-register-policy-body">{{ t('register.policyBody') }}</p>
    <p class="nomi-register-policy-version">
      {{ t('register.policyVersion', { version: POLICY_VERSION }) }}
    </p>
    <template #footer>
      <ElButton @click="visible = false">{{ t('action.cancel') }}</ElButton>
      <ElButton type="primary" @click="accept">{{ t('register.policyAgree') }}</ElButton>
    </template>
  </ElDialog>
</template>
