import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'node:path';

config();

/**
 * DataSource para el CLI de TypeORM (migraciones). TypeORM 0.3 exige este
 * estilo: `typeorm -d src/data-source.ts migration:run`.
 *
 * Los globs usan __dirname para que funcionen tanto con ts-node (src/*.ts)
 * como con el compilado (dist/*.js).
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'app_db',
  entities: [join(__dirname, 'modules', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'database', 'migrations', '*{.ts,.js}')],
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  synchronize: false,
});
// Sin `export default`: el CLI de TypeORM exige que el archivo exporte
// exactamente UNA instancia de DataSource, y el default contaría como segunda.
