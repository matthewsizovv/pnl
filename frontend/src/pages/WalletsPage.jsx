import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import WalletCard from '../components/WalletCard.jsx';
import AddWalletModal from '../components/AddWalletModal.jsx';
import toast from 'react-hot-toast';

export default function WalletsPage() {
  const [wallets, setWallets] = useState([]);
  const [statsMap, setStatsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  async function loadWallets() {
    try {
      const ws = await api.getWallets();
      setWallets(ws);
      // Load stats in parallel
      const entries = await Promise.allSettled(ws.map(w => api.getWalletStats(w.id)));
      const map = {};
      ws.forEach((w, i) => {
        if (entries[i].status === 'fulfilled') map[w.id] = entries[i].value;
      });
      setStatsMap(map);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadWallets(); }, []);

  function handleDelete(id) {
    setWallets(ws => ws.filter(w => w.id !== id));
  }

  function handleSync(id) {
    // Reload stats after short delay
    setTimeout(() => {
      api.getWalletStats(id).then(stats => setStatsMap(m => ({ ...m, [id]: stats }))).catch(() => {});
    }, 3000);
  }

  function handleAdded(wallet) {
    setWallets(ws => [...ws, wallet]);
    loadWallets();
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">💼 Кошельки</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-brand hover:bg-brand-dark text-white text-sm px-4 py-2 rounded-lg transition"
        >
          + Добавить
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="skeleton h-36 rounded-xl" />)}
        </div>
      ) : wallets.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">💼</p>
          <p className="mb-4">Нет кошельков</p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-brand hover:bg-brand-dark text-white px-6 py-2 rounded-lg transition"
          >
            Добавить первый
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {wallets.map(w => (
            <WalletCard
              key={w.id}
              wallet={w}
              stats={statsMap[w.id]}
              onDelete={handleDelete}
              onSync={handleSync}
            />
          ))}
        </div>
      )}

      {showModal && (
        <AddWalletModal onClose={() => setShowModal(false)} onAdded={handleAdded} />
      )}
    </div>
  );
}
