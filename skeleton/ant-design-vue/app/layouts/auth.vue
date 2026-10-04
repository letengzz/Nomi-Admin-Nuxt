<template>
  <div class="auth">
    <a-card class="auth__card" :bordered="false">
      <slot />
    </a-card>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f5f5f5;
}
.auth__card { width: 380px; box-shadow: 0 2px 12px rgb(0 0 0 / 8%); }
</style>
