/**
 * Server bootstrap.
 *
 * Verifies the database connection before binding the port, so a broken
 * DATABASE_URL fails at boot instead of on the first request.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabase, prisma } from './config/database.js';

async function main(): Promise<void> {
  const databaseUp = await checkDatabase();
  if (!databaseUp) {
    // eslint-disable-next-line no-console
    console.error(
      '\nCannot reach MySQL at DATABASE_URL.\n' +
        'Check that the server is running and the credentials in .env are correct.\n' +
        'The API will start anyway so /health can report the failure.\n',
    );
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `SharkMart API listening on http://localhost:${env.PORT} ` +
        `(${env.NODE_ENV}, database ${databaseUp ? 'up' : 'DOWN'})`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — shutting down`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', error);
  process.exit(1);
});
