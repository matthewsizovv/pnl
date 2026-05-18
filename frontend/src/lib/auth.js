import { api } from './api.js';

export async function loginWithTelegram() {
  const tg = window.Telegram?.WebApp;
  let initData = tg?.initData;

  // Dev fallback
  if (!initData) {
    initData = 'user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Dev%22%7D&hash=dev';
  }

  const { token } = await api.auth(initData);
  localStorage.setItem('jwt', token);
  return token;
}

export function logout() {
  localStorage.removeItem('jwt');
}

export function isLoggedIn() {
  return !!localStorage.getItem('jwt');
}
