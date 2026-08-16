/**
 * Stress test: Large snapshot — 5,000 entities snapshot request.
 *
 * This test validates that the SyncServer can handle snapshot
 * requests for a large number of entities across multiple collections.
 */

import { describe, it, expect } from 'vitest';
import { SyncServer } from '../../src/sync-server.js';
import type { ProtocolEntity } from '@offlinesync/protocol';

const ENTITY_COUNT = 5_000;
const COLLECTION_COUNT = 5;
const ENTITIES_PER_COLLECTION = ENTITY_COUNT / COLLECTION_COUNT;

const NOW = '2026-08-14T10:00:00Z';

function makeEntity(overrides?: Partial<ProtocolEntity>): ProtocolEntity {
  return {
    id: 'entity-001',
    data: { title: 'Test' },
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    isDeleted: false,
    ...overrides,
  };
}

describe('stress: large snapshot', () => {
  it('should return snapshot with 5,000 entities across multiple collections', () => {
    const server = new SyncServer();

    // Seed entities across multiple collections
    for (let colIndex = 0; colIndex < COLLECTION_COUNT; colIndex++) {
      const collectionName = `collection-${colIndex}`;
      for (let entityIndex = 0; entityIndex < ENTITIES_PER_COLLECTION; entityIndex++) {
        server.seedEntity(
          collectionName,
          makeEntity({
            id: `entity-${colIndex}-${entityIndex}`,
            data: {
              title: `Entity ${entityIndex} in ${collectionName}`,
              value: entityIndex,
            },
            revision: 1,
          }),
        );
      }
    }

    expect(server.entityCount).toBe(ENTITY_COUNT);

    const start = performance.now();

    const response = server.handleSnapshotRequest({
      clientId: 'snapshot-client',
    });

    const duration = performance.now() - start;

    // Verify all collections are present
    expect(Object.keys(response.entities)).toHaveLength(COLLECTION_COUNT);

    // Verify entity count per collection
    for (let colIndex = 0; colIndex < COLLECTION_COUNT; colIndex++) {
      const collectionName = `collection-${colIndex}`;
      const entities = response.entities[collectionName];
      expect(Array.isArray(entities)).toBe(true);
      if (Array.isArray(entities)) {
        expect(entities).toHaveLength(ENTITIES_PER_COLLECTION);
      }
    }

    // Verify total entity count
    let totalCount = 0;
    for (const collectionEntities of Object.values(response.entities)) {
      if (Array.isArray(collectionEntities)) {
        totalCount += collectionEntities.length;
      }
    }
    expect(totalCount).toBe(ENTITY_COUNT);

    // Verify cursor is valid
    expect(response.cursor).toBeDefined();
    expect(response.serverTimestamp).toBeDefined();

    // Should complete within 5 seconds
    expect(duration).toBeLessThan(5_000);
  });

  it('should return filtered snapshot with only specified collections', () => {
    const server = new SyncServer();

    // Seed entities into 5 collections
    for (let colIndex = 0; colIndex < COLLECTION_COUNT; colIndex++) {
      const collectionName = `collection-${colIndex}`;
      for (let entityIndex = 0; entityIndex < ENTITIES_PER_COLLECTION; entityIndex++) {
        server.seedEntity(
          collectionName,
          makeEntity({
            id: `entity-${colIndex}-${entityIndex}`,
            data: { title: `Item ${entityIndex}`, value: entityIndex },
            revision: 1,
          }),
        );
      }
    }

    const start = performance.now();

    // Request snapshot for only 2 collections
    const response = server.handleSnapshotRequest({
      clientId: 'filtered-client',
      collections: ['collection-0', 'collection-2'],
    });

    const duration = performance.now() - start;

    // Only 2 collections should be returned
    expect(Object.keys(response.entities)).toHaveLength(2);
    expect(response.entities['collection-0']).toBeDefined();
    expect(response.entities['collection-2']).toBeDefined();

    const col0 = response.entities['collection-0'];
    const col2 = response.entities['collection-2'];
    expect(Array.isArray(col0) && col0.length).toBe(ENTITIES_PER_COLLECTION);
    expect(Array.isArray(col2) && col2.length).toBe(ENTITIES_PER_COLLECTION);

    // Other collections should not be present
    expect(response.entities['collection-1']).toBeUndefined();
    expect(response.entities['collection-3']).toBeUndefined();
    expect(response.entities['collection-4']).toBeUndefined();

    // Should complete within 5 seconds
    expect(duration).toBeLessThan(5_000);
  });
});
