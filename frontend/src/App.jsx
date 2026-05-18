import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { loginWithTelegram, isLoggedIn } from './lib/auth.js';
import WalletsPage from './pages/WalletsPage.jsx';
import WalletDetailPage from './pages/WalletDetailPage.jsx';
import toast from 'react-hot-toast';

function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loginWithTelegram()
      .then(() => navigate('/wallets', { replace: true }))
      .catch(err => {
        toast.error('Ошибка входа: ' + err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      {loading ? (
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400">Входим...</p>
        </div>
      ) : (
        <div className="text-center text-gray-400 p-6">
          <p>Ошибка входа. Открой через Telegram.</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  if (isLoggedIn()) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/wallets" replace />} />
        <Route path="/wallets" element={<WalletsPage />} />
        <Route path="/wallets/:id" element={<WalletDetailPage />} />
        <Route path="*" element={<Navigate to="/wallets" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="*" element={<LoginPage />} />
    </Routes>
  );
}
