<template>
  <div class="auth">
    <section class="auth__card">
      <slot />
    </section>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg-subtle);
}
.auth__card {
  width: 380px; padding: 28px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgb(0 0 0 / 6%);
}
</style>
