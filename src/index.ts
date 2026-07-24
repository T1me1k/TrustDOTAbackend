import { loadEnv } from './config/env.js';
import { buildApp, attachSocket } from './app.js';
import { MatchmakingWorker } from './worker/matcher.js';

const env = loadEnv();
const app = await buildApp({ env });
const io = attachSocket(app, app.server, env);

const worker = new MatchmakingWorker(
  env.MATCHER_INTERVAL_MS,
  async () => {},
  app.log,
);

worker.start();

app.get('/ready-worker', async () => ({
  worker: worker.isHealthy(),
}));

await app.listen({
  port: env.PORT,
  host: '0.0.0.0',
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'graceful shutdown started');

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  await worker.stop();
  io.close();
  await app.close();

  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));