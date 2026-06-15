import request from 'supertest';
import app from './app';

describe('GET /', () => {
  it('returns hello world', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Hello, World!');
  });

  it('includes env and version fields', async () => {
    const res = await request(app).get('/');
    expect(res.body).toHaveProperty('env');
    expect(res.body).toHaveProperty('version');
  });
});

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
