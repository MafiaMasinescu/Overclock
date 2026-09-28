# Phase 3 entry evidence

Status: ENTRY READY for Task 22.1 only (2026-09-27).

## Repaired base

- `PHASE3_BASE` / `TASK_22_BASE`: `f982c7dbec5f7f444988eb7130b1db3ee7803dfb`
- Parent: `d63a34c7b030f748a7eac141bf790eb6e4228f7d`
- `HEAD`, `origin/main` and the configured remote `main` agree; ahead/behind is `0/0`.
- The worktree was clean before Task 22 edits.
- The base is a descendant of the Phase 2 repair parent and includes the accepted F1/F2
  repair and complete reclosure evidence.

## Entry evidence

The bounded entry audit reran the repaired save/Worker/repository cases and real Chromium
cases, then reran the complete unit/determinism, validation, build and compatibility gates.
The Chromium matrix was `16/16`; complete tests were `88` unit files / `1531` tests and
`16` determinism files / `25` tests. Validation and build passed (`861` modules). The
trailing-lone-surrogate save admission and corrupt-autosave Continue/repeated-autosave
repair probes passed on the repaired base.

The documented performance exceptions remain historical host evidence: this audit host is
an Intel i7-2600 with 15.98 GiB RAM and GTX1050, not the 8 GiB target certification host.
They are not silently converted into target certification.

## Adopted ownership boundary

The supplied Phase 3 contract is copied unchanged into the repository contract path. ADR
0030 records the adopted SimCore → Worker → GameClient → Build-controller ownership split.
Later renderer, routing search and visible Build controls remain planned until their named
subtasks; they are not implied by this entry decision.

This entry document is evidence for beginning Task 22.1. It is not CP22, a Phase 3 closure,
or permission to begin Phase 4.
