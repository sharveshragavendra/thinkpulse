import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const supabaseHost = process.env.SUPABASE_DB_HOST?.trim();
    const supabaseUser = process.env.SUPABASE_DB_USER?.trim();
    const supabasePassword = process.env.SUPABASE_DB_PASSWORD?.trim();
    const supabasePort = Number(process.env.SUPABASE_DB_PORT?.trim()) || 6543;
    const supabaseDbName = process.env.SUPABASE_DB_NAME?.trim() || 'postgres';

    const useSupabasePostgres = Boolean(supabaseHost && supabaseUser && supabasePassword);

    global._postgresPool = useSupabasePostgres
      ? new Pool({
          host: supabaseHost,
          port: supabasePort,
          user: supabaseUser,
          password: supabasePassword,
          database: supabaseDbName,
          ssl: { rejectUnauthorized: false },
          max: 10,
          connectionTimeoutMillis: 15000,
        })
      : new Pool({
          host: process.env.SQL_HOST,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          max: 10,
          connectionTimeoutMillis: 15000,
        });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });
