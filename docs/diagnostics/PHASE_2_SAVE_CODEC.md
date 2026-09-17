# Phase 2 Save Codec Diagnostic

## Purpose

This diagnostic measures the Task 16 detached persistence codec. It does not measure IndexedDB,
Worker messaging, snapshot publication, import confirmation, or recovery. It never changes
authoritative simulation state and does not expose a production debug API.

Run it with:

```text
corepack pnpm performance:save-codec
```

The script uses the real `SavePayloadV1` schema, canonical serializer, SHA-256 adapter, and native
Compression Streams adapter. Fixture construction and warm-up are outside timed samples. `none` and
`gzip` compare the same canonical uncompressed payload bytes; compressed-byte identity is not a
cross-browser compatibility guarantee.

## Fixtures and limits

- **N**: initial valid Phase 1 state with eight valid subassembly Blueprint records and ordinary
  settings/statistics. The normal sample count is 200 with 20 warm-up iterations.
- **L**: valid Phase 1 state with 128 valid subassembly Blueprint records. It is report-only and uses
  50 samples with five warm-up iterations.
- **A**: adversarial inputs covered by unit tests: duplicate keys, malformed UTF-8/base64/gzip,
  noncanonical JSON, checksum mismatch, depth/node/count overflow, cancellation, accessor/prototype
  attacks, and synthetic schema-0 migration. Rejected input is not performance evidence.

The codec enforces an 8 MiB input envelope, 16 MiB uncompressed canonical payload, 6 MiB compressed
binary, depth/node/array/string/key limits, and one bounded decompression output. Production state is
not clipped to fit these export limits.

## Latest recorded run

Host: Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz, Windows `win32-x64`, Node `v24.11.0`, source build.
Native Web Crypto and Compression Streams were available. Values are milliseconds, p95 is the 95th
percentile, and the host is the documented Phase 1 target. Rerun after codec or runtime changes.

| Fixture | Operation | Bytes | Samples | Warm-up | Median | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N | encode none envelope | 29,460 | 200 | 20 | 16.0177 | 26.1752 | 47.0008 |
| N | encode gzip envelope | 3,881 | 200 | 20 | 15.5150 | 20.4015 | 24.5792 |
| N | decode none envelope | 29,460 | 200 | 20 | 21.1900 | 31.3344 | 173.0382 |
| N | decode gzip envelope | 3,881 | 200 | 20 | 20.9539 | 30.6409 | 40.4400 |
| N | SHA-256 payload | 25,303 | 200 | 20 | 0.3387 | 1.2175 | 7.2863 |
| N | gzip encode payload | 25,303 | 200 | 20 | 1.1417 | 3.1717 | 5.7471 |
| N | gzip decode payload | 25,303 | 200 | 20 | 0.7386 | 2.8124 | 15.0567 |
| L | encode none envelope | 100,412 | 50 | 5 | 35.6466 | 51.1146 | 52.2354 |
| L | encode gzip envelope | 5,749 | 50 | 5 | 40.7188 | 67.0517 | 71.2637 |
| L | decode none envelope | 100,412 | 50 | 5 | 51.8668 | 75.3601 | 114.0586 |
| L | decode gzip envelope | 5,749 | 50 | 5 | 52.3490 | 75.7712 | 102.6512 |
| L | SHA-256 payload | 88,095 | 50 | 5 | 0.7546 | 1.3050 | 1.8650 |
| L | gzip encode payload | 88,095 | 50 | 5 | 1.8740 | 3.4218 | 4.4363 |
| L | gzip decode payload | 88,095 | 50 | 5 | 1.3967 | 4.4388 | 14.9179 |

These figures are evidence for this host and source build, not a portable browser promise. The Phase 2
contract targets ordinary canonical encoding below 40 ms p95 and reports large-state paths separately;
IndexedDB/save/load budgets are owned by later tasks.

## Correctness gates

- Frozen canonical UTF-8 vectors:

  | Vector | Canonical bytes | SHA-256 |
  | --- | --- | --- |
  | ASCII | `{"language":"en","message":"Hello"}` | `390d9d62553ba7ba0b81240c8bad7e7c5b1789a793a92aa2b172185b14f03584` |
  | Romanian | `{"language":"ro","message":"Bună ziua"}` | `915fc2fab5059a256920251e4b6b46e45e95decd59630238b85201e4c748f6bd` |
  | Unicode | `{"emoji":"🧠","text":"μ-архитектура"}` | `2ca698e5029d6eb144a077e0fcee67be52942e1f36d1903bf62838d3ede1cf23` |

- Canonical bytes are sorted and stable, including Romanian and Unicode text.
- SHA-256 covers exactly the uncompressed canonical UTF-8 payload.
- Gzip round-trip returns the same canonical bytes; malformed and trailing streams are rejected.
- Duplicate JSON keys are rejected before semantic schema parsing.
- Checksum mismatch is rejected before payload parsing.
- Schema-0 migration is pure, sequential, bounded, and copy-only.
- Full-state admission remains a separate boundary that constructs a fresh production core and checks
  the persisted queue position.
- Existing Phase 1 state, RNG, Replay, Campaign, Blueprint, Benchmark, and compatibility vectors are
  preserved.
