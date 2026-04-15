import 'dotenv/config';
import { createBot } from './bot.js';
import { getAllActions } from './actions/registry.js';

async function main() {
  console.log('🚀 Starting TG AI Worker Bot...');

  const actions = getAllActions();
  console.log(`📦 Loaded ${actions.length} actions`);

  const bot = createBot();

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    bot.stop(signal);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await bot.launch();
  console.log('✅ Bot is running!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
