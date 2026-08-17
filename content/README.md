# Conținut vertical slice 0.1

Acest folder conține primul dataset de implementare. Valorile economice și operaționale reprezintă un punct de pornire pentru balans, nu valori finale.

Comanda de verificare a pachetului:

```text
node tools/validate_pack.mjs
```

După inițializarea repository-ului, validarea trebuie integrată în `pnpm validate` și în testele Vitest. Schemele Zod din `contracts/src/schemas.ts` devin sursa principală pentru forma fișierelor.

