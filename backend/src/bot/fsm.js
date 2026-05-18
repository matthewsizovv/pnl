// In-memory FSM with TTL
const TTL = 5 * 60 * 1000;
const states = new Map();

export function getState(userId) {
  const entry = states.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > TTL) {
    states.delete(userId);
    return null;
  }
  return entry.state;
}

export function setState(userId, state, data = {}) {
  states.set(userId, { state, data, updatedAt: Date.now() });
}

export function getData(userId) {
  return states.get(userId)?.data || {};
}

export function updateData(userId, patch) {
  const entry = states.get(userId);
  if (entry) {
    entry.data = { ...entry.data, ...patch };
    entry.updatedAt = Date.now();
  }
}

export function clearState(userId) {
  states.delete(userId);
}
