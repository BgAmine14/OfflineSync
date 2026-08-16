/**
 * Tests for sync state management logic.
 */

import { describe, it, expect } from 'vitest';
import {
  createSyncStateController,
  getDefaultSyncState,
  handleSyncStateChange,
} from '../src/sync-state-logic.js';
import type { SyncStateSource } from '../src/types.js';
import { SYNC_STATE } from '@offlinesync/core';

describe('sync-state-logic', () => {
  // ----------------------------------------------------------------
  // getDefaultSyncState
  // ----------------------------------------------------------------
  describe('getDefaultSyncState', () => {
    it('should return LOCAL_ONLY when called', () => {
      const state = getDefaultSyncState();
      expect(state).toBe(SYNC_STATE.LOCAL_ONLY);
    });
  });

  // ----------------------------------------------------------------
  // handleSyncStateChange
  // ----------------------------------------------------------------
  describe('handleSyncStateChange', () => {
    it('should return new state when state changes', () => {
      const result = handleSyncStateChange(
        SYNC_STATE.LOCAL_ONLY,
        SYNC_STATE.SYNCING,
      );
      expect(result).toBe(SYNC_STATE.SYNCING);
    });

    it('should return same state reference when state is unchanged', () => {
      const result = handleSyncStateChange(
        SYNC_STATE.SYNCED,
        SYNC_STATE.SYNCED,
      );
      expect(result).toBe(SYNC_STATE.SYNCED);
    });
  });

  // ----------------------------------------------------------------
  // createSyncStateController
  // ----------------------------------------------------------------
  describe('createSyncStateController', () => {
    it('should return initial sync state from source', () => {
      const source: SyncStateSource = {
        getSyncState: () => SYNC_STATE.CONNECTED,
        onStateChange: () => {
          return () => {
            /* noop */
          };
        },
      };

      const controller = createSyncStateController(source);

      expect(controller.state).toBe(SYNC_STATE.CONNECTED);
      controller.dispose();
    });

    it('should update state when source emits change', () => {
      let changeCallback: ((state: string) => void) | null = null;
      const source: SyncStateSource = {
        getSyncState: () => SYNC_STATE.LOCAL_ONLY,
        onStateChange: (callback) => {
          changeCallback = callback;
          return () => {
            changeCallback = null;
          };
        },
      };

      const controller = createSyncStateController(source);
      expect(controller.state).toBe(SYNC_STATE.LOCAL_ONLY);

      // Simulate state change
      if (changeCallback !== null) {
        changeCallback(SYNC_STATE.SYNCED);
      }

      expect(controller.state).toBe(SYNC_STATE.SYNCED);
      controller.dispose();
    });

    it('should stop listening after dispose is called', () => {
      let cleanupCalled = false;
      const source: SyncStateSource = {
        getSyncState: () => SYNC_STATE.LOCAL_ONLY,
        onStateChange: () => {
          return () => {
            cleanupCalled = true;
          };
        },
      };

      const controller = createSyncStateController(source);
      controller.dispose();

      expect(cleanupCalled).toBe(true);
    });
  });
});
