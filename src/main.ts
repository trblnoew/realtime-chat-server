import { NestFactory } from '@nestjs/core';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const expressApp = app.getHttpAdapter().getInstance();
  const indexPath = join(process.cwd(), 'public', 'index.html');
  const loginPath = join(process.cwd(), 'public', 'login.html');
  expressApp.get('/login', (_req, res) => {
    res.sendFile(loginPath);
  });
  expressApp.get(['/rt', '/a/:roomId', '/b/:peerUserId'], (_req, res) => {
    res.sendFile(indexPath);
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
