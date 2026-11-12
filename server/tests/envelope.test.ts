/**
 * Envelope + health contract.
 *
 * The gate's first line is "all endpoints return the exact contract envelope".
 * That is asserted once, here, for every route — a route that returns a bare
 * array passes its own feature test and still breaks the storefront.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, api, resetState, expectSuccess, expectFailure } from './helpers.js';

beforeAll(async () => {
  await resetState();
});

describe('health', () => {
  it('is unversioned and reports the database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    const data = res.body.data as Record<string, unknown>;
    expect(data).toHaveProperty('status');
  });
});

describe('success envelope', () => {
  const routes = [
    '/products?limit=2',
    '/products/slugs?limit=5',
    '/categories',
    '/brands',
    '/search?q=a',
    '/flash-sale',
    '/homepage',
  ];

  for (const route of routes) {
    it(`${route} returns { success, data }`, async () => {
      const res = await api(route);
      expect(res.status).toBe(200);
      expectSuccess(res.body);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  }
});

describe('failure envelope', () => {
  it('unknown product slug is a 404 with the envelope, never a 500', async () => {
    const res = await api('/products/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expectFailure(res.body);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('an unmounted route is a 404 with the envelope', async () => {
    const res = await api('/nope/nothing/here');
    expect(res.status).toBe(404);
    expectFailure(res.body);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a validation failure is a 422 with field detail', async () => {
    const res = await api('/products?limit=99999');
    expect(res.status).toBe(422);
    expectFailure(res.body);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});

describe('pagination meta', () => {
  it('carries page, limit, total and totalPages', async () => {
    const res = await api('/products?page=2&limit=10');
    expect(res.status).toBe(200);
    expectSuccess(res.body);
    expect(res.body.meta).toMatchObject({ page: 2, limit: 10 });
    expect(typeof res.body.meta?.total).toBe('number');
    expect(res.body.meta?.totalPages).toBe(Math.max(1, Math.ceil((res.body.meta?.total ?? 0) / 10)));
  });
});
