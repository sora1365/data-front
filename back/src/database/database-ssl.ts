/** SSL setting shared by TypeORM and the dedicated `pg` clients. */
export function databaseSslConfig(): false | { rejectUnauthorized: false } {
  return process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
}
