# Task lifecycle performance diagnostic

Run the permanent diagnostic with:

```powershell
corepack pnpm performance:tasks
```

It extends the existing dense 24 by 16 production fixture rather than creating a parallel workload. The
fixture retains realistic Power delivery and contention, thermal nonuniformity, Overclock, Task 9 Useful
Compute, congested data routes, two active Tasks sharing a Compute module, a service, and a multi-phase
project. Dedicated copies exercise offer reconciliation, phase completion, deadline failure, a compliant
SLA boundary, completion reward accounting, Task command acceptance/allocation/hold/recovery/abandonment,
an interrupted SLA boundary, and fresh Task witness construction and validation.

The diagnostic measures 1,000 warm pure Task advances, 200 warm full production ticks, 500 two-Task
progress paths, and 200 samples for each listed transition and command path. Each direct path discards
100 JIT warm-ups. Fixture and core construction, held-state setup, and command enqueueing are outside the
timed interval; all measured samples remain in the median, p95, and maximum report. Output includes the
sample count, CPU, operating system, Node version, and build mode.

On the i7-2600 target, the hard gates are warm pure Task p95 below `0.20 ms` and warm complete production
tick p95 below `4 ms`; p95 below `3.7 ms` is preferred headroom. The diagnostic does not alter lifecycle,
reward, Power, Heat, or Compute semantics to meet a benchmark. It fails the process on a hard-gate miss.

Task 7 thermal, Task 8 Overclock, and Task 9 Compute retain their independent permanent diagnostics and
gates. The Task diagnostic validates the production sequence through Task advancement only; it does not
advance Research or Benchmarks and does not add workload-dependent Power, Heat, or congestion.
