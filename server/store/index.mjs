import { FileStore } from './file-store.mjs';
import { PostgresStore } from './postgres-store.mjs';

export function createStore(env = process.env) {
  const mode = (env.DAILY_STORE_MODE || '').toLowerCase();

  if (mode === 'file') {
    return new FileStore();
  }

  if (mode === 'postgres') {
    return new PostgresStore({
      databaseUrl: env.DATABASE_URL,
      psqlPath: env.PSQL_PATH
    });
  }

  if (env.DATABASE_URL) {
    try {
      return new PostgresStore({
        databaseUrl: env.DATABASE_URL,
        psqlPath: env.PSQL_PATH
      });
    } catch (error) {
      return new FileStore();
    }
  }

  return new FileStore();
}
