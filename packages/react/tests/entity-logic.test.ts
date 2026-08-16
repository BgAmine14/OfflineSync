/**
 * Tests for entity state management logic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Entity } from '@offlinesync/storage';
import {
  createEntityController,
  createInitialEntityState,
  handleEntityLoaded,
  handleEntityNotFound,
  handleEntityError,
} from '../src/entity-logic.js';
import type { EntityDataSource } from '../src/types.js';

describe('entity-logic', () => {
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
    entity: Entity<TestData> | null = null,
  ): EntityDataSource<TestData> {
    return {
      get: async () => entity,
      subscribeToChanges: () => ({ dispose: () => { /* noop */ } }),
    };
  }

  // ----------------------------------------------------------------
  // createInitialEntityState
  // ----------------------------------------------------------------
  describe('createInitialEntityState', () => {
    it('should return null entity when called', () => {
      const state = createInitialEntityState<TestData>();
      expect(state.entity).toBeNull();
    });

    it('should return isLoading true when called', () => {
      const state = createInitialEntityState<TestData>();
      expect(state.isLoading).toBe(true);
    });

    it('should return null error when called', () => {
      const state = createInitialEntityState<TestData>();
      expect(state.error).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // createEntityController
  // ----------------------------------------------------------------
  describe('createEntityController', () => {
    it('should return entity from data source when fetched', async () => {
      const entity = makeEntity('1', { name: 'Alice' });
      const dataSource = makeDataSource(entity);
      const controller = createEntityController(dataSource, '1');

      await vi.waitFor(() => {
        expect(controller.state.entity).toEqual(entity);
      });

      controller.dispose();
    });

    it('should set isLoading to false after fetch completes', async () => {
      const dataSource = makeDataSource(null);
      const controller = createEntityController(dataSource, '1');

      await vi.waitFor(() => {
        expect(controller.state.isLoading).toBe(false);
      });

      controller.dispose();
    });

    it('should return null entity when data source returns null', async () => {
      const dataSource = makeDataSource(null);
      const controller = createEntityController(dataSource, 'missing');

      await vi.waitFor(() => {
        expect(controller.state.entity).toBeNull();
        expect(controller.state.isLoading).toBe(false);
      });

      controller.dispose();
    });

    it('should handle fetch error and set error state', async () => {
      const fetchError = new Error('Not found');
      const dataSource: EntityDataSource<TestData> = {
        get: async () => {
          throw fetchError;
        },
        subscribeToChanges: () => ({ dispose: () => { /* noop */ } }),
      };
      const controller = createEntityController(dataSource, '1');

      await vi.waitFor(() => {
        expect(controller.state.error).toBe(fetchError);
        expect(controller.state.isLoading).toBe(false);
      });

      controller.dispose();
    });

    it('should stop updating after dispose is called', async () => {
      const entity = makeEntity('1', { name: 'Alice' });
      const dataSource = makeDataSource(entity);
      const controller = createEntityController(dataSource, '1');

      await vi.waitFor(() => {
        expect(controller.state.entity).toEqual(entity);
      });

      controller.dispose();

      // After dispose, refresh should be a no-op
      await controller.refresh();
      // State should remain unchanged
      expect(controller.state.entity).toEqual(entity);
    });
  });

  // ----------------------------------------------------------------
  // Pure state transition functions
  // ----------------------------------------------------------------
  describe('handleEntityLoaded', () => {
    it('should set entity and set isLoading to false', () => {
      const current = createInitialEntityState<TestData>();
      const entity = makeEntity('1', { name: 'Test' });

      const result = handleEntityLoaded(current, entity);

      expect(result.entity).toEqual(entity);
      expect(result.isLoading).toBe(false);
      expect(result.error).toBeNull();
    });
  });

  describe('handleEntityNotFound', () => {
    it('should set entity to null and isLoading to false', () => {
      const current = createInitialEntityState<TestData>();

      const result = handleEntityNotFound(current);

      expect(result.entity).toBeNull();
      expect(result.isLoading).toBe(false);
      expect(result.error).toBeNull();
    });
  });

  describe('handleEntityError', () => {
    it('should set error and set isLoading to false', () => {
      const current = createInitialEntityState<TestData>();
      const error = new Error('fetch failed');

      const result = handleEntityError(current, error);

      expect(result.error).toBe(error);
      expect(result.isLoading).toBe(false);
    });

    it('should preserve existing entity when error occurs', () => {
      const entity = makeEntity('1', { name: 'Test' });
      const current = handleEntityLoaded(
        createInitialEntityState<TestData>(),
        entity,
      );
      const error = new Error('sync error');

      const result = handleEntityError(current, error);

      expect(result.entity).toEqual(entity);
    });
  });
});
