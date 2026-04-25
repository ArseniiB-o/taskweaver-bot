import 'dotenv/config';
import { createBot } from './bot.js';
import { getAllActions } from './actions/registry.js';
import { loadConfig } from './config.js';
import { logger } from './security/logger.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const actions = getAllActions();
  logger.info('starting', {
    actions: actions.length,
    model: cfg.openrouterModel,
    allowedUsers: cfg.allowedUsers.length,
    publicMode: cfg.allowedUsers.length === 0,
  });

  const bot = createBot();

  const shutdown = async (signal: string) => {
    logger.info('shutdown', { signal });
    bot.stop(signal);
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => logger.error('uncaughtException', { err }));
  process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { err }));

  await bot.launch();
  logger.info('ready');
}

main().catch(err => {
  logger.error('fatal', { err });
  process.exit(1);
});
