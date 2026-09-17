export const PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const SYNTHETIC_V0_SCHEMA_VERSION = 0 as const;
export const PERSISTENCE_SAVE_VERSION = 1 as const;
export const PERSISTENCE_SIMULATOR_PROTOCOL_VERSION = 1 as const;

export const MAX_INPUT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_CANONICAL_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_COMPRESSED_BINARY_BYTES = 6 * 1024 * 1024;
export const MAX_ENVELOPE_DEPTH = 4;
export const MAX_PAYLOAD_DEPTH = 64;
export const MAX_VISITED_VALUES = 1_000_000;
export const MAX_ARRAY_ENTRIES = 100_000;
export const MAX_OBJECT_KEY_UTF16_UNITS = 256;
export const MAX_STRING_UTF16_UNITS = 16_384;
export const MAX_ORDINARY_SLOT_COUNT = 20;
export const MAX_REPORT_BYTES = 64 * 1024;
export const MAX_REPORT_COUNT = 20;
export const MAX_IMPORT_CANDIDATE_MINUTES = 5;

export const SLOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const HASH_16_PATTERN = /^[0-9a-f]{16}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const UTC_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
