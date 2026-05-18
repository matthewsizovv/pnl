import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createBot } from './bot/index.js';
import { telegramAuthRoute } from './api/auth.js';
import { registerRoutes } from './api/routes.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.PORT || '3000');

async function main() {
  // Init DB
  const { getDb } = await import('./db/index.js');
  getDb();

  // Fastify
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, {
    origin: process.env.DASHBOARD_URL || true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMIT', message: 'Too many requests' },
    }),
  });

  await telegramAuthRoute(fastify);
  await registerRoutes(fastify);

  fastify.get('/health', () => ({ ok: true }));

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`API listening on port ${PORT}`);

  // Bot
  if (!process.env.BOT_TOKEN) {
    logger.warn('BOT_TOKEN not set — bot not started');
    return;
  }

  const bot = createBot(process.env.BOT_TOKEN);

  process.once('SIGINT', () => { bot.stop('SIGINT'); fastify.close(); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); fastify.close(); });

  await bot.launch();
  logger.info('Bot started');
}

main().catch(err => {
  logger.error(err, 'Startup failed');
  process.exit(1);
});
