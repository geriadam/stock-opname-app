import { createApp } from './app.js';
import { env } from './config.js';
import { startBoss } from './jobs/boss.js';

async function main() {
  const app = createApp();
  await startBoss();

  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
