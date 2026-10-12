const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const requestContext = require('./middleware/requestContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const apiRoutes = require('./routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // Express 5 parses query strings with the "simple" parser; keep it that way
  // so repeated or nested query keys cannot be smuggled into filters.
  app.set('query parser', 'simple');

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestContext);

  app.use('/api/v1', apiRoutes);
  app.use('/api', notFoundHandler);

  // In production the built React app is served by the same origin.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (config.isProduction && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
