import { createApp } from './app';
import { env } from './config/env';
import { migrate } from './database/client';

async function bootstrap() {
  await migrate();
  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend 服务已启动，端口：${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('服务启动失败', error);
  process.exit(1);
});
