# Contracte de pornire

Fișierele din `src/` definesc granițele inițiale. În Faza 0, ele se mută în repository-ul jocului și se împart în modulele indicate de TDD.

Contractele nu reprezintă implementarea simulatorului. Ele trebuie să compileze în TypeScript strict și să rămână serializabile la granița worker-ului.

Reguli:

1. Nu transforma `GameState` într-un store React.
2. Nu trimite obiecte PixiJS prin bridge.
3. Nu introduce text localizat în events sau command errors.
4. Dacă un câmp trebuie schimbat, actualizează TDD-ul sau propune un ADR.

