<script setup lang="ts">
/**
 * 新增公告独立页：从列表「新增公告」进来，表单逻辑复用 NomiNoticeForm。
 * 保存成功后回列表；activePath 让侧栏高亮「通知公告」菜单。
 */
import { computed } from 'vue';
import { ElButton } from 'element-plus';
import NomiIcon from '../../../components/layout/NomiIcon.vue';
import NomiNoticeForm from '../../../components/base/NomiNoticeForm.vue';

definePageMeta({ layout: 'admin', keepalive: false, activePath: '/admin/system/notices' });
defineOptions({ name: 'NomiAdminNoticeCreate' });

const { t } = useI18n();
const localePath = useLocalePath();
const router = useRouter();

useHead({ title: computed(() => t('auth.notice.add')) });

async function onSaved(): Promise<void> {
  await router.push(localePath('/admin/system/notices'));
}
</script>

<template>
  <div class="notice-form-page">
    <div class="nomi-page-toolbar nomi-page-toolbar--end">
      <NuxtLink :to="localePath('/admin/system/notices')" class="nomi-btn">
        <NomiIcon name="arrow-left" :size="15" />{{ t('auth.notice.detail.gone') }}
      </NuxtLink>
    </div>

    <section class="page-content notice-form-page-content">
      <header class="notice-form-head">
        <h1>{{ t('auth.notice.add') }}</h1>
      </header>

      <NomiNoticeForm @saved="onSaved">
        <template #actions="{ submit, submitting }">
          <NuxtLink :to="localePath('/admin/system/notices')" class="nomi-btn">
            {{ t('auth.common.cancel') }}
          </NuxtLink>
          <ElButton type="primary" :loading="submitting" @click="submit">
            {{ t('auth.common.save') }}
          </ElButton>
        </template>
      </NomiNoticeForm>
    </section>
  </div>
</template>

<style scoped>
.notice-form-page-content {
  max-width: 900px;
  margin: 0 auto;
}

.notice-form-head {
  padding-bottom: 14px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--nomi-border);
}

.notice-form-head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
</style>
