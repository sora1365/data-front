import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

/**
 * Los front que pueden llamar al API.
 *
 * Son dos aplicaciones en dos puertos: FRIDAY en el 3000 y el CRM en el 3002.
 * La lista sale de `CORS_ORIGIN` (separada por comas) y, si no está puesta,
 * de estos dos valores: hasta ahora el origen estaba escrito en el código y
 * `CORS_ORIGIN` existía en el `.env` sin que nadie la leyera, así que cambiarla
 * allí no hacía nada.
 */
const ORIGENES = (process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3002')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  app.enableCors({
    origin: ORIGENES,
    credentials: true,
    // `Content-Range` lleva el total de cada lista del CRM. Sin exponerla, el
    // navegador se la oculta al JavaScript y todas las listas se quedan en una
    // sola página sin que nada falle de forma visible.
    exposedHeaders: ['Content-Range'],
  });

  await app.listen(3001, '0.0.0.0', () => {
    console.log('🚀 Backend corriendo en: http://localhost:3001');
  });
}
bootstrap();
