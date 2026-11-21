<script setup lang="ts">
/**
 * 字段说明气泡 —— 表单里「输入框下方那行小字」的统一去处。
 *
 * 说明文字挪到标签后面，收成一颗小图标：不再白占一行高度，
 * 字段与字段之间的距离也不会因为某个字段多一行小字而忽宽忽窄。
 * 悬停或键盘聚焦时展开，触屏点一下同样能看到。
 *
 * 为什么根节点是自己的 span 而不是 ElTooltip：
 * 标签里的定位（见 layout.scss 的 .tip-form）要靠这颗盒子，
 * 而 ElTooltip 的根节点不是一个尺寸稳定的元素，拿它定位会被它的
 * 触发器包装层挡在中间。
 *
 * 为什么是 info 图标而不是一个「?」字：
 * 10px 的字形笔画受字体渲染影响，嵌进小圆圈后糊成一粒灰点，
 * 和「冒号 / 句点」这类标点混在一起；矢量图标在任何缩放下都干净。
 */
import { computed } from 'vue';
import { ElTooltip } from 'element-plus';
import NomiIcon from './NomiIcon.vue';

const props = defineProps<{
  /** 气泡里显示的说明文字 */
  content: string;
  /** 无障碍名称；默认沿用说明文字本身 */
  label?: string;
}>();

const ariaLabel = computed(() => props.label ?? props.content);
</script>

<template>
  <span class="nomi-field-tip">
    <ElTooltip
      :content="content"
      placement="right"
      effect="light"
      :show-after="120"
      :show-arrow="false"
      :offset="10"
      popper-class="nomi-field-tip-pop"
    >
      <span class="nomi-field-tip__dot" role="img" tabindex="0" :aria-label="ariaLabel">
        <NomiIcon name="info" :size="14" :stroke-width="1.8" />
      </span>
    </ElTooltip>
  </span>
</template>

<style scoped>
.nomi-field-tip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  vertical-align: middle;
}

/* 图标本身就是圆形的，外面不再套一圈描边 —— 双环叠在一起会显脏。
   底色只在悬停/聚焦时出现，静态时是一颗几乎融进文字的灰图标。
   盒子 18px 而图标 14px：多出来的 2px 是给鼠标和焦点环的余量。 */
.nomi-field-tip__dot {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--el-text-color-placeholder);
  cursor: help;
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}

.nomi-field-tip__dot:hover,
.nomi-field-tip__dot:focus-visible {
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  color: var(--el-color-primary);
  outline: none;
}

.nomi-field-tip__dot:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 22%, transparent);
}
</style>

<style>
/* 气泡被 teleport 到 body，scoped 样式够不到，只能留一个带前缀的全局块。
   刻意不用 Element Plus 的深色泡：这里的文案多是两三行的说明，深底白字在
   浅色界面里太重，和菜单/下拉那种「浅色卡片 + 细边」的弹出层也不统一。
   也不用默认的三角箭头：箭头只有 6px，指着左边一排小图标时会压在标签文字上，
   而且气泡本身就在图标正右方，箭头是多余的装饰。 */
.nomi-field-tip-pop.el-popper {
  max-width: 240px;
  padding: 8px 11px;
  border: 1px solid var(--nomi-border);
  border-radius: 8px;
  background: var(--nomi-card);
  color: var(--fg);
  font-size: 12.5px;
  line-height: 1.65;
  box-shadow:
    0 10px 24px -12px rgb(15 23 42 / 22%),
    0 2px 6px -2px rgb(15 23 42 / 8%);
}
</style>
