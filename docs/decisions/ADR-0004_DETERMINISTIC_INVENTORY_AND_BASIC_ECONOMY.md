# ADR-0004: Deterministic Inventory Transactions and Basic Economy

Status: Accepted

Date: 18 August 2026

## Context

Phase 1 Task 4 adds the first production gameplay commands: `BUY_MODULE` and
`SELL_INVENTORY_ITEM`. The public `EconomyState` contract already stores USD values as `number`,
while deterministic replay requires transaction rounding, overflow behavior, and credit boundaries
to be identical on every run.

The TDD's earlier two-decimal transaction note did not preserve the required low per-tick energy
cost vector. This ADR is the compatibility decision for authoritative Task 4 money, and the
authoritative Markdown TDD now records the same rule without changing the public state shape.

ADR-0002 originally allowed registered handlers to accept by returning `void`, treated an absent
handler as `COMMAND_NOT_AVAILABLE`, and treated every thrown handler exception as fatal. Gameplay
validation additionally needs a supported recoverable rejection path that preserves candidate-state
isolation.

## Decisions

1. Public `EconomyState` and `InventoryStack` monetary fields remain USD `number` values. No public
   cent, microdollar, decimal-class, or `bigint` state is introduced.
2. Authoritative monetary boundaries use integer microdollars internally, where
   `1 USD = 1,000,000 microdollars`. Conversion from USD rounds half away from zero. Conversion back
   divides the checked safe integer by 1,000,000 and canonicalizes zero. No epsilon adjustment is an
   accounting rule. Ordinary UI cash presentation uses two decimal places; expanded statistics may
   expose sub-cent values. UI formatting never re-enters the simulator.
3. Money helpers reject non-finite values, unsafe integers, and overflowing addition,
   multiplication, division, scaling, energy, or transaction results. All Task 4 authoritative
   money mutations are quantized to six USD decimal places.
4. A command handler may continue returning `void` to accept, or return a typed
   `CommandHandlerRejection` for a recoverable rejection. A returned rejection discards the
   candidate state and candidate RNG and produces a normal rejected `CommandResult`. An absent
   handler remains `COMMAND_NOT_AVAILABLE`. A thrown handler exception remains the fatal
   `SIMULATOR_INVARIANT_VIOLATION` defined by ADR-0002.
5. `createInventoryEconomyCommandHandlers(content)` is the production registration factory. It
   receives the validated, deeply immutable `ContentBundle` and returns only `BUY_MODULE` and
   `SELL_INVENTORY_ITEM` handlers for the existing `CommandProcessor`/`SimCore` registry. It does
   not import raw JSON or create another execution path.
6. Both transaction quantities must be positive safe integers. Admission rejects zero, negative,
   fractional, and unsafe quantities. A known command whose later transaction arithmetic overflows
   rejects with `INVALID_PAYLOAD`.
7. A purchase resolves its module from the injected current content and requires every
   `unlockResearchIds` entry to have status `completed`. Unknown definitions reject with
   `INVALID_PAYLOAD`; missing research rejects with `RESEARCH_REQUIRED`.
8. Purchase unit price is `quantize(module.priceUsd)`. Purchase cost is
   `unitPriceMicrodollars * quantity`, checked as a safe integer. The transaction is allowed when
   `cashAfterMicrodollars >= -creditLimitMicrodollars`, including exact zero-cash and exact credit
   boundaries. A lower result rejects with `INSUFFICIENT_CASH`; purchases are never partial.
9. A new purchase stack records the quantized current unit price as acquisition cost. An existing
   stack uses
   `(oldAverageMicrodollars * oldQuantity + purchaseCostMicrodollars) / newQuantity`, rounded to the
   nearest microdollar half away from zero. Quantity and every intermediate are safe-integer
   checked. Buying changes inventory, cash, and `totalExpenseUsd` only; it never places a facility
   module.
10. A sale resolves current module content but does not require research to remain unlocked. A
    missing or insufficient inventory stack rejects with `INSUFFICIENT_INVENTORY`; installed
    facility modules are not considered or changed.
11. Sale unit value is `quantize(module.priceUsd * module.salvageRatio)`. Proceeds are the quantized
    unit value in microdollars multiplied by quantity, so selling a group equals selling each unit
    individually. Acquisition cost does not affect proceeds. Partial sales preserve it; a zero
    remainder removes the stack. Sales are never partial.
12. Purchases add their complete cost to `totalExpenseUsd`; sales add their complete proceeds to
    `totalIncomeUsd`. These fields are lifetime cumulative flows. `lastTickExpenseUsd` and
    `lastTickIncomeUsd` remain unchanged because they are reserved for periodic flows calculated by
    future tick systems, not discrete commands.
13. The pure `calculateEnergyCostUsd(powerWatts, simulatedSeconds, energyPriceUsdPerKwh)` helper
    computes `powerWatts * simulatedSeconds / 3,600,000 * energyPriceUsdPerKwh`, validates finite
    nonnegative inputs and intermediate values, and quantizes only the final cost to microdollars.
    Task 4 registers no economy tick system and performs no automatic energy deduction.
14. Focused authoritative validation requires safe, finite, microdollar-aligned cash; finite,
    nonnegative, safely convertible credit; finite, nonnegative, safe, aligned lifetime totals;
    positive safe stack quantities; matching stack keys and definition IDs; and finite,
    nonnegative, safe, aligned acquisition costs. Zero-quantity stacks do not exist.
15. Transaction handlers consume no RNG, do not advance ticks, use no wall clock, and retain FIFO,
    processing-time `expectedTick`, candidate isolation, and atomic commit or rejection semantics.
16. The temporary initial credit limit remains `0`. Task 4 adds no credit content value or financial
    game-over behavior.

## Consequences

- Replay and save compatibility now includes the six-decimal money boundary and the order of unit
  quantization versus quantity multiplication.
- Existing `void` test handlers remain source-compatible. Consumers that dispatch handlers directly
  must handle the added recoverable outcome.
- Initial cash and starting-stack acquisition costs are normalized to microdollars; zero-quantity
  starting inventory entries are omitted.
- Current 35 percent content salvage ratios remain unchanged.
- Energy charging, periodic income/expense reset, financing, insolvency, and all later economy
  systems remain deferred.

## Rejected alternatives

- Two-decimal cash rounding loses valid sub-cent energy costs and conflicts with the fixed
  `0.000028 USD` vector.
- Floating-point epsilon patches make accounting depend on an undocumented tolerance instead of a
  published unit and rounding boundary.
- Public cent or `bigint` state would break the existing serializable `EconomyState` API.
- Multiplying first and quantizing grouped sale proceeds can differ from individual sales.
- Throwing recoverable gameplay failures would conflict with ADR-0002's fatal handler-exception
  contract.
- Using acquisition cost for salvage would ignore current content pricing and the canonical salvage
  ratio.
