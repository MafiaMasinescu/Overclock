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

- **N**: the audited 24 by 16 production fixture with more than 75 percent occupied tiles, mixed
  footprints and rotations, real Power routes, nonuniform Thermal state, Overclock and Compute work,
  two active Tasks, active Research and eight valid subassembly Blueprint records. The normal sample
  count is 200 with 20 warm-up iterations.
- **L**: the same production fixture with 128 valid Blueprint records. It is report-only and uses 50
  samples with five warm-up iterations.
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
| N | full payload admission | 170,857 | 200 | 20 | 76.6047 | 103.0473 | 127.6817 |
| N | canonical payload encode | 170,857 | 200 | 20 | 11.7548 | 15.4737 | 22.2015 |
| N | admission + none envelope | 191,352 | 200 | 20 | 89.9750 | 107.4067 | 185.2011 |
| N | admission + gzip envelope | 19,329 | 200 | 20 | 92.9978 | 116.6530 | 222.2400 |
| N | decode + admission, none | 191,352 | 200 | 20 | 133.3105 | 158.3035 | 183.7240 |
| N | decode + admission, gzip | 19,329 | 200 | 20 | 135.8220 | 154.6503 | 170.4992 |
| N | SHA-256 payload | 170,857 | 200 | 20 | 1.0285 | 1.6198 | 4.4904 |
| N | gzip encode payload | 170,857 | 200 | 20 | 2.9310 | 4.3068 | 6.5706 |
| N | gzip decode payload | 170,857 | 200 | 20 | 3.7269 | 7.9984 | 25.0728 |
| L | full payload admission | 233,649 | 50 | 5 | 112.1313 | 124.5379 | 126.8600 |
| L | canonical payload encode | 233,649 | 50 | 5 | 16.3891 | 22.0584 | 26.5096 |
| L | admission + none envelope | 262,304 | 50 | 5 | 130.4707 | 165.6058 | 169.5585 |
| L | admission + gzip envelope | 21,213 | 50 | 5 | 133.3447 | 153.7461 | 169.5230 |
| L | decode + admission, none | 262,304 | 50 | 5 | 189.6114 | 221.4566 | 257.8033 |
| L | decode + admission, gzip | 21,213 | 50 | 5 | 192.1485 | 230.4273 | 245.2497 |
| L | SHA-256 payload | 233,649 | 50 | 5 | 1.3233 | 1.9222 | 2.1188 |
| L | gzip encode payload | 233,649 | 50 | 5 | 3.1348 | 5.1323 | 11.3084 |
| L | gzip decode payload | 233,649 | 50 | 5 | 4.1041 | 5.9679 | 13.7941 |

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
- Gzip round-trip returns the same canonical bytes; malformed, trailing and concatenated-member
  streams are rejected.
- Duplicate JSON keys are rejected before semantic schema parsing.
- Checksum mismatch is rejected before payload parsing.
- Schema-0 migration is pure, sequential, bounded, and copy-only.
- Public encode and decode compose full-state admission, validated content fingerprinting, execution
  state-hash verification, fresh production-core construction and persisted queue-position checks.
- Real Chromium round-trips both encodings through native Web Crypto and Compression Streams.
- Existing Phase 1 state, RNG, Replay, Campaign, Blueprint, Benchmark, and compatibility vectors are
  preserved.

## Task 21 N/L rerun

Updated 2026-09-25. Command: `corepack pnpm performance:save-codec`. The fixed N cohort used
200 samples / 20 warm-ups; L used 50 / 5. Values are median / p95 / maximum milliseconds.
Payload admission measures full-state admission, not only the byte codec.

| Fixture | Operation | Bytes | Median | p95 | Maximum |
|---|---|---:|---:|---:|---:|
| N | Full-payload admission | 170,857 | 66.7144 | 85.4828 | 205.8397 |
| N | Canonical-payload encode | 170,857 | 9.4866 | 14.1549 | 27.0609 |
| N | Admit + encode, none | 191,352 | 80.6576 | 100.9819 | 125.9706 |
| N | Admit + encode, gzip | 19,329 | 80.6001 | 122.1400 | 264.4370 |
| N | Decode, none | 191,352 | 115.2360 | 158.6305 | 288.2154 |
| N | Decode, gzip | 19,329 | 123.6632 | 151.0654 | 191.5470 |
| N | SHA-256 | 170,857 | 0.9866 | 1.9537 | 8.8912 |
| N | Gzip encode | 170,857 | 2.6481 | 5.1422 | 10.7922 |
| N | Gzip decode | 170,857 | 3.5413 | 8.0198 | 17.9264 |
| L | Full-payload admission | 233,649 | 106.8312 | 143.7114 | 148.5115 |
| L | Canonical-payload encode | 233,649 | 14.7808 | 26.1054 | 113.4913 |
| L | Admit + encode, none | 262,304 | 113.2923 | 140.8363 | 142.7908 |
| L | Admit + encode, gzip | 21,213 | 120.9756 | 156.9610 | 188.5124 |
| L | Decode, none | 262,304 | 168.6320 | 211.8899 | 245.7402 |
| L | Decode, gzip | 21,213 | 169.0799 | 206.9557 | 318.7779 |
| L | SHA-256 | 233,649 | 1.2506 | 1.8810 | 4.0868 |
| L | Gzip encode | 233,649 | 3.0633 | 6.3464 | 7.2292 |
| L | Gzip decode | 233,649 | 3.9096 | 6.2923 | 18.5255 |

The command exited successfully. Host identity and the 16 GiB versus 8 GiB classification are in
`PHASE_2_TASK_21.md`; these figures do not certify the exact contract target.
