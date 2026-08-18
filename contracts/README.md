# Contracte de pornire

Contractele furnizate au fost mutate în `src/sim/`, `src/app/game-client/`, `src/content/` și `src/save/`, conform granițelor indicate de TDD.

Contractele nu reprezintă implementarea simulatorului. Ele trebuie să compileze în TypeScript strict și să rămână serializabile la granița worker-ului.

Reguli:

1. Nu transforma `GameState` într-un store React.
2. Nu trimite obiecte PixiJS prin bridge.
3. Nu introduce text localizat în events sau command errors.
4. Dacă un câmp trebuie schimbat, actualizează TDD-ul sau propune un ADR.

Colecțiile din snapshot-uri sunt `readonly`, corecție necesară pentru limita immutable cerută explicit de TDD.
