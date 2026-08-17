# Faza 5: Browser Release Candidate

## Obiectiv

Pregătește build-ul pentru playtest extern și itch.io.

## Scope

1. Profilare pe hardware-ul țintă.
2. Reduced Effects și reduced motion.
3. Browser compatibility.
4. Accessibility și keyboard pass.
5. Responsive visual regression.
6. Save migration rehearsal.
7. Error recovery și diagnostic report.
8. Production asset optimization.
9. Build static cu `index.html` la rădăcină.
10. Itch.io test upload checklist.
11. Playtest questionnaire și issue template.

## Acceptance criteria

- `pnpm validate` trece din checkout curat;
- Playwright trece pe browser-ele stabilite;
- build-ul static rulează prin server HTTP și în iframe;
- 1920 × 1080 atinge ținta de performanță pe GTX 1050;
- 1280 × 720 rămâne complet funcțional;
- save-urile RC pot fi migrate într-un build de test ulterior;
- nu există chei de localizare lipsă;
- nu există request-uri externe neintenționate;
- arhiva itch.io are `index.html` la rădăcină.

## După aprobarea RC

Integrarea Tauri 2 devine fază separată. Nu o amesteca cu bugfix-urile browser RC.

