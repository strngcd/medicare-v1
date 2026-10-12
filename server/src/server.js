const config = require('./config');
const { createApp } = require('./app');
const pool = require('./database/pool');

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Medicar API listening on port ${config.port} (${config.env})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
