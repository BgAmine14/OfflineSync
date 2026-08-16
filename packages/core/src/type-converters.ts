/**
 * Type converters — convert between client and protocol types.
 *
 * These functions operate at the SyncEngine boundary. They ensure:
 * - Client types never appear in protocol messages (data-model boundary rule)
 * - Protocol types never leak into client APIs
 *
 * No runtime code is imported, only types.
 */

import type { Entity } from '@offlinesync/storage';
import type { Mutation } from './types/index.js';
import type { SyncRequest } from '@offlinesync/protocol';
import type {
  ProtocolMutation,
  SyncResponse,
  Change,
  ProtocolEntity,
  SnapshotResponse,
} from '@offlinesync/protocol';

// =============================================================
// Client → Protocol
// =============================================================

/**
 * Convert a client Mutation to a ProtocolMutation.
 *
 * The client Mutation contains internal fields (sequence, status,
 * retries, lastError) that are stripped for transport to the server.
 * The entity's current revision is sent as baseRevision for
 * conflict detection.
 *
 * @param mutation - The client Mutation record.
 * @param baseRevision - The entity's revision at the time the
 *   mutation was created.
 * @returns A ProtocolMutation ready for transport.
 */
export function clientMutationToProtocol(
  mutation: Mutation,
  baseRevision: number,
): ProtocolMutation {
  return {
    id: mutation.id,
    entityId: mutation.entityId,
    collectionName: mutation.collectionName,
    operation: mutation.operation,
    field: mutation.field,
    value: mutation.value,
    baseRevision,
    createdAt: mutation.createdAt,
  };
}

/**
 * Build a SyncRequest from pending mutations from the queue.
 *
 * @param cursor - The current client cursor (empty string if never synced).
 * @param mutations - The pending mutations to send.
 * @param baseRevisions - Map of entityId → entity revision for conflict detection.
 * @param clientId - The client identifier.
 * @returns A SyncRequest ready to send via SyncTransport.
 */
export function buildSyncRequest(
  cursor: string,
  mutations: readonly Mutation[],
  baseRevisions: ReadonlyMap<string, number>,
  clientId: string,
): SyncRequest {
  const protocolMutations: ProtocolMutation[] = mutations.map((m) => {
    const baseRevision = baseRevisions.get(m.entityId) ?? 0;
    return clientMutationToProtocol(m, baseRevision);
  });

  return {
    cursor,
    mutations: protocolMutations,
    clientId,
  };
}

// =============================================================
// Protocol → Client
// =============================================================

/**
 * Convert a ProtocolEntity to a client Entity<T>.
 *
 * @param protocolEntity - A ProtocolEntity from the server.
 * @returns A client Entity.
 */
export function protocolEntityToClient<T>(
  protocolEntity: ProtocolEntity,
): Entity<T> {
  return {
    id: protocolEntity.id,
    data: protocolEntity.data as T,
    revision: protocolEntity.revision,
    createdAt: protocolEntity.createdAt,
    updatedAt: protocolEntity.updatedAt,
    isDeleted: protocolEntity.isDeleted,
  };
}

/**
 * Extract acknowledged mutation IDs from a SyncResponse.
 *
 * @param response - The SyncResponse from the server.
 * @returns Array of acknowledged mutation ID strings.
 */
export function extractAcknowledgedIds(
  response: SyncResponse,
): string[] {
  return response.acknowledgedMutationIds;
}

/**
 * Extract conflict mutation IDs from a SyncResponse.
 *
 * @param response - The SyncResponse from the server.
 * @returns Array of conflict mutation ID strings.
 */
export function extractConflictIds(
  response: SyncResponse,
): string[] {
  return response.conflicts.map((c) => c.mutationId);
}

/**
 * Convert all ProtocolEntities from changes to client Entities.
 *
 * Changes are ordered by serverSequence ascending (INV-1).
 *
 * @param response - The SyncResponse from the server.
 * @returns Array of client Entities derived from changes.
 */
export function extractEntitiesFromChanges<T>(
  response: SyncResponse,
): Entity<T>[] {
  return response.changes.map((change: Change) =>
    protocolEntityToClient<T>(change.entity),
  );
}

/**
 * Extract all entities from a SnapshotResponse, grouped by collection.
 *
 * @param response - The SnapshotResponse from the server.
 * @returns Map of collection name to array of client Entities.
 */
export function extractEntitiesFromSnapshot<T>(
  response: SnapshotResponse,
): Map<string, Entity<T>[]> {
  const result = new Map<string, Entity<T>[]>();
  for (const [collectionName, entities] of Object.entries(response.entities)) {
    result.set(
      collectionName,
      (entities as ProtocolEntity[]).map((e) =>
        protocolEntityToClient<T>(e),
      ),
    );
  }
  return result;
}
