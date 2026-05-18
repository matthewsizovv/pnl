import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { upsertUser } from '../services/userService.js';
import { logger } from '../logger.js';

export function validateInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  return computed === hash;
}

export function signJwt(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

export async function telegramAuthRoute(fastify) {
  fastify.post('/api/auth/telegram', async (req, reply) => {
    const { initData } = req.body || {};
    if (!initData) return reply.code(400).send({ error: { code: 'MISSING_INIT_DATA', message: 'initData required' } });

    const valid = validateInitData(initData, process.env.BOT_TOKEN);
    if (!valid) {
      // Allow in dev mode
      if (process.env.NODE_ENV !== 'development') {
        return reply.code(401).send({ error: { code: 'INVALID_INIT_DATA', message: 'Invalid initData' } });
      }
    }

    const params = new URLSearchParams(initData);
    let user;
    try {
      user = JSON.parse(params.get('user') || '{}');
    } catch {
      user = {};
    }

    const tgId = user.id || parseInt(params.get('user_id')) || 0;
    if (!tgId && process.env.NODE_ENV !== 'development') {
      return reply.code(400).send({ error: { code: 'NO_USER', message: 'No user in initData' } });
    }

    const effectiveTgId = tgId || 1; // dev fallback
    upsertUser({ tg_id: effectiveTgId, username: user.username, first_name: user.first_name });

    const token = signJwt({ tg_id: effectiveTgId, username: user.username });
    return { token, user: { tg_id: effectiveTgId, username: user.username, first_name: user.first_name } };
  });
}

export async function jwtMiddleware(req, reply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token required' } });
  }
  try {
    req.user = verifyJwt(auth.slice(7));
  } catch {
    return reply.code(401).send({ error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
  }
}
