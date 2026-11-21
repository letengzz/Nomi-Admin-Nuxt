<script setup lang="ts">
/**
 * 编辑公告独立页：从列表「编辑」进来，按路由 id 拉管理端单条接口回填。
 * 表单逻辑复用 NomiNoticeForm；保存成功后回列表。
 */
import { computed } from 'vue';
import { ElButton } from 'element-plus';
import NomiIcon from '../../../../components/layout/NomiIcon.vue';
import NomiNoticeForm from '../../../../components/base/NomiNoticeForm.vue';

definePageMeta({ layout: 'admin', keepalive: false, activePath: '/admin/system/notices' });
defineOptions({ name: 'NomiAdminNoticeEdit' });

const { t } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
const route = useRoute();

const noticeId = computed(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
});

useHead({ title: computed(() => t('auth.notice.edit')) });

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
        <h1>{{ t('auth.notice.edit') }}</h1>
      </header>

      <NomiNoticeForm v-if="noticeId" :notice-id="noticeId" @saved="onSaved">
        <template #actions="{ submit, submitting }">
          <NuxtLink :to="localePath('/admin/system/notices')" class="nomi-btn">
            {{ t('auth.common.cancel') }}
          </NuxtLink>
          <ElButton type="primary" :loading="submitting" @click="submit">
            {{ t('auth.common.save') }}
          </ElButton>
        </template>
      </NomiNoticeForm>

      <div v-else class="notice-form-invalid">
        <p>{{ t('auth.notice.detail.notFound') }}</p>
      </div>
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

.notice-form-invalid {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
}
</style>
