<template>
  <div class="auth">
    <el-card class="auth__card" shadow="never">
      <slot />
    </el-card>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--el-fill-color-lighter);
}
.auth__card { width: 380px; padding: 8px; }
</style>
