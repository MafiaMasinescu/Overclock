export const PERSISTENCE_ERROR_CODES = [
  "INVALID_FORMAT",
  "LIMIT_EXCEEDED",
  "CHECKSUM_MISMATCH",
  "UNSUPPORTED_VERSION",
  "UNSUPPORTED_COMPRESSION",
  "INCOMPATIBLE_CONTENT",
  "INVALID_STATE",
  "MIGRATION_FAILED",
  "STALE_REVISION",
  "STALE_WRITER",
  "SLOT_BUSY",
  "SLOT_ACTIVE",
  "QUOTA_EXCEEDED",
  "STORAGE_ABORTED",
  "UPGRADE_BLOCKED",
  "TOKEN_EXPIRED",
  "TOKEN_CONSUMED",
  "CANCELLED",
] as const;

export type PersistenceErrorCode = (typeof PERSISTENCE_ERROR_CODES)[number];

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly path: string | null;

  constructor(code: PersistenceErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.path = path;
  }
}

export function persistenceError(
  code: PersistenceErrorCode,
  message: string,
  path: string | null = null,
): PersistenceError {
  return new PersistenceError(code, message, path);
}
