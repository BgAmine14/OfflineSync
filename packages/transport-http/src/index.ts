/**
 * @offlinesync/transport-http
 *
 * HTTP implementation of the SyncTransport interface.
 * Uses the global fetch API (Node 18+, Deno, Bun, browsers).
 */

export { HttpSyncTransport, SyncTransportError } from './http-transport.js';
export type { HttpTransportOptions } from './http-transport.js';
export type { SyncTransport, VersionInfo } from './sync-transport.js';
