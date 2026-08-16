/**
 * Tests for collection state management logic (Vue).
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
import { SYNC_STATE } from '@offlinesync/core';

describe('collection-logic (vue)', () => {
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
    return {
      getAll: async () => entities,
      subscribeToChanges: () => ({ dispose: () => { /* noop */ } }),
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
  });

  // ----------------------------------------------------------------
  // createCollectionController
  // ----------------------------------------------------------------
  describe('createCollectionController', () => {
    it('should return entities from data source when fetched', async () => {
      const entities = [
        makeEntity('1', { name: 'Alice' }),
      ];
      const dataSource = makeDataSource(entities);
      const controller = createCollectionController(dataSource);

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

    it('should invoke onStateChange callback when state changes', async () => {
      const entities = [makeEntity('1', { name: 'Test' })];
      const dataSource = makeDataSource(entities);
      const stateChanges: UseCollectionResult<TestData>[] = [];

      const controller = createCollectionController<TestData>(dataSource, {
        onStateChange: (state) => stateChanges.push(state),
      });

      await vi.waitFor(() => {
        expect(stateChanges.length).toBeGreaterThan(0);
      });

      const lastChange = stateChanges[stateChanges.length - 1];
      if (lastChange !== undefined) {
        expect(lastChange.entities).toEqual(entities);
        expect(lastChange.isLoading).toBe(false);
      }

      controller.dispose();
    });

    it('should stop updating after dispose is called', async () => {
      const dataSource = makeDataSource([]);
      const controller = createCollectionController(dataSource);

      controller.dispose();

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
  });

  describe('handleCollectionError', () => {
    it('should set error and set isLoading to false', () => {
      const current = createInitialCollectionState<TestData>();
      const error = new Error('test error');

      const result = handleCollectionError(current, error);

      expect(result.error).toBe(error);
      expect(result.isLoading).toBe(false);
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
  });
});
