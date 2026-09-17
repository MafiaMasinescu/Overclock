import { canonicalSerialize } from "../sim/replay/canonicalState.ts";
import type { SaveEnvelope, SavePayloadV1 } from "./contracts.ts";
import { cloneOwnedExternalData } from "./inputSafety.ts";
import { migrateSavePayload } from "./migrations.ts";
import { PersistenceError } from "./persistenceErrors.ts";
import {
  MAX_CANONICAL_PAYLOAD_BYTES,
  MAX_COMPRESSED_BINARY_BYTES,
  MAX_ENVELOPE_DEPTH,
  MAX_INPUT_FILE_BYTES,
  MAX_PAYLOAD_DEPTH,
  MAX_STRING_UTF16_UNITS,
} from "./persistenceLimits.ts";
import { parseSaveEnvelope, parseSavePayloadV1 } from "./schema.ts";

export interface SaveCodecAdapters {
  readonly sha256: (bytes: Uint8Array, signal?: AbortSignal) => Promise<string>;
  readonly gzipEncode: (bytes: Uint8Array, signal?: AbortSignal) => Promise<Uint8Array>;
  readonly gzipDecode: (
    bytes: Uint8Array,
    maxOutputBytes: number,
    signal?: AbortSignal,
  ) => Promise<Uint8Array>;
}

export interface EncodeSaveOptions {
  readonly compression?: "none" | "gzip";
  readonly adapters?: SaveCodecAdapters;
  readonly signal?: AbortSignal;
}

export interface EncodedSave {
  readonly envelope: SaveEnvelope;
  readonly bytes: Uint8Array;
  readonly canonicalPayload: string;
  readonly canonicalPayloadBytes: Uint8Array;
}

export interface DecodedSave {
  readonly payload: SavePayloadV1;
  readonly sourceSchemaVersion: number;
  readonly migrated: boolean;
  readonly canonicalPayload: string;
  readonly canonicalPayloadBytes: Uint8Array;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
}

interface JsonParserOptions {
  readonly maxDepth: number;
  readonly maxVisitedValues: number;
  readonly maxArrayEntries: number;
  readonly maxObjectKeyUnits: number;
  readonly maxStringUnits: number;
}

class StrictJsonParser {
  private index = 0;
  private visitedValues = 0;
  private readonly text: string;
  private readonly options: JsonParserOptions;

  constructor(text: string, options: JsonParserOptions) {
    this.text = text;
    this.options = options;
  }

  parse(): unknown {
    const value = this.parseValue(0, "$");
    this.skipWhitespace();
    if (this.index !== this.text.length) this.invalid("trailing bytes");
    return value;
  }

  private invalid(message: string): never {
    throw new PersistenceError("INVALID_FORMAT", `JSON at offset ${this.index}: ${message}.`);
  }

  private limit(message: string): never {
    throw new PersistenceError("LIMIT_EXCEEDED", `JSON at offset ${this.index}: ${message}.`);
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length) {
      const char = this.text.charCodeAt(this.index);
      if (char !== 0x20 && char !== 0x09 && char !== 0x0a && char !== 0x0d) return;
      this.index += 1;
    }
  }

  private parseValue(depth: number, path: string): unknown {
    if (depth > this.options.maxDepth) this.limit(`depth exceeds ${this.options.maxDepth}`);
    this.visitedValues += 1;
    if (this.visitedValues > this.options.maxVisitedValues)
      this.limit("visited-value count exceeded");
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === "{") return this.parseObject(depth, path);
    if (char === "[") return this.parseArray(depth, path);
    if (char === '"') return this.parseString(this.options.maxStringUnits, path);
    if (char === "t" && this.text.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (char === "f" && this.text.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (char === "n" && this.text.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseObject(depth: number, path: string): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.invalid("object key must be a string");
      const key = this.parseString(this.options.maxObjectKeyUnits, `${path}.<key>`);
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        this.invalid("prototype-pollution key");
      if (keys.has(key)) this.invalid(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.invalid("expected colon after object key");
      this.index += 1;
      const value = this.parseValue(depth + 1, `${path}.${key}`);
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.invalid("expected comma between object members");
      this.index += 1;
    }
    this.invalid("unterminated object");
  }

  private parseArray(depth: number, path: string): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      if (result.length >= this.options.maxArrayEntries)
        this.limit(`array exceeds ${this.options.maxArrayEntries} entries`);
      result.push(this.parseValue(depth + 1, `${path}[${result.length}]`));
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ",") this.invalid("expected comma between array values");
      this.index += 1;
    }
    this.invalid("unterminated array");
  }

  private parseString(maxUnits: number, path: string): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        const raw = this.text.slice(start, this.index);
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          this.invalid("malformed string escape");
        }
        if (typeof value !== "string") this.invalid("string token did not decode as a string");
        if (value.length > maxUnits) this.limit(`${path} exceeds ${maxUnits} UTF-16 code units`);
        for (let index = 0; index < value.length; index += 1) {
          const unit = value.charCodeAt(index);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff)
              this.invalid("string contains an unpaired surrogate");
            index += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff)
            this.invalid("string contains an unpaired surrogate");
        }
        return value;
      }
      if (code < 0x20) this.invalid("string contains an unescaped control character");
      if (code === 0x5c) {
        this.index += 1;
        const escape = this.text[this.index];
        if (escape === "u") {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.invalid("malformed unicode escape");
          this.index += 5;
        } else if (
          escape !== '"' &&
          escape !== "\\" &&
          escape !== "/" &&
          escape !== "b" &&
          escape !== "f" &&
          escape !== "n" &&
          escape !== "r" &&
          escape !== "t"
        ) {
          this.invalid("invalid string escape");
        } else {
          this.index += 1;
        }
      } else {
        this.index += 1;
      }
    }
    this.invalid("unterminated string");
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.index));
    if (match === null) this.invalid("expected JSON value");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.invalid("number is not finite");
    return value;
  }
}

const defaultJsonLimits: JsonParserOptions = {
  maxDepth: MAX_PAYLOAD_DEPTH,
  maxVisitedValues: 1_000_000,
  maxArrayEntries: 100_000,
  maxObjectKeyUnits: 256,
  maxStringUnits: MAX_STRING_UTF16_UNITS,
};

export function parseStrictJsonText(
  text: string,
  options: Partial<JsonParserOptions> = {},
): unknown {
  return new StrictJsonParser(text, { ...defaultJsonLimits, ...options }).parse();
}

export function parseStrictJsonBytes(
  bytes: Uint8Array,
  options: Partial<JsonParserOptions> = {},
): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PersistenceError("INVALID_FORMAT", "JSON bytes are not valid UTF-8.");
  }
  return parseStrictJsonText(text, options);
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PersistenceError("CANCELLED", "Save operation was cancelled.");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Char(index: number): string {
  const character = BASE64_ALPHABET[index];
  if (character === undefined) throw new Error("Invalid base64 index.");
  return character;
}

function encodeBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    result += base64Char(a >>> 2);
    result += base64Char(((a & 3) << 4) | (b >>> 4));
    result += remaining > 1 ? base64Char(((b & 15) << 2) | (c >>> 6)) : "=";
    result += remaining > 2 ? base64Char(c & 63) : "=";
  }
  return result;
}

function decodeBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new PersistenceError("INVALID_FORMAT", "Gzip payload is not canonical padded base64.");
  }
  if (value.length > Math.ceil(MAX_COMPRESSED_BINARY_BYTES / 3) * 4 + 4) {
    throw new PersistenceError(
      "LIMIT_EXCEEDED",
      "Gzip base64 payload exceeds the compressed byte limit.",
    );
  }
  const output = new Uint8Array(
    (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(value[index] ?? "");
    const b = BASE64_ALPHABET.indexOf(value[index + 1] ?? "");
    const cChar = value[index + 2] ?? "=";
    const dChar = value[index + 3] ?? "=";
    const c = cChar === "=" ? 0 : BASE64_ALPHABET.indexOf(cChar);
    const d = dChar === "=" ? 0 : BASE64_ALPHABET.indexOf(dChar);
    const isFinal = index + 4 === value.length;
    if (isFinal && cChar === "=" && (b & 15) !== 0)
      throw new PersistenceError("INVALID_FORMAT", "Gzip base64 has noncanonical padding bits.");
    if (isFinal && dChar === "=" && cChar !== "=" && (c & 3) !== 0)
      throw new PersistenceError("INVALID_FORMAT", "Gzip base64 has noncanonical padding bits.");
    if (outputIndex < output.length) output[outputIndex++] = (a << 2) | (b >>> 4);
    if (outputIndex < output.length) output[outputIndex++] = ((b & 15) << 4) | (c >>> 2);
    if (outputIndex < output.length) output[outputIndex++] = ((c & 3) << 6) | d;
  }
  if (output.length > MAX_COMPRESSED_BINARY_BYTES)
    throw new PersistenceError("LIMIT_EXCEEDED", "Gzip bytes exceed the compressed limit.");
  return output;
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let result = await reader.read();
    do {
      checkCancelled(signal);
      if (!result.done) {
        total += result.value.byteLength;
        if (total > limit)
          throw new PersistenceError("LIMIT_EXCEEDED", `Stream output exceeds ${limit} bytes.`);
        chunks.push(new Uint8Array(result.value));
        result = await reader.read();
      }
    } while (!result.done);
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function isWebCrypto(value: unknown): value is Crypto {
  if (value === null || typeof value !== "object") return false;
  const subtle: unknown = Reflect.get(value, "subtle") as unknown;
  return (
    subtle !== null &&
    typeof subtle === "object" &&
    typeof (Reflect.get(subtle, "digest") as unknown) === "function"
  );
}

export function createDefaultSaveCodecAdapters(): SaveCodecAdapters {
  return {
    async sha256(bytes, signal) {
      checkCancelled(signal);
      const cryptoApi: unknown = Reflect.get(globalThis, "crypto");
      if (!isWebCrypto(cryptoApi))
        throw new PersistenceError("UNSUPPORTED_COMPRESSION", "Web Crypto is unavailable.");
      const digest = await cryptoApi.subtle.digest("SHA-256", toArrayBuffer(bytes));
      checkCancelled(signal);
      return toHex(new Uint8Array(digest));
    },
    async gzipEncode(bytes, signal) {
      checkCancelled(signal);
      if (typeof CompressionStream === "undefined")
        throw new PersistenceError("UNSUPPORTED_COMPRESSION", "Gzip encoding is unavailable.");
      try {
        const transform = new CompressionStream("gzip") as unknown as TransformStream<
          Uint8Array,
          Uint8Array
        >;
        return await collectStream(
          byteStream(bytes).pipeThrough(transform),
          MAX_COMPRESSED_BINARY_BYTES,
          signal,
        );
      } catch (error: unknown) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError("UNSUPPORTED_COMPRESSION", "Gzip encoding failed.");
      }
    },
    async gzipDecode(bytes, maxOutputBytes, signal) {
      checkCancelled(signal);
      if (typeof DecompressionStream === "undefined")
        throw new PersistenceError("UNSUPPORTED_COMPRESSION", "Gzip decoding is unavailable.");
      try {
        const transform = new DecompressionStream("gzip") as unknown as TransformStream<
          Uint8Array,
          Uint8Array
        >;
        return await collectStream(
          byteStream(bytes).pipeThrough(transform),
          maxOutputBytes,
          signal,
        );
      } catch (error: unknown) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError("INVALID_FORMAT", "Gzip decoding failed.");
      }
    },
  };
}

function getAdapters(adapters: SaveCodecAdapters | undefined): SaveCodecAdapters {
  return adapters ?? createDefaultSaveCodecAdapters();
}

export async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  return getAdapters(undefined).sha256(bytes, signal);
}

export async function encodeSaveEnvelope(
  payload: SavePayloadV1,
  options: EncodeSaveOptions = {},
): Promise<EncodedSave> {
  const signal = options.signal;
  checkCancelled(signal);
  const ownedPayload = parseSavePayloadV1(cloneOwnedExternalData(payload));
  const canonicalPayload = canonicalSerialize(ownedPayload);
  const canonicalPayloadBytes = new TextEncoder().encode(canonicalPayload);
  if (canonicalPayloadBytes.length > MAX_CANONICAL_PAYLOAD_BYTES)
    throw new PersistenceError(
      "LIMIT_EXCEEDED",
      "Canonical save payload exceeds the uncompressed limit.",
    );
  const adapters = getAdapters(options.adapters);
  const checksum = await adapters.sha256(canonicalPayloadBytes, signal);
  const compression = options.compression ?? "none";
  let encodedPayload: string;
  if (compression === "none") {
    encodedPayload = canonicalPayload;
  } else {
    const compressed = await adapters.gzipEncode(canonicalPayloadBytes, signal);
    if (compressed.length > MAX_COMPRESSED_BINARY_BYTES)
      throw new PersistenceError("LIMIT_EXCEEDED", "Gzip payload exceeds the compressed limit.");
    encodedPayload = encodeBase64(compressed);
  }
  const envelope: SaveEnvelope = {
    format: "overclock-save",
    compression,
    checksumAlgorithm: "sha-256",
    checksum,
    payload: encodedPayload,
  };
  const bytes = new TextEncoder().encode(canonicalSerialize(envelope));
  if (bytes.length > MAX_INPUT_FILE_BYTES)
    throw new PersistenceError("LIMIT_EXCEEDED", "Save envelope exceeds the input file limit.");
  return { envelope, bytes, canonicalPayload, canonicalPayloadBytes };
}

export async function decodeSaveEnvelope(
  input: Uint8Array,
  options: { readonly adapters?: SaveCodecAdapters; readonly signal?: AbortSignal } = {},
): Promise<DecodedSave> {
  const signal = options.signal;
  checkCancelled(signal);
  const bytes = new Uint8Array(input);
  if (bytes.length > MAX_INPUT_FILE_BYTES)
    throw new PersistenceError("LIMIT_EXCEEDED", "Save file exceeds the input limit.");
  const envelopeValue = parseStrictJsonBytes(bytes, {
    maxDepth: MAX_ENVELOPE_DEPTH,
    maxStringUnits: MAX_INPUT_FILE_BYTES,
  });
  const envelope = parseSaveEnvelope(envelopeValue);
  const adapters = getAdapters(options.adapters);
  let canonicalPayloadBytes: Uint8Array;
  if (envelope.compression === "none") {
    canonicalPayloadBytes = new TextEncoder().encode(envelope.payload);
    if (canonicalPayloadBytes.length > MAX_CANONICAL_PAYLOAD_BYTES)
      throw new PersistenceError("LIMIT_EXCEEDED", "Uncompressed payload exceeds the limit.");
  } else {
    const compressed = decodeBase64(envelope.payload);
    canonicalPayloadBytes = await adapters.gzipDecode(
      compressed,
      MAX_CANONICAL_PAYLOAD_BYTES,
      signal,
    );
  }
  checkCancelled(signal);
  const actualChecksum = await adapters.sha256(canonicalPayloadBytes, signal);
  if (actualChecksum !== envelope.checksum)
    throw new PersistenceError("CHECKSUM_MISMATCH", "Save payload checksum does not match.");
  const parsedPayload = parseStrictJsonBytes(canonicalPayloadBytes, {
    maxDepth: MAX_PAYLOAD_DEPTH,
  });
  const canonicalPayload = canonicalSerialize(parsedPayload);
  const recanonicalizedBytes = new TextEncoder().encode(canonicalPayload);
  if (!equalBytes(recanonicalizedBytes, canonicalPayloadBytes))
    throw new PersistenceError("INVALID_FORMAT", "Save payload is not canonical JSON.");
  const sourceSchemaVersion =
    parsedPayload !== null && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)
      ? Number(Reflect.get(parsedPayload, "schemaVersion"))
      : Number.NaN;
  if (!Number.isSafeInteger(sourceSchemaVersion))
    throw new PersistenceError(
      "UNSUPPORTED_VERSION",
      "Save payload schema version is unavailable.",
    );
  const payload = migrateSavePayload(parsedPayload);
  return {
    payload,
    sourceSchemaVersion,
    migrated: sourceSchemaVersion !== payload.schemaVersion,
    canonicalPayload,
    canonicalPayloadBytes,
    compressedBytes:
      envelope.compression === "none"
        ? canonicalPayloadBytes.length
        : decodeBase64(envelope.payload).length,
    uncompressedBytes: canonicalPayloadBytes.length,
  };
}
