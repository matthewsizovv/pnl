import React, { useState } from 'react';
import { api } from '../lib/api.js';
import toast from 'react-hot-toast';

export default function AddWalletModal({ onClose, onAdded }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const wallet = await api.addWallet(address.trim(), label.trim() || undefined);
      toast.success('Кошелёк добавлен! Синк запущен.');
      onAdded(wallet);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
        <h2 className="text-lg font-bold mb-4">Добавить кошелёк</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Адрес (0x...)</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="0x..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Метка (необязательно)</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Main wallet"
              maxLength={50}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-sm transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-brand hover:bg-brand-dark text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {loading ? 'Добавляю...' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
