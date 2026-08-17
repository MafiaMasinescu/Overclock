# Template pentru task-uri Codex

```text
Task: <nume scurt>
Phase: <număr și nume>

Read first:
- AGENTS.md
- docs/TDD_VERTICAL_SLICE.md, sections <numere>
- docs/phases/<fișier>
- <contracte și fișiere relevante>

Goal:
<un singur rezultat observabil>

In scope:
1. <cerință>
2. <cerință>
3. <cerință>

Out of scope:
- <sistem apropiat care nu trebuie atins>
- <refactor sau polish amânat>

Acceptance criteria:
1. <comportament verificabil>
2. <test obligatoriu>
3. <buget sau invariantă>

Files allowed to change:
- <foldere sau fișiere>

Required verification:
- <comenzi>

Before editing, inspect the existing implementation and report any conflict with the TDD. If there is no blocking conflict, implement the task. Do not continue to another task.

In the final response, report the outcome, files changed, verification results, assumptions and remaining risks.
```

## Dimensiunea recomandată

Un task bun durează între 30 de minute și câteva ore de lucru agentic. El schimbă un singur comportament sau o singură graniță arhitecturală.

Exemple bune:

- implementează seeded RNG și testele de determinism;
- implementează command queue și atomic rejection;
- implementează thermal double buffer;
- implementează placement validation pentru footprint;
- implementează save round-trip V1.

Exemplu prea mare:

`Implementează întregul simulator, grid-ul și interfața.`

