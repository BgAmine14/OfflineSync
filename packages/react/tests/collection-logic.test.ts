/**
 * Tests for collection state management logic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Entity } from '@offlinesync/storage';
import type { CollectionDataSource, UseCollectionResult } from '../src/types.js';
import {
  createCollectionController,
  createInitialCollectionState,
  handleCollectionEntitiesLoaded,
  handleCollectionError,
  handleCollectionSyncStateChange,
} from '../src/collection-logic.js';
import type { CollectionDataSource } from '../src/types.js';
import { SYNC_STATE } from '@offlinesync/core';

describe('collection-logic', () => {
  interface TestData {
    readonly name: string;
  }

  function makeEntity(id: string, data: TestData): Entity<TestData> {
    return {
      id,
      data,
      revision: 1,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      isDeleted: false,
    };
  }

  function makeDataSource(
    entities: readonly Entity<TestData>[] = [],
    syncState = SYNC_STATE.SYNCED,
  ): CollectionDataSource<TestData> {
    const changeCallbacks: (() => void)[] = [];
    return {
      getAll: async () => entities,
      subscribeToChanges: (callback) => {
        changeCallbacks.push(callback);
        return {
          dispose: () => {
            const index = changeCallbacks.indexOf(callback);
            if (index !== -1) {
              changeCallbacks.splice(index, 1);
            }
          },
        };
      },
      getSyncState: () => syncState,
    };
  }

  // ----------------------------------------------------------------
  // createInitialCollectionState
  // ----------------------------------------------------------------
  describe('createInitialCollectionState', () => {
    it('should return empty entities array when called', () => {
      const state = createInitialCollectionState<TestData>();
      expect(state.entities).toEqual([]);
    });

    it('should return isLoading true when called', () => {
      const state = createInitialCollectionState<TestData>();
      expect(state.isLoading).toBe(true);
    });

    it('should return null error when called', () => {
      const state = createInitialCollectionState<TestData>();
      expect(state.error).toBeNull();
    });

    it('should return LOCAL_ONLY sync state when called', () => {
      const state = createInitialCollectionState<TestData>();
      expect(state.syncState).toBe(SYNC_STATE.LOCAL_ONLY);
    });
  });

  // ----------------------------------------------------------------
  // createCollectionController
  // ----------------------------------------------------------------
  describe('createCollectionController', () => {
    it('should return entities from data source when fetched', async () => {
      const entities = [
        makeEntity('1', { name: 'Alice' }),
        makeEntity('2', { name: 'Bob' }),
      ];
      const dataSource = makeDataSource(entities);
      const controller = createCollectionController(dataSource);

      // Wait for the initial fetch
      await vi.waitFor(() => {
        expect(controller.state.entities).toEqual(entities);
      });

      controller.dispose();
    });

    it('should set isLoading to false after fetch completes', async () => {
      const dataSource = makeDataSource([]);
      const controller = createCollectionController(dataSource);

      await vi.waitFor(() => {
        expect(controller.state.isLoading).toBe(false);
      });

      controller.dispose();
    });

    it('should update sync state from data source when refreshed', async () => {
      const dataSource = makeDataSource([], SYNC_STATE.SYNCED);
      const controller = createCollectionController(dataSource);

      await vi.waitFor(() => {
        expect(controller.state.syncState).toBe(SYNC_STATE.SYNCED);
      });

      controller.dispose();
    });

    it('should handle fetch error and set error state', async () => {
      const fetchError = new Error('Network failure');
      const dataSource: CollectionDataSource<TestData> = {
        getAll: async () => {
          throw fetchError;
        },
        subscribeToChanges: () => ({ dispose: () => { /* noop */ } }),
        getSyncState: () => SYNC_STATE.LOCAL_ONLY,
      };
      const controller = createCollectionController(dataSource);

      await vi.waitFor(() => {
        expect(controller.state.error).toBe(fetchError);
        expect(controller.state.isLoading).toBe(false);
      });

      controller.dispose();
    });

    it('should subscribe to change events and refresh on change', async () => {
      let entities: readonly Entity<TestData>[] = [
        makeEntity('1', { name: 'Alice' }),
      ];
      const changeCallbacks: (() => void)[] = [];
      const dataSource: CollectionDataSource<TestData> = {
        getAll: async () => entities,
        subscribeToChanges: (callback) => {
          changeCallbacks.push(callback);
          return { dispose: () => { /* noop */ } };
        },
        getSyncState: () => SYNC_STATE.SYNCED,
      };

      const controller = createCollectionController(dataSource);

      await vi.waitFor(() => {
        expect(controller.state.entities).toHaveLength(1);
      });

      // Simulate a change
      entities = [
        makeEntity('1', { name: 'Alice' }),
        makeEntity('2', { name: 'Bob' }),
      ];

      // Trigger the first change callback
      const callback = changeCallbacks[0];
      if (callback !== undefined) {
        callback();
      }

      await vi.waitFor(() => {
        expect(controller.state.entities).toHaveLength(2);
      });

      controller.dispose();
    });

    it('should stop updating after dispose is called', async () => {
      const dataSource = makeDataSource([]);
      const controller = createCollectionController(dataSource);

      controller.dispose();

      // Refresh after dispose should be a no-op
      await controller.refresh();
      expect(controller.state.isLoading).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // Pure state transition functions
  // ----------------------------------------------------------------
  describe('handleCollectionEntitiesLoaded', () => {
    it('should update entities and set isLoading to false', () => {
      const current = createInitialCollectionState<TestData>();
      const entities = [makeEntity('1', { name: 'Test' })];

      const result = handleCollectionEntitiesLoaded(current, entities);

      expect(result.entities).toEqual(entities);
      expect(result.isLoading).toBe(false);
      expect(result.error).toBeNull();
    });

    it('should preserve sync state when entities are loaded', () => {
      const current = {
        ...createInitialCollectionState<TestData>(),
        syncState: SYNC_STATE.SYNCED,
      };
      const entities = [makeEntity('1', { name: 'Test' })];

      const result = handleCollectionEntitiesLoaded(current, entities);

      expect(result.syncState).toBe(SYNC_STATE.SYNCED);
    });
  });

  describe('handleCollectionError', () => {
    it('should set error and set isLoading to false', () => {
      const current = createInitialCollectionState<TestData>();
      const error = new Error('test error');

      const result = handleCollectionError(current, error);

      expect(result.error).toBe(error);
      expect(result.isLoading).toBe(false);
    });

    it('should preserve existing entities when error occurs', () => {
      const entities = [makeEntity('1', { name: 'Test' })];
      const current = handleCollectionEntitiesLoaded(
        createInitialCollectionState<TestData>(),
        entities,
      );
      const error = new Error('sync error');

      const result = handleCollectionError(current, error);

      expect(result.entities).toEqual(entities);
    });
  });

  describe('handleCollectionSyncStateChange', () => {
    it('should update sync state to new value', () => {
      const current = createInitialCollectionState<TestData>();

      const result = handleCollectionSyncStateChange(
        current,
        SYNC_STATE.SYNCING,
      );

      expect(result.syncState).toBe(SYNC_STATE.SYNCING);
    });

    it('should preserve other state properties when sync state changes', () => {
      const entities = [makeEntity('1', { name: 'Test' })];
      const error = new Error('previous');
      const current: UseCollectionResult<TestData> = {
        entities,
        isLoading: false,
        error,
        syncState: SYNC_STATE.LOCAL_ONLY,
      };

      const result = handleCollectionSyncStateChange(
        current,
        SYNC_STATE.SYNCED,
      );

      expect(result.entities).toEqual(entities);
      expect(result.isLoading).toBe(false);
      expect(result.error).toBe(error);
      expect(result.syncState).toBe(SYNC_STATE.SYNCED);
    });
  });
});
