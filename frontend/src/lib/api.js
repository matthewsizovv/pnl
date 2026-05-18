const BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('jwt');
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message || 'Request failed');
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return res.blob();
}

export const api = {
  auth: (initData) => request('POST', '/api/auth/telegram', { initData }),
  getWallets: () => request('GET', '/api/wallets'),
  addWallet: (address, label) => request('POST', '/api/wallets', { address, label }),
  updateWallet: (id, label) => request('PATCH', `/api/wallets/${id}`, { label }),
  deleteWallet: (id) => request('DELETE', `/api/wallets/${id}`),
  syncWallet: (id) => request('POST', `/api/wallets/${id}/sync`),
  getWalletStats: (id) => request('GET', `/api/wallets/${id}/stats`),
  getTrades: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/wallets/${id}/trades${q ? '?' + q : ''}`);
  },
  getPositions: (id) => request('GET', `/api/wallets/${id}/positions`),
  getTimeline: (id) => request('GET', `/api/wallets/${id}/timeline`),
  getMeStats: () => request('GET', '/api/me/stats'),
  exportWallet: (id, format) => {
    const token = getToken();
    window.open(`${BASE}/api/wallets/${id}/export?format=${format}&token=${token}`, '_blank');
  },
};
