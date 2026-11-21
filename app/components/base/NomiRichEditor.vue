<script setup lang="ts">
/**
 * 公告正文富文本编辑器（wangEditor 5 / Vue3 版）。
 *
 * 只负责「编辑 HTML 字符串」这一件事：v-model 出入的都是完整 HTML，
 * 图片走 customUpload 传到 /api/admin/notices/upload，正文里只存 URL，不存 base64。
 * 服务端入库前还会做一次 sanitizeNoticeHtml 净化，这里拿到的是净化前的草稿，
 * 所以编辑器内允许粘贴/插入内容，最终安全由服务端兜底。
 *
 * 两个 wangEditor 的硬性约定：
 *   · 编辑器实例必须放 shallowRef —— 放 ref 会被 Vue 深度代理，编辑器内部方法会失效；
 *   · 组件卸载前必须 editor.destroy() —— 否则切换公告时旧实例残留，出现多个 Toolbar。
 */
import { onBeforeUnmount, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import { Editor, Toolbar } from '@wangeditor/editor-for-vue';
import '@wangeditor/editor/dist/css/style.css';
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import { uploadNoticeImage } from '../../services/permission';

defineOptions({ name: 'NomiRichEditor' });

const model = defineModel<string>({ default: '' });

const { t } = useI18n();

/** 编辑器实例按官方要求用 shallowRef，工具栏需要它挂载。 */
const editorRef = shallowRef<IDomEditor>();

const toolbarConfig: Partial<IToolbarConfig> = {
  // 视频、代码块等对公告场景意义不大，精简工具栏；图片保留并走自有上传。
  excludeKeys: ['group-video', 'insertTable', 'code', 'codeBlock'],
};

const editorConfig: Partial<IEditorConfig> = {
  placeholder: t('auth.notice.contentPlaceholder'),
  MENU_CONF: {
    uploadImage: {
      // 走带鉴权的自有接口，返回 { url }；不用 wangEditor 默认的 base64 内联。
      async customUpload(file: File, insertFn: (url: string, alt?: string, href?: string) => void) {
        try {
          const { url } = await uploadNoticeImage(file);
          insertFn(url, file.name, url);
        } catch {
          ElMessage.error(t('auth.notice.uploadImageFailed'));
        }
      },
      maxFileSize: 2 * 1024 * 1024,
    },
  },
};

function onCreated(editor: IDomEditor): void {
  editorRef.value = editor;
}

onBeforeUnmount(() => {
  editorRef.value?.destroy();
  editorRef.value = undefined;
});
</script>

<template>
  <div class="nomi-rich-editor">
    <Toolbar :editor="editorRef" :default-config="toolbarConfig" mode="default" class="nomi-rich-editor-toolbar" />
    <Editor
      :model-value="model"
      :default-config="editorConfig"
      mode="default"
      class="nomi-rich-editor-area"
      @on-created="onCreated"
      @update:model-value="model = $event"
    />
  </div>
</template>

<style scoped>
.nomi-rich-editor {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.nomi-rich-editor-toolbar {
  border-bottom: 1px solid var(--el-border-color);
}

.nomi-rich-editor-area {
  min-height: 220px;
  overflow-y: auto;
}
</style>

<style>
/* wangEditor 的编辑区深处样式：限制图片/表格宽度，别把弹窗撑破。 */
.nomi-rich-editor .w-e-text-container [data-slate-editor] img {
  max-width: 100%;
}

.nomi-rich-editor .w-e-text-container [data-slate-editor] table {
  max-width: 100%;
  border-collapse: collapse;
}
</style>
