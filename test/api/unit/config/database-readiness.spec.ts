import type { Server } from 'node:http';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { EntitiesMetadataStorage } from '@nestjs/typeorm/dist/entities-metadata.storage';
import { BillingModule } from '../../../../apps/api/src/modules/billing.module';
import { CommonAuthModule } from '../../../../apps/api/src/common/common-auth.module';
import {
  DatabaseReadinessController,
  READINESS_ENTITIES,
} from '../../../../apps/api/src/database/database-readiness.controller';

describe('registered TypeORM entity identity without filesystem globs', () => {
  it('registers all25 runtime constructor targets without filesystem globs or DB access', () => {
    expect(BillingModule).toBeDefined();
    expect(CommonAuthModule).toBeDefined();
    const registered =
      EntitiesMetadataStorage.getEntitiesByDataSource('default');
    expect(READINESS_ENTITIES).toHaveLength(25);
    expect(registered).toHaveLength(25);
    for (const entity of READINESS_ENTITIES) {
      expect(registered).toContain(entity);
    }
  });
});

describe('GET health/ready HTTP contract', () => {
  let app: INestApplication;
  const query = jest.fn();
  const release = jest.fn();
  const connect = jest.fn();
  const ds = {
    isInitialized: true,
    hasMetadata: jest.fn(),
    getMetadata: jest.fn(),
    createQueryRunner: jest.fn(() => ({ connect, release })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DatabaseReadinessController],
      providers: [{ provide: DataSource, useValue: ds }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    ds.isInitialized = true;
    ds.hasMetadata.mockReturnValue(true);
    ds.getMetadata.mockImplementation((entity: unknown) => ({
      target: entity,
    }));
    connect.mockResolvedValue({ query });
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    release.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await app.close();
  });
  it('returns public service identity only after all metadata and a bounded database probe', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/health/ready')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'billing' });
    expect(ds.hasMetadata).toHaveBeenCalledTimes(25);
    expect(query).toHaveBeenCalledWith({
      text: 'SELECT 1',
      query_timeout: 2000,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each([
    'uninitialized',
    'missing-metadata',
    'wrong-constructor',
    'database-error',
  ])('returns generic503 for %s', async (failure) => {
    if (failure === 'uninitialized') ds.isInitialized = false;
    if (failure === 'missing-metadata') ds.hasMetadata.mockReturnValue(false);
    if (failure === 'wrong-constructor')
      ds.getMetadata.mockReturnValue({
        target: class DifferentLoadedConstructor {},
      });
    if (failure === 'database-error')
      query.mockRejectedValue(new Error('private database connection details'));
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/health/ready')
      .expect(503);
    expect(response.body).toEqual({
      status: 'unavailable',
      service: 'billing',
    });
    expect(JSON.stringify(response.body)).not.toContain('private');
    if (failure === 'database-error') expect(release).toHaveBeenCalledTimes(1);
    else expect(connect).not.toHaveBeenCalled();
  });
  it('bounds a stalled pool acquisition and releases the eventual connection', async () => {
    jest.useFakeTimers();
    let finish!: (value: unknown) => void;
    connect.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    try {
      const controller = new DatabaseReadinessController(ds as never);
      const pending = controller.ready();
      const denied = expect(pending).rejects.toMatchObject({ status: 503 });
      await jest.advanceTimersByTimeAsync(2500);
      await denied;
      finish({ query });
      await jest.advanceTimersByTimeAsync(0);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
