import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api.js';
import StatCard from '../components/StatCard.jsx';
import toast from 'react-hot-toast';

function fmt(n) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export default function WalletDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [trades, setTrades] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [filter, setFilter] = useState({ type: '', token: '' });
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getWalletStats(id),
      api.getTimeline(id),
    ]).then(([s, t]) => {
      setStats(s);
      // Build cumulative timeline
      let cum = 0;
      setTimeline(t.map(d => ({ date: d.date, pnl: (cum += d.daily_pnl) })));
    }).catch(err => toast.error(err.message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setTradesLoading(true);
    const params = { cursor, limit: 50 };
    if (filter.type) params.type = filter.type;
    if (filter.token) params.token = filter.token;
    api.getTrades(id, params).then(data => {
      setTrades(prev => cursor === 0 ? data : [...prev, ...data]);
      setHasMore(data.length === 50);
    }).catch(err => toast.error(err.message)).finally(() => setTradesLoading(false));
  }, [id, cursor, filter]);

  function applyFilter(patch) {
    setFilter(f => ({ ...f, ...patch }));
    setCursor(0);
  }

  const winrate = stats ? Math.round((stats.wins / Math.max(stats.wins + stats.losses, 1)) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-950 pb-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-800">
        <button onClick={() => navigate('/wallets')} className="text-gray-400 hover:text-white">←</button>
        <h1 className="font-bold text-lg">Детали кошелька</h1>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => api.exportWallet(id, 'csv')}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition"
          >
            📄 CSV
          </button>
          <button
            onClick={() => api.exportWallet(id, 'xlsx')}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition"
          >
            📊 XLSX
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Total PnL" value={fmt(stats?.totalPnl)} positive={stats?.totalPnl >= 0} negative={stats?.totalPnl < 0} loading={loading} />
          <StatCard label="Realized" value={fmt(stats?.realizedPnl)} positive={stats?.realizedPnl >= 0} negative={stats?.realizedPnl < 0} loading={loading} />
          <StatCard label="Unrealized" value={fmt(stats?.unrealizedPnl)} positive={stats?.unrealizedPnl >= 0} negative={stats?.unrealizedPnl < 0} loading={loading} />
          <StatCard label="Winrate" value={loading ? null : `${winrate}%`} sub={stats ? `${stats.wins}W / ${stats.losses}L` : null} loading={loading} />
          <StatCard label="Сделок" value={stats?.tradeCount} loading={loading} />
          <StatCard label="Газ" value={fmt(stats?.gasSpent)} loading={loading} />
        </div>

        {/* PnL Chart */}
        {timeline.length > 1 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-sm text-gray-400 mb-3">Cumulative Realized PnL</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(v) => [fmt(v), 'PnL']}
                />
                <Line type="monotone" dataKey="pnl" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Open Positions */}
        {stats?.openPositions?.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-sm font-semibold mb-3">📦 Открытые позиции</p>
            <div className="space-y-2">
              {stats.openPositions.map(p => (
                <div key={p.tokenAddress} className="flex justify-between items-center text-sm">
                  <div>
                    <span className="font-medium">{p.tokenSymbol || p.tokenAddress.slice(0, 8)}</span>
                    <span className="text-gray-500 ml-2">{p.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-white">{fmt(p.valueUsd)}</p>
                    <p className={p.unrealizedPnl >= 0 ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                      {fmt(p.unrealizedPnl)} ({p.unrealizedPct >= 0 ? '+' : ''}{p.unrealizedPct.toFixed(1)}%)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trades Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm font-semibold">Сделки</p>
            <div className="flex gap-2">
              <select
                value={filter.type}
                onChange={e => applyFilter({ type: e.target.value })}
                className="bg-gray-800 text-xs text-gray-300 rounded-lg px-2 py-1 border border-gray-700"
              >
                <option value="">Все типы</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
              <input
                type="text"
                placeholder="Токен..."
                value={filter.token}
                onChange={e => applyFilter({ token: e.target.value })}
                className="bg-gray-800 text-xs text-gray-300 rounded-lg px-2 py-1 border border-gray-700 w-20"
              />
            </div>
          </div>

          {tradesLoading && cursor === 0 ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
            </div>
          ) : trades.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">Сделок нет</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-2">Дата</th>
                      <th className="text-left py-2">Тип</th>
                      <th className="text-left py-2">Токен</th>
                      <th className="text-right py-2">Кол-во</th>
                      <th className="text-right py-2">Цена</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(t => (
                      <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 text-gray-400">{fmtDate(t.timestamp)}</td>
                        <td className={`py-2 font-medium ${t.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                          {t.type.toUpperCase()}
                        </td>
                        <td className="py-2">{t.token_symbol || t.token_address.slice(0, 8)}</td>
                        <td className="py-2 text-right text-gray-300">{t.amount.toFixed(4)}</td>
                        <td className="py-2 text-right text-gray-300">${t.price_usd?.toFixed(4) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMore && (
                <button
                  onClick={() => setCursor(c => c + 50)}
                  className="w-full mt-3 text-sm text-brand hover:text-brand-dark transition"
                >
                  Загрузить ещё
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
