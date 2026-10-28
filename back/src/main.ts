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
 *
 * Un origen con `*` en el puerto —`http://localhost:*`— vale para cualquier
 * puerto de esa máquina. Es para desarrollo: cuando el 3002 está ocupado, Vite
 * levanta el CRM en el 3003, y sin esto ese CRM no puede hablar con el back
 * de siempre y acaba arrancando un segundo back sólo para probar. Sólo se
 * acepta el comodín en el puerto, nunca en el host: `http://*` abriría el API
 * a cualquier página.
 */
const ORIGENES: (string | RegExp)[] = (
  process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3002'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => {
    const comodin = /^(https?:\/\/[^/:*]+):\*$/.exec(o);
    return comodin ? new RegExp(`^${comodin[1].replace(/\./g, '\\.')}:\\d+$`) : o;
  });

async function bootstrap() {
  // `rawBody` conserva el cuerpo sin interpretar además del objeto ya
  // convertido. Hace falta para comprobar la firma de los webhooks de Meta,
  // que se calcula sobre los bytes exactos que mandaron: volver a serializar
  // el objeto cambia el orden de las claves y los espacios, y la firma deja de
  // coincidir aunque el mensaje sea legítimo.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  app.enableCors({
    origin: ORIGENES,
    credentials: true,
    // `Content-Range` lleva el total de cada lista del CRM. Sin exponerla, el
    // navegador se la oculta al JavaScript y todas las listas se quedan en una
    // sola página sin que nada falle de forma visible.
    exposedHeaders: ['Content-Range'],
  });

  // `PORT` ya estaba en el `.env` sin que nadie la leyera. Leerla permite
  // levantar una segunda copia del API —otra rama, otro worktree— sin
  // pelearse por el 3001.
  const puerto = Number(process.env.PORT ?? 3001);
  await app.listen(puerto, '0.0.0.0', () => {
    console.log(`🚀 Backend corriendo en: http://localhost:${puerto}`);
  });
}
bootstrap();
