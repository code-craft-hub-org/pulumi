import app from './app';

const port = parseInt(process.env.PORT ?? '3000', 10);

const server = app.listen(port, '0.0.0.0', () => {
  const env = process.env.NODE_ENV ?? 'development';
  const version = process.env.APP_VERSION ?? 'local';
  console.log(`[${env}@${version}] Server listening on port ${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
