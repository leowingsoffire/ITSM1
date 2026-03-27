import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env, logger } from './config';
import { errorHandler, requestLogger } from './middleware';
import { apiRouter } from './routes';

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true }));

// Parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Observability
app.use(requestLogger);

// Routes
app.use('/api/v1', apiRouter);

// Error handling
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, `ITSM1 API running on port ${env.PORT}`);
});

export { app };
