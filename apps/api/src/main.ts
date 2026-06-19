import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const globalPrefix = config.get<string>('app.globalPrefix') ?? 'api/v1';
  const corsOrigins = config.get<string[]>('app.corsOrigins') ?? [
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  app.setGlobalPrefix(globalPrefix);
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableCors({ origin: corsOrigins, credentials: true });

  await app.listen(config.get<number>('app.port') ?? 3001);
}
bootstrap();
