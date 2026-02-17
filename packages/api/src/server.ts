import cron from 'node-cron';
import app from './app.js';
import pool from './db/pool.js';
import { logger } from './lib/logger.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

// Clean up expired holds every minute
cron.schedule('* * * * *', async () => {
  try {
    const result = await pool.query(`
      UPDATE bookings.reservations
      SET status = 'cancelled'
      WHERE status = 'hold'
        AND hold_expires < NOW()
    `);
    if (result.rowCount && result.rowCount > 0) {
      logger.info({ count: result.rowCount }, 'Cleaned up expired holds');
    }
  } catch (err) {
    logger.error(err, 'Hold cleanup error');
  }
});

// Graceful shutdown
function shutdown() {
  logger.info('Shutting down...');
  pool.end().then(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Booking API started');
});
