import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useStorage } from '@vueuse/core';

/**
 * 登录态由 token 推导，避免 isLogin 与 token 两个事实来源不一致。
 * 真实项目请把 token 换成 HttpOnly Cookie 或后端会话。
 */
export const useUserStore = defineStore('user', () => {
  const accessToken = useStorage('nomi:access-token', '');
  const refreshToken = useStorage('nomi:refresh-token', '');
  const language = useStorage('nomi:language', 'zh');
  const isLogin = computed(() => accessToken.value.length > 0);

  function setToken(token: string, newRefreshToken?: string): void {
    accessToken.value = token;
    if (newRefreshToken) refreshToken.value = newRefreshToken;
  }

  function setLanguage(lang: string): void {
    language.value = lang;
  }

  function logOut(): void {
    accessToken.value = '';
    refreshToken.value = '';
  }

  return { accessToken, refreshToken, language, isLogin, setToken, setLanguage, logOut };
});
