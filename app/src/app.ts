import express, { Request, Response } from 'express';

const app = express();

const env = process.env.NODE_ENV ?? 'development';
const version = process.env.APP_VERSION ?? 'local';

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', env, version });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello, World!', env, version });
});

export default app;
