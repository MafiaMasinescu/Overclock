# ADR-0001: Fundația vertical slice-ului

Status: Accepted

Data: 15 august 2026

## Context

OVERCLOCK trebuie să ruleze în browser pe itch.io și ca aplicație Windows. Interfața combină dashboard-uri React cu o grilă animată. Jocul trebuie să rămână testabil și să ruleze pe Intel i7-2600 și GTX 1050.

## Decizii

1. Folosim TypeScript, Vite, React și PixiJS 8.
2. Simulatorul rămâne un pachet TypeScript fără dependențe de UI.
3. În producție, `SimHost` rulează simulatorul într-un Web Worker. Testele îl pot instanția direct.
4. Simulatorul folosește tick fix de 100 ms și RNG cu seed.
5. React comunică prin `GameClient`, nu prin importarea și mutarea directă a state-ului.
6. PixiJS primește un `GridViewModel` și trimite numai intenții de input către bridge.
7. Conținutul se află în JSON și este validat cu Zod.
8. Salvările folosesc IndexedDB, export JSON și migrații secvențiale.
9. Rezoluția principală este 1920 × 1080. 1280 × 720 este minimum funcțional.
10. Tauri 2 intră după stabilizarea browser release candidate-ului.

## Alternative respinse

### Simulator controlat de React

Ar produce re-randări greu de controlat și ar amesteca logica de joc cu prezentarea.

### React pentru fiecare tile

Ar crește costul DOM și ar complica efectele, heatmap-ul și zoom-ul.

### Simulare dependentă de frame rate

Ar produce rezultate diferite între calculatoare și ar face imposibil replay-ul determinist.

### Tauri din prima fază

Ar adăuga o suprafață de testare înainte ca jocul din browser să fie stabil.

## Consecințe

Contractele bridge-ului trebuie definite devreme. Mesajele către worker trebuie să fie serializabile. UI-ul poate afișa snapshot-uri întârziate cu maximum 100 până la 200 ms, fără să afecteze autoritatea simulatorului.

