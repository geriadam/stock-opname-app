import PgBoss from 'pg-boss';
import { env } from '../config.js';
import { APPLY_STOCK_QUEUE, applyStockJob } from './apply-stock.js';

let boss: PgBoss | null = null;

export async function startBoss() {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    retryLimit: 3,
    retryBackoff: true,
    retryDelay: 5,
  });

  boss.on('error', (err) => {
    console.error('[pg-boss]', err);
  });

  await boss.start();

  await boss.createQueue(APPLY_STOCK_QUEUE);

  await boss.work(APPLY_STOCK_QUEUE, async ([job]) => {
    const data = job.data as { sessionId: string };
    await applyStockJob(data.sessionId);
  });

  console.log('[pg-boss] worker started');
  return boss;
}

export async function enqueueApplyStock(sessionId: string) {
  // Tests: apply inline so assertions don't race the queue worker.
  if (process.env.APPLY_SYNC === '1') {
    await applyStockJob(sessionId);
    return;
  }

  if (!boss) {
    // Lazy start for tests / first call
    await startBoss();
  }
  await boss!.send(APPLY_STOCK_QUEUE, { sessionId }, {
    retryLimit: 3,
    retryBackoff: true,
    singletonKey: sessionId,
  });
}

export async function stopBoss() {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10_000 });
    boss = null;
  }
}
