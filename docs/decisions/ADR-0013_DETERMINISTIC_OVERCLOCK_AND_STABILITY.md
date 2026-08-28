# ADR-0013: Deterministic Overclock and Stability

Status: Accepted

Date: 27 August 2026

## Context

Phase 1 Task 8 adds deterministic module overclock settings and the inputs needed by later Useful
Compute without introducing stochastic outcomes, health, or a second simulation path. It extends the
accepted Power, thermal, Design Apply, and transactional contracts in ADR-0003 and ADR-0009 through
ADR-0012.

## Decisions

1. Each module definition declares required `overclockable: boolean`. Only
   `module-vacuum-tube-logic`, `module-arithmetic-unit`, and `module-control-unit` are true; an
   overclockable definition requires positive `baseComputeFlops`. Eligibility is content-defined, not
   inferred from category. All other modules remain Balanced at exactly `1.00` frequency and voltage.
2. Profiles are `eco`, `balanced`, `boost`, and `manual`. Eco is `0.80/0.90`, Balanced exactly
   `1.00/1.00`, and Boost `1.25/1.10`, from validated balancing content. All ratios and inclusive
   Manual bounds are finite and strictly positive, bounds are ordered, and presets are within Manual
   bounds. Presets stored on a module must exactly match their content values. Manual values are stored
   exactly as accepted: no quantization, rounding, or normalization.
3. Future command envelopes remain `SET_OVERCLOCK_PROFILE` and `SET_MANUAL_OVERCLOCK`. They reserve
   `OVERCLOCK_TARGET_INVALID`, `OVERCLOCK_UNSUPPORTED`, and
   `OVERCLOCK_UNAVAILABLE_IN_DESIGN_MODE`; empty or duplicate target arrays remain
   `INVALID_PAYLOAD`, unknown IDs use target-invalid, unsupported modules use unsupported, active
   Design Mode rejects changes, and out-of-range Manual values use `OVERCLOCK_OUT_OF_RANGE`. All
   targets validate before mutation, no command partially applies, target order does not affect state,
   FIFO remains authoritative, the last accepted same-tick command wins, exact-existing assignments
   are accepted no-ops, and commands consume no RNG.
4. The approved dynamic Power factor is `D = voltageRatio² × frequencyRatio`. For an overclockable,
   non-shutdown module after startup, `effectiveLoadPowerWatts = max(idlePowerWatts, loadPowerWatts ×
   D)` and `requestedPowerWatts = effectiveLoadPowerWatts / binEfficiencyRatio`. During startup,
   requested and minimum operational Power are `idlePowerWatts / binEfficiencyRatio`.
5. Approved heat is `effectiveFullLoadPowerWatts = max(idlePowerWatts, loadPowerWatts × D) /
   binEfficiencyRatio`; `powerRatio = clamp(deliveredPowerWatts / effectiveFullLoadPowerWatts, 0, 1)`;
   and `moduleHeatWatts = heatWattsAtLoad × D × powerRatio / binThermalRatio`. `D` is applied once.
   Thermal Factor does not alter requested Power or generated heat.
6. A lifecycle stage after the current-tick thermal update samples the maximum temperature of every
   occupied tile, using exact threshold comparisons. Thermal Factor is `1.00` through `normalMaxC`,
   linear `1.00→0.96` to `warningMaxC`, linear `0.96→0.65` to `criticalMaxC`, linear `0.65→0.10` to
   `shutdownC`, and zero at or above `shutdownC`. It is later Useful Compute input only: it does not
   modify requested frequency, Power, heat, or trigger same-tick recalc.
7. Deterministic stability first calculates `supportedFrequencyRatio = stableFrequencyRatio ×
   binStabilityRatio × voltageRatio` and `F = clamp(supportedFrequencyRatio / frequencyRatio, 0, 1)`.
   `T` is one at or below `warningMaxC`, `(shutdownC - temperatureC) / (shutdownC - warningMaxC)`
   strictly between warning and shutdown, and zero at or above shutdown. The authoritative rates are
   `retryRate = clamp(1 - F, 0, 1)`, `remainingAfterRetries = 1 - retryRate`, and
   `invalidSampleRate = clamp(remainingAfterRetries × (1 - T), 0, remainingAfterRetries)`.
   `stabilityFactor = clamp(1 - retryRate - invalidSampleRate, 0, 1)` is calculated from those stored
   rate values, so it is exactly equal to that expression (and mathematically equivalent to `F × T`).
   Task 8 calculates rates but executes no retry events or invalid samples; Task 9 owns their gameplay
   consumption. Task 8 consumes no RNG and adds no health, degradation, permanent damage, breakdown,
   silicon lottery, or random failures.
8. At sampled temperature `>= shutdownC`, thermal shutdown begins after the already-calculated Power
   and heat result; current-tick compute becomes zero and Power/heat become zero next tick. First
   shutdown sets `cooldownTicksRemaining` to content `cooldownTicks` without decrementing. Above
   `warningMaxC` cooldown holds; at or below it decrements once per real tick and never resets on a
   rise. At zero the module becomes offline and receives full startup ticks; normal Power startup
   begins next tick. `step(0)` and command-only processing do not run lifecycle.
9. `FacilityOverclockState` is authoritative, serializable, hashed, and future-Task-9-visible. Dirty
   means null layout/thermal revisions and an empty record. Calculated means both revisions match the
   facility and one stable-ID result per live module. Results carry requested profile/ratios, dynamic
   Power factor, sampled temperature, thermal/stability factors and rates, and thermal shutdown reason.
   Numeric values are finite and never negative zero; Power factor is positive; factors/rates are in
   `[0,1]`; rate sum is at most one; and stability is exactly one minus both rates. While shutdown,
   the exact override is Thermal Factor `0`, retry rate `0`, invalid-sample rate `1`, Stability Factor
   `0`, and thermal shutdown reason; recovery clears the override. Module settings remain authoritative.
10. Stored-result validation is structural only and preserves the Task 6.1 historical-result rule.
    Future generation validates against its exact calculation inputs; it must not reinterpret a
    committed historical result after inputs change. Private topology, indexes, scratch, and identities
    belong to a later per-`SimCore` runtime, never `GameState`.
11. Production applies settings through the existing FIFO command processor, then runs Power, heat
    generation, thermal update, and the single `apply-throttling-stability-and-shutdown` stage before
    later compute. The stage calculates every live-module result from the current thermal field and
    commits only `facility.modules` lifecycle changes and `facility.overclock`; it neither consumes
    RNG nor rewrites Power, thermal tiles, routes, or economy. This tick boundary preserves
    shutdown-crossing Power/heat as historical output and prevents same-tick reinterpretation.
12. `contentVersion` remains `0.1.0` and `saveVersion` remains `1`. This is a pre-release schema
    extension with no published save migration surface. No migration system is added.

## Consequences

- Task 8.1 establishes data, state, validation, localization, and documentation only.
- Task 8.2 owns pure overclock-aware Power and heat formulas.
- Task 8.3 owns thermal sampling, factors, stability, and lifecycle transitions.
- Task 8.4 integrates transactional profile/Manual commands, Design Apply dirtying, historical Power
  validation, and the production stage with a private per-`SimCore` ThermalTopology cache.
- Task 8.5 owns performance, complete verification, and final documentation.

## Performance closeout

Task 8.5 extends the audited Task 7 24 by 16 dense fixture without changing that fixture's work. The
private per-SimCore runtime reuses topology-bound calculation scratch only; it is never authoritative
or serialized. On the i7-2600 diagnostic host, the final warm full-facility Task 8 domain p95 was
`0.1828 ms` (500 samples) and the warm full production tick p95 was `3.2959 ms` (200 samples).
The unchanged permanent Task 7 thermal diagnostic remained below its `0.5 ms` pure-domain gate.

## Exclusions

Task 8 does not add Useful or Theoretical Compute, workload allocation, task/research/economy/
benchmark progression, random retry outcomes, health or failure systems, cooling or source/route
bandwidth scaling, thermal-protection disablement, events, UI, snapshots, heatmaps, workers, saves,
or Task 9.
