import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CompaniasModule } from './modules/companias/companias.module';
import { CatalogoModule } from './modules/catalogo/catalogo.module';
import { CiiuModule } from './modules/ciiu/ciiu.module';
import { BalancesModule } from './modules/balances/balances.module';
import { PadronModule } from './modules/padron/padron.module';
import { ImportsModule } from './modules/imports/imports.module';
import { SegmentosModule } from './modules/segmentos/segmentos.module';
import { PresenciaModule } from './modules/presencia/presencia.module';
import { TributarioModule } from './modules/tributario/tributario.module';
import { ScrapingModule } from './modules/scraping/scraping.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'app_db',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      autoLoadEntities: true,
      migrations: [join(__dirname, 'database', 'migrations', '*{.ts,.js}')],
      // synchronize QUEDA DESACTIVADO A PROPÓSITO, también en desarrollo.
      //
      // Sobre una tabla de un millón de filas, la sincronización automática de
      // esquema puede lanzar un ALTER TABLE que reescribe la tabla entera con un
      // lock exclusivo por una discrepancia trivial, y además borra los índices
      // que no conoce — justo los que crea el importador con CREATE INDEX
      // CONCURRENTLY. El esquema se gestiona sólo con migraciones.
      synchronize: false,
      migrationsRun: false,
    }),
    CompaniasModule,
    CatalogoModule,
    CiiuModule,
    BalancesModule,
    PadronModule,
    ImportsModule,
    SegmentosModule,
    PresenciaModule,
    TributarioModule,
    ScrapingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
