# Faza 2: Conținut, save și worker bridge

## Obiectiv

Conectează conținutul real al vertical slice-ului, mută simulatorul în Web Worker și implementează persistența.

## Scope

1. Content loader complet și cross-reference validation.
2. Cele 12 module, 8 task-uri și 10 research nodes.
3. Balancing config și milestone fixtures.
4. Worker protocol și `SimWorkerHost`.
5. `GameClientStore` și selectors fără UI final.
6. IndexedDB repository.
7. Autosave cu trei rotații.
8. Export și import envelope.
9. Checksum și input limits.
10. Save round-trip și migrare demonstrativă.
11. Playtest report local.

## Acceptance criteria

- worker și direct host produc același rezultat pentru același replay;
- toate content IDs și localization keys sunt valide;
- un save la jumătatea replay-ului continuă către același final hash;
- un import corupt este respins fără a afecta sloturile existente;
- migrarea rulează pe o copie;
- autosave păstrează exact trei rotații;
- worker recovery folosește ultimul checkpoint valid;
- bot-ul termină conținutul în intervalul urmărit sau produce un raport clar de balans.

## Livrabil

Simulatorul rulează în worker, folosește conținutul real și își păstrează progresul.

