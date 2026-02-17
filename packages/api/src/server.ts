import cron from 'node-cron';
import app from './app.js';
import pool from './db/pool.js';

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
      console.log(`Cleaned up ${result.rowCount} expired hold(s)`);
    }
  } catch (err) {
    console.error('Hold cleanup error:', err);
  }
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  pool.end().then(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
  console.log(`Booking API running on port ${PORT}`);
});
