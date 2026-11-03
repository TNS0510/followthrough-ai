
import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;

/**
 * Returns the shared PostgreSQL connection.
 * The connection is created only when the application first needs it.
 */
export function getDb(): ReturnType<typeof postgres> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  if (!sql) {
    sql = postgres(databaseUrl, {
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      prepare: true,
      connection: {
        application_name: 'followthrough-ai',
      },
    });
  }

  return sql;
}
