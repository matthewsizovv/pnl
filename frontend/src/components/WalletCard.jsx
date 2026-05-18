import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import toast from 'react-hot-toast';

function fmt(n) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeAgo(ts) {
  if (!ts) return 'никогда';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}с назад`;
  if (secs < 3600) return `${Math.floor(secs / 60)}м назад`;
  return `${Math.floor(secs / 3600)}ч назад`;
}

export default function WalletCard({ wallet, stats, onDelete, onSync }) {
  const navigate = useNavigate();
  const pnl = stats?.realizedPnl;
  const isPositive = pnl >= 0;

  async function handleDelete() {
    if (!confirm(`Удалить кошелёк ${wallet.label || wallet.addressShort}?`)) return;
    try {
      await api.deleteWallet(wallet.id);
      onDelete(wallet.id);
      toast.success('Кошелёк удалён');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSync() {
    try {
      await api.syncWallet(wallet.id);
      toast.success('Синк запущен');
      onSync(wallet.id);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="font-semibold text-white">{wallet.label || 'Без имени'}</p>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{wallet.addressShort || wallet.address}</p>
        </div>
        <span className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {fmt(pnl)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500 mb-4">
        <span>🔄 {stats?.tradeCount ?? 0} сделок</span>
        <span>🕐 {timeAgo(wallet.last_synced_at)}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => navigate(`/wallets/${wallet.id}`)}
          className="flex-1 bg-brand hover:bg-brand-dark text-white text-sm py-1.5 rounded-lg transition"
        >
          Открыть
        </button>
        <button
          onClick={handleSync}
          className="px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-1.5 rounded-lg transition"
          title="Синк"
        >
          🔄
        </button>
        <button
          onClick={handleDelete}
          className="px-3 bg-gray-800 hover:bg-red-900 text-gray-300 text-sm py-1.5 rounded-lg transition"
          title="Удалить"
        >
          🗑
        </button>
      </div>
    </div>
  );
}
