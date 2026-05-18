import React from 'react';

export default function StatCard({ label, value, sub, positive, negative, loading }) {
  const color = positive ? 'text-green-400' : negative ? 'text-red-400' : 'text-white';

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      {loading ? (
        <div className="skeleton h-7 w-24 mb-1" />
      ) : (
        <p className={`text-xl font-bold ${color}`}>{value ?? '—'}</p>
      )}
      {sub && !loading && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}
