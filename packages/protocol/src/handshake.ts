/**
 * Handshake and version negotiation types.
 *
 * Before any sync operation, the client and server negotiate
 * the protocol version. This ensures backward compatibility
 * as the protocol evolves.
 */

/**
 * Format: "major.minor" (e.g., "1.0", "1.1").
 * Major version indicates breaking changes.
 * Minor version indicates backward-compatible additions.
 */
export type ProtocolVersion = string;

/**
 * Current protocol version implemented by this package.
 */
export const CURRENT_PROTOCOL_VERSION: ProtocolVersion = '1.0';

/**
 * Response to a version negotiation request.
 * Lists all protocol versions the server supports.
 */
export interface VersionNegotiationResponse {
  /** All protocol versions the server currently supports */
  supportedVersions: ProtocolVersion[];
}

/**
 * Selects the highest mutually supported protocol version.
 *
 * The client calls this with the server's supported versions
 * and its own supported versions. The function returns the
 * highest version that appears in both lists.
 *
 * Returns `undefined` if no common version exists, meaning
 * the client cannot communicate with this server.
 *
 * @param clientVersions - Versions the client supports
 * @param serverVersions - Versions the server supports
 * @returns The highest common version, or undefined if none exists
 */
export function negotiateVersion(
  clientVersions: readonly ProtocolVersion[],
  serverVersions: readonly ProtocolVersion[],
): ProtocolVersion | undefined {
  const serverSet = new Set(serverVersions);
  const commonVersions = clientVersions.filter((v) => serverSet.has(v));
  if (commonVersions.length === 0) {
    return undefined;
  }

  // Sort by semver: compare major first, then minor
  commonVersions.sort((a, b) => {
    const [aMajor, aMinor] = parseVersion(a);
    const [bMajor, bMinor] = parseVersion(b);
    if (aMajor !== bMajor) {
      return aMajor - bMajor;
    }
    return aMinor - bMinor;
  });

  return commonVersions[commonVersions.length - 1];
}

/**
 * Parses a "major.minor" version string into its numeric components.
 *
 * @param version - Version string in "major.minor" format
 * @returns Tuple of [major, minor]
 * @throws {Error} If the version string is malformed
 */
export function parseVersion(version: string): [number, number] {
  const parts = version.split('.');
  if (parts.length !== 2) {
    throw new Error(`Invalid protocol version format: "${version}"`);
  }
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error(`Invalid protocol version format: "${version}"`);
  }
  if (major < 0 || minor < 0) {
    throw new Error(`Invalid protocol version format: "${version}"`);
  }
  return [major, minor];
}