# OVERCLOCK

## Game Design Document

Versiunea 1.1, 15 august 2026

Document de direcție pentru campania completă, vertical slice și arhitectura tehnică.

Platformă inițială: browser desktop și Windows.

Model comercial inițial: gratuit, fără reclame și fără cont obligatoriu.

Echipă: un dezvoltator, asistat de instrumente AI.

[[PAGEBREAK]]

# 1. Rezumat executiv

OVERCLOCK este un joc incremental de strategie și inginerie. Jucătorul conduce o companie de calcul din 1946 până la limitele clasice și cuantice ale tehnologiei. Satisfacția principală vine din progresul numeric. Progresul nu apare prin simpla cumpărare a unui generator. Jucătorul construiește sisteme, rezolvă blocaje, execută proiecte, investește în cercetare și schimbă arhitectura companiei.

Jocul combină trei niveluri de control:

1. Micromanagement la începutul unei tehnologii noi. Jucătorul proiectează componente, conexiuni și răcire.
2. Management de sistem după ce configurația funcționează. Jucătorul salvează blueprint-uri, replică servere și distribuie workload-uri.
3. Macromanagement în etapele târzii. Jucătorul coordonează rack-uri, facilități, proiecte, cercetare și investitori.

Campania principală trebuie să dureze între 15 și 20 de ore. Finalizarea conținutului opțional disponibil într-un singur playthrough trebuie să ducă durata la aproximativ 20 până la 25 de ore. Ramurile exclusive, challenge-urile și alte arhitecturi se explorează în run-uri ulterioare.

Prima versiune publică nu încearcă să implementeze întreaga istorie. Ea conține o singură generație, o grilă, nucleul economic, task-uri, temperatură, overclock, research și un benchmark final. Scopul ei este să demonstreze că bucla principală rămâne interesantă timp de 45 până la 75 de minute.

# 2. Deciziile finale de direcție

| Domeniu | Decizie finală |
|---|---|
| Gen | Hibrid între incremental și strategie. |
| Ritm | Predominant activ. O pauză fără decizie utilă nu trebuie să depășească în mod normal 2 până la 3 minute, cu 5 minute ca limită rară. |
| Pilon extern | Prestige Tree este o referință pentru ritm și succesiunea constantă de obiective. Game Dev Tree rămâne o sugestie, nu un pilon obligatoriu. |
| Jucător | Controlează o companie care traversează mai multe generații de angajați și conducători. |
| Start | Prolog în 1946, cu human computers și primele calculatoare electronice. Tranzistorul din 1947 devine primul breakthrough major. |
| Grilă | Grilă pătrată, ierarhică, cu niveluri separate pentru sistem, rack și facility. |
| Task-uri active | Două la început. Numărul crește prin research și Fundamental Insights. |
| Resurse permanente în header | Cash, Useful Compute, Power și Temperature. Restul apar în panoul Telemetry. |
| Overclock | Eco, Balanced, Boost și Manual. Frecvența și tensiunea pot fi controlate. |
| Damage permanent | Exclus din campania normală. Intră în Reliability Challenge și moduri speciale. |
| Meta-currency | Fundamental Insights. |
| Resursa finală | Singularity Data. Cantitatea produsă determină recompensa de Fundamental Insights. |
| Lansare | HTML5 pe itch.io și aplicație Windows instalabilă, creată din aceeași bază de cod. |
| Limbă | Română și engleză de la începutul producției de conținut. |

# 3. Identitatea jocului

## 3.1 Pitch

OVERCLOCK este un joc incremental de strategie care te poartă prin istoria calculatoarelor, de la human computers și tuburi electronice până la chiplet-uri, materiale post-silicon și sisteme cuantice hibride. Construiești arhitecturi la scară mică, le salvezi ca blueprint-uri, le multiplici în facilități și optimizezi permanent bani, compute, energie, temperatură, memorie și timp.

## 3.2 Fantezia jucătorului

Jucătorul trebuie să simtă că a construit o companie de calcul care a depășit limite tehnice reale. Când un număr crește, jucătorul trebuie să poată indica decizia care a produs creșterea. Poate fi un layout mai bun, un algoritm nou, o tranziție tehnologică, un contract potrivit sau un profil de overclock aplicat la momentul corect.

## 3.3 Ton

Tonul combină seriozitatea tehnică și umorul controlat. Istoria, formulele și explicațiile rămân clare. Numele companiilor și unele evenimente pot folosi parodii ușor de recunoscut. Umorul nu trebuie să transforme tehnologia într-o absurditate.

## 3.4 Public țintă

Jocul se adresează unui jucător care știe noțiuni de bază despre procesoare, memorie și temperatură. Tutorialul explică FLOPS, TDP, bandwidth, latency și coherence. Wiki-ul oferă explicații mai profunde. Jocul nu simplifică termenii până la pierderea sensului tehnic.

# 4. Pilonii de design

## 4.1 Progres numeric cu explicație

Numerele cresc constant, dar fiecare creștere are o cauză vizibilă. Inspectorul arată ce limitează performanța și ce multiplicatori se aplică.

## 4.2 Optimizare cu compromisuri

Nu există o configurație perfectă pentru toate task-urile. Densitatea crește compute-ul, dar poate crește temperatura. GPU-ul accelerează paralelismul, dar cere bandwidth și răcire. O arhitectură eficientă energetic poate pierde viteză sau compatibilitate.

## 4.3 Micromanagement care se transformă în automatizare

Jucătorul proiectează manual o tehnologie nouă. După ce o înțelege, salvează blueprint-ul, cumpără prebuild-uri și automatizează rutarea, cooling-ul și distribuția de task-uri. Jocul nu cere repetarea aceleiași operații de zeci de ori.

## 4.4 Istorie jucabilă

Fiecare capitol introduce tehnologii, workload-uri și probleme specifice perioadei. Explicațiile istorice susțin gameplay-ul. Ele nu îl înlocuiesc.

## 4.5 Activitate continuă

În orice moment trebuie să existe cel puțin una dintre următoarele acțiuni:

- un upgrade apropiat;
- un bottleneck de investigat;
- un task de alocat;
- un experiment de configurat;
- un blueprint de îmbunătățit;
- un challenge disponibil;
- un eveniment de companie;
- o decizie privind contractele sau finanțarea.

## 4.6 Interacțiunea cu nucleul

Click-ul repetat pe nucleu nu produce Cash sau Compute. Nucleul selectat oferă Diagnostic Pulse, cu cooldown de aproximativ 30 de secunde. Pulsul evidențiază pentru câteva secunde traseele active, cel mai mare bottleneck și pierderea principală de eficiență. În prolog poate exista o scurtă mecanică manuală de calcul, dar ea este automatizată definitiv după tutorial.

# 5. Ce nu va fi jocul

- Nu va fi un clicker în care apăsarea repetată produce resursa principală.
- Nu va cere cooling manual repetitiv.
- Nu va obliga jucătorul să urmărească ore întregi bare de progres.
- Nu va transforma fiecare generație într-o reconstrucție manuală identică.
- Nu va folosi multiplicatori permanenți foarte mari care distrug balansul.
- Nu va prezenta quantum ca un înlocuitor simplu pentru CPU și GPU.
- Nu va amesteca o cameră de servere, o placă de bază și interiorul unui cip pe aceeași scară vizuală.
- Nu va ascunde formulele importante sau cauza throttling-ului.

# 6. Structura unui playthrough

## 6.1 Campania istorică

Primul playthrough reprezintă campania completă. Timpul trece automat. Compania poate avansa înaintea istoriei sau poate rămâne în urmă. Un indicator Competitor Gap compară tehnologia companiei cu anul curent.

Rămânerea în urmă produce efecte diferite:

- compania privată primește contracte mai slabe și costuri mai mari de recrutare;
- compania publică pierde încrederea investitorilor, valoare și acces la capital;
- unele proiecte istorice expiră;
- competitorii pot ocupa temporar anumite piețe.

## 6.2 După campanie

După producerea Singularity Data, jucătorul vede ecranul de final. El poate continua în lumea curentă sau poate confirma un Boundary Reset. Resetul acordă Fundamental Insights și deschide funcții noi. După cumpărarea upgrade-urilor funcționale finite, un nod endless oferă bonusuri plate mici.

## 6.3 Timp și pauză

Jucătorul are Pause și trei viteze normale. Valorile propuse sunt 1x, 2x și 4x. Modul de debug acceptă orice multiplicator și simulări accelerate.

Offline Assist rămâne o funcție secundară:

- maximum 30 de minute simulate;
- eficiență de 35 la sută;
- avansează doar Services și research deja configurate;
- nu cumpără hardware;
- nu declanșează tranziții;
- deadline-urile campaniei nu pot eșua în timp ce jocul este închis;
- funcția poate fi dezactivată.

# 7. Bucla principală

## 7.1 Bucla de 20 până la 90 de secunde

1. Jucătorul observă o schimbare de cerere, temperatură sau eficiență.
2. Selectează un modul, task sau cluster.
3. Schimbă alocarea, profilul de clock, ruta sau prioritatea.
4. Primește feedback vizual și numeric.
5. Decide următorul upgrade.

## 7.2 Bucla de 2 până la 8 minute

1. Finalizează o etapă de proiect.
2. Cumpără hardware sau research.
3. Modifică un blueprint.
4. Rulează un benchmark.
5. Rezolvă un bottleneck nou.

## 7.3 Bucla de 15 până la 35 de minute

1. Finalizează proiectul principal al generației.
2. Trecere printr-un set de benchmark-uri.
3. Efectuează Generation Transition.
4. Integrează hardware-ul vechi, îl modernizează sau îl vinde.
5. Deblochează o problemă nouă de gameplay.

# 8. Resursele jocului

| Resursă | Comportament | Utilizare |
|---|---|---|
| Cash | Stoc, poate deveni negativ până la limita de credit | Hardware, spațiu, salarii, mentenanță, energie, research și manoperă. |
| Useful Compute | Flux, nu se stochează | Avansează task-uri și research. Se exprimă în FLOPS și multipli. |
| Power | Capacitate și cost | Limitează hardware-ul activ și overclock-ul. |
| Temperature | Stare locală și de sistem | Produce throttling, shutdown și pierdere de stabilitate. Se afișează în grade reale. |
| Memory Capacity | Capacitate | Permite încărcarea workload-ului. |
| Memory Bandwidth | Flux | Limitează task-urile care mută multe date. |
| Research Data | Stoc contextual | Se obține din proiecte și experimente. Finanțează nodurile din arborii de research. |
| Reputation | Prag | Deblochează clienți, granturi, contracte și personal. |
| Space | Capacitate fizică | Limitează modulele, rack-urile și facilitățile. |
| Stability | Calitate calculată | Reduce retry-urile și validează benchmark-urile. |
| Workforce | Capacitate operațională | Limitează mentenanța, construcția și numărul proiectelor simultane. |

Header-ul afișează permanent Cash, Useful Compute, Power și Temperature. Panoul Telemetry oferă restul valorilor, graficele și alertele.

# 9. Formula centrală pentru performanță

Formula de bază este:

`Useful Compute = Theoretical Compute × Power Factor × Thermal Factor × Memory Factor × Interconnect Factor × Suitability × Stability Factor`

Exemplu:

`100 TFLOPS × 1,00 × 0,86 × 0,72 × 0,94 × 1,15 × 0,98 = 64,2 TFLOPS utili`

Fiecare factor apare în inspector. Un buton Explain Loss ordonează pierderile de la cea mai importantă la cea mai mică.

## 9.1 Precizie și rezultate valide

Campania nu livrează rezultate aproximative în mod aleatoriu. Un task care cere 32 de biți nu poate fi executat nativ pe un sistem de 16 biți. Jucătorul are trei opțiuni:

1. deblochează hardware compatibil;
2. folosește emulare software, cu penalizare mare de viteză și memorie;
3. refuză sau amână task-ul.

Instabilitatea de overclock produce retry-uri, mostre invalide și pierdere de Useful Compute. Sistemul verifică rezultatul înainte de livrare. O livrare coruptă apare numai în challenge-uri în care protecțiile sunt dezactivate explicit.

# 10. Task-uri și contracte

## 10.1 Categorii

1. Services oferă venit continuu. Plata scade proporțional dacă SLA-ul nu este respectat.
2. Projects au progres finit, etape și recompense mari.
3. Research Experiments consumă Cash și Compute pentru a genera Research Data, evidence tags și tehnologii.

Global Initiatives reprezintă un subtip de Project. Comunitatea fictivă contribuie în timp real la progres. Contribuția jucătorului oferă praguri de recompensă. Un exemplu inspirat de Folding@home poate începe în anul 2000. Progresul extern continuă chiar dacă jucătorul pune proiectul pe hold.

## 10.2 Profilul unui task

Fiecare task definește:

- operații totale;
- compute minim și compute recomandat;
- memory capacity;
- memory bandwidth;
- serialism și parallelism;
- latență;
- precizie;
- stabilitate minimă;
- intensitate termică;
- faze;
- deadline;
- payout;
- reputație;
- research tags;
- compatibilitate hardware;
- condiții de hold, abandon și penalizare.

## 10.3 Tag-uri predictive

Tag-urile nu sunt simple categorii. Ele explică ce va solicita task-ul și avertizează jucătorul înainte de acceptare.

| Familie | Exemple |
|---|---|
| Profil de compute | SERIAL, PARALLEL, VECTOR, MEMORY-HEAVY, BANDWIDTH, LATENCY |
| Hardware | CPU, GPU, ASIC, FPGA, QPU, HYBRID |
| Operare | BURST, SUSTAINED, TIME-SENSITIVE, MULTI-PHASE, EXCLUSIVE |
| Risc | THERMAL, HIGH-PRECISION, EXPERIMENTAL, SECRET |
| Progres | RESEARCH-UNLOCK, HISTORICAL, GLOBAL-INITIATIVE |

Un tag nu trebuie să spună că overclock-ul este obligatoriu. Sistemul compară task-ul cu configurația curentă și poate afișa o avertizare dinamică: `Deadline risk: Boost sau 18% compute suplimentar recomandat`.

## 10.4 Hold și abandon

Un proiect poate fi pus pe hold. Timeline-ul lui continuă dacă proiectul are deadline. Abandonul produce o penalizare stabilită în contract. Global Initiatives nu penalizează o simplă pauză, dar contribuția personală nu mai crește.

Ofertele normale pot rămâne în listă până la expirare. Jucătorul nu trebuie să apese Refuse. Ofertele istorice, secrete sau exclusive pot avea o fereastră limitată.

Recompensa, penalizarea și cerințele sunt afișate complet înainte de acceptare. Contractele Secret pot ascunde identitatea clientului sau o etapă narativă, dar nu ascund costul operațional estimat și riscul de bază.

# 11. Benchmark-uri

Da, jucătorul poate folosi Boost sau un profil Manual foarte agresiv pentru a obține un rezultat mare într-un benchmark scurt. Acest lucru nu reprezintă automat un exploit. Un benchmark de vârf măsoară exact performanța de vârf.

Pentru ca tranzițiile să nu fie trivializate, jocul folosește trei certificate:

1. Peak Throughput, test de 10 până la 20 de secunde. Boost-ul este permis și poate decide rezultatul.
2. Sustained Stability, test de 90 până la 180 de secunde. Verifică temperatura, retry-urile și power headroom.
3. Workload Suite, set de task-uri seriale, paralele și memory-heavy. Verifică faptul că sistemul nu este bun într-un singur scenariu.

Unele Generation Transitions cer toate cele trei certificate. Challenge-urile pot cere numai unul.

Leaderboard-ul salvează profilul folosit, consumul maxim, temperatura maximă și costul sistemului. Astfel, recordul rămâne interesant chiar dacă două configurații ating același compute.

[[PAGEBREAK]]

# 12. System Canvas și ierarhia grilelor

## 12.1 Răspunsul la problema scării

O generație nu înseamnă că tot hardware-ul se transformă automat din 15 nm în 11 nm. O Generation Transition deblochează o familie nouă de componente și un nou standard de proiectare. Hardware-ul vechi continuă să existe. El poate deveni compatibil, retrofit-able sau obsolete.

Canvas-ul afișează o singură scară la un moment dat. Un breadcrumb arată poziția:

`Company > Facility 2 > Rack 04 > Server Blueprint GPU-A > Package`

## 12.2 Cele trei niveluri

| Nivel | Rol | Exemplu de decizie |
|---|---|---|
| System Design | Proiectarea unei unități repetabile | CPU, GPU, RAM, storage, power delivery, cooling și interconectări. |
| Facility | Plasarea instanțelor de server sau mainframe | Trei rack-uri CPU-focused, două GPU-focused, distribuția energiei și răcirii. |
| Portfolio | Coordonarea mai multor facilități | Alocarea globală de task-uri, extinderea spațiului și specializarea centrelor. |

Nivelul Portfolio apare târziu. El agregă simularea. Jucătorul nu vede mii de componente individuale simultan.

## 12.3 Grila pătrată

Grila pătrată este alegerea finală. Ea corespunde mai bine plăcilor, rack-urilor, camerelor, sloturilor și rutelor ortogonale. Modulele pot ocupa mai multe tile-uri și se pot roti.

Reguli principale:

- modulele au porturi de power, data și cooling;
- conexiunile foarte scurte se creează automat, dar rămân vizibile ca trasee fine;
- conexiunile lungi folosesc rute manuale sau Auto-route;
- power și data folosesc straturi separate;
- liquid cooling adaugă un strat de conducte;
- airflow folosește volume și direcții, nu conducte;
- distanța crește latența și pierderile;
- densitatea produce hotspot-uri;
- componentele pot avea restricții de orientare și slot;
- rutarea poate fi activată sau dezactivată în modul automat.

Cablurile nu consumă întotdeauna un tile complet. Ele consumă Routing Capacity pe marginea sau în stratul tile-ului. Această regulă permite trasee vizibile fără ca grila să devină un puzzle de cabluri.

Facility Canvas include pereți, uși, podele tehnice și direcția ventilației. Mai multe etaje se deblochează după apariția centrelor de date mari. Etajele sunt simulate separat și conectate prin power, cooling și network trunks.

# 13. Blueprint-uri și prebuild-uri

## 13.1 Blueprint ierarhic

Jucătorul poate salva:

1. un subansamblu, cum ar fi un modul CPU plus cache;
2. un server complet;
3. un rack;
4. o zonă de facility.

Blueprint-ul salvează modulele, rotația, conexiunile, regulile de automatizare și profilurile implicite. El nu salvează componente pe care jucătorul nu le-a deblocat în run-ul curent.

Blueprint-urile pot fi exportate și importate între save-uri. Un blueprint importat rămâne vizibil ca referință, dar nu poate fi construit până când toate tehnologiile obligatorii sunt deblocate.

## 13.2 Replicare

Ideea de a proiecta un mini-grid și de a-l replica este una dintre mecanicile centrale. Un exemplu valid:

- Blueprint CPU-S1, optimizat pentru task-uri seriale;
- Blueprint GPU-P2, optimizat pentru AI și simulări paralele;
- trei instanțe CPU-S1 și două instanțe GPU-P2 într-un facility;
- un scheduler distribuie fazele CPU și GPU ale proiectelor multi-stage.

## 13.3 Actualizare și versiuni

Schimbarea unui blueprint creează o versiune nouă. Jucătorul selectează instanțele care primesc update-ul. Jocul calculează costul, manopera, piesele necesare și downtime-ul. Update-ul nu se aplică automat tuturor instanțelor.

## 13.4 Deblocare

Blueprint-urile apar în primele 10 până la 15 minute ale primei generații. Jucătorul trebuie mai întâi să construiască manual o configurație validă și să o ruleze într-un task.

Prebuild-urile se deblochează ulterior. Ele costă cu aproximativ 8 până la 15 la sută mai mult decât piesele separate. Avantajul lor este timpul economisit, nu un bonus artificial de performanță.

# 14. Design Mode și mentenanță

Jucătorul poate intra în Design Mode fără să oprească imediat sistemul. Acolo el mută piese, testează rute și simulează temperatura. Modificarea devine reală numai după Apply.

La Apply, jocul arată:

- clusterul afectat;
- timpul de oprire;
- costul manoperei;
- piesele cumpărate sau eliberate;
- schimbarea estimată de compute;
- schimbarea estimată de temperatură;
- task-urile aflate în risc.

Jucătorul poate opri un singur cluster sau întregul sistem. Undo funcționează în Design Mode. Mutarea fizică are cost, calculat din numărul pieselor, masa lor, distanță și costul muncii din perioada istorică.

# 15. Hardware și silicon lottery

Componentele identice pot varia cu maximum plus sau minus 10 la sută. Variația apare prin binning:

- compute;
- eficiență energetică;
- temperatură la aceeași sarcină;
- stabilitate la overclock.

O componentă slabă nu este defectă. Ea poate fi mutată într-un server Eco sau vândută. Componente rare și experimentale apar în anumite perioade, granturi sau challenge-uri.

Component Age din inspector reprezintă timpul de utilizare și valoarea istorică. Nu reduce automat sănătatea sau performanța în campania normală.

Inspectorul arată Base Spec și Actual Spec. Jucătorul înțelege imediat dacă a câștigat sau a pierdut silicon lottery.

# 16. Power, temperatură și cooling

## 16.1 Temperatura reală

Interfața folosește temperaturi reale, nu o bară abstractă între 0 și 100.

- sistemele clasice afișează grade Celsius;
- sistemele cuantice afișează Kelvin sau milikelvin;
- fiecare componentă are interval Normal, Warning, Critical și Shutdown;
- hover-ul explică efectul fiecărei zone.

Același indicator se numește Temperature în ambele sisteme. Unitatea și limitele se schimbă în funcție de hardware.

## 16.2 Simulare locală și globală

Fiecare tile poate primi căldură de la modulele apropiate. Căldura difuzează în vecinătate și este eliminată de cooling. Facility-ul are și o limită globală de evacuare. Dacă limita globală este depășită, temperatura tuturor zonelor urcă lent.

Modelul de joc folosește o aproximație, nu o simulare CFD completă:

`TempNext = TempCurrent + GeneratedHeat - LocalCooling - GlobalExtraction + NeighborDiffusion`

Heatmap-ul poate fi activat sau dezactivat. El trece de la fundal rece la portocaliu și roșu. Temperatura exactă rămâne vizibilă în inspector.

## 16.3 Cooling istoric

Cooling-ul se deblochează prin research și proiecte istorice:

1. ventilație și airflow;
2. aer condiționat și răcire de cameră;
3. apă răcită și cold plates;
4. direct-to-chip liquid cooling;
5. immersion cooling;
6. microfluidică integrată;
7. criogenie pentru QPU.

Jocul nu cere apăsarea repetată a unui buton de purge. Cooling-ul funcționează automat. Jucătorul controlează arhitectura, capacitatea, rutele și regulile.

## 16.4 Power

Fiecare modul are consum idle, consum load și un profil de vârf. Prețul energiei se schimbă istoric. Evenimente rare pot produce scumpiri, pene sau disponibilitate redusă.

Sursele de producție, cum ar fi cărbune, nuclear sau solar, nu intră în prima campanie. Acest sistem poate deveni o extindere separată. În jocul de bază, jucătorul cumpără capacitate electrică și contracte de furnizare.

Temperatura ambientală nu variază prin vreme în jocul de bază. Scurgerile aleatorii de lichid sunt excluse din campania normală.

# 17. Overclock

## 17.1 Profiluri

| Profil | Efect principal | Utilizare |
|---|---|---|
| Eco | Consum și temperatură mici | Services stabile, perioade scumpe energetic. |
| Balanced | Valori nominale | Funcționare normală. |
| Boost | Frecvență crescută temporar | Deadline, Peak Benchmark, etapă critică. |
| Manual | Frecvență și tensiune controlate | Optimizare avansată și recorduri. |

## 17.2 Formula de putere

Modelul de gameplay pornește de la relația:

`Dynamic Power Factor = (Voltage / Base Voltage)^2 × (Frequency / Base Frequency)`

Compute-ul crește aproximativ cu frecvența până când alte blocaje devin dominante. Puterea și căldura cresc mai repede când tensiunea urcă.

## 17.3 Instabilitate

Overclock-ul agresiv poate produce:

- retry-uri;
- benchmark samples invalide;
- emergency shutdown;
- cooldown după shutdown;
- pierderea progresului necheckpointed al unui task;
- penalizare de deadline.

Nu produce distrugerea permanentă a hardware-ului în campania normală.

Protecția termică poate fi dezactivată. În campania normală, consecința maximă rămâne crash-ul sistemului, costul intervenției și pierderea progresului recent. În Reliability Challenge poate apărea defectarea permanentă.

# 18. Reliability Challenge

Ideea de sănătate a componentelor este bună, dar schimbă radical ritmul. Ea devine un mod separat.

În Reliability Challenge, fiecare componentă are Health și Stress History. Overclock-ul constant, temperatura ridicată și ciclurile termice cresc probabilitatea unei defecțiuni.

Când apare o problemă, jucătorul folosește un flux în patru pași:

1. Detect, simptome precum erori, consum anormal sau temperatură locală.
2. Diagnose, testare pe subsisteme și compararea telemetriei.
3. Repair, înlocuirea unui element sau recalibrare.
4. Decide, păstrează, repară, vinde pentru piese sau înlocuiește.

Modul poate include challenge-uri de tipul `Run 30 de zile fără downtime`, `Maximum compute cu buget de mentenanță fix` și `Legacy hardware only`.

# 19. Automatizare IF și THEN

Automatizarea arată ca un sistem de blocuri inspirat de Scratch. Jucătorul nu scrie sintaxă la început.

O regulă are cinci elemente:

1. Trigger, de exemplu o schimbare de temperatură sau începutul unui task.
2. Condition, de exemplu `GPU Temp > 78°C timp de 5 secunde`.
3. Action, de exemplu `Set profile to Balanced`.
4. Cooldown, pentru a evita comutarea continuă.
5. Priority, pentru rezolvarea conflictelor dintre reguli.

Exemplu:

`WHEN GPU TEMP > 78°C FOR 5s THEN SET CLUSTER A TO BALANCED AND ADD 20% COOLING PRIORITY`

După salvare, blocurile se comprimă vizual într-un pseudo-cod. Jucătorul poate reveni oricând la blocuri.

Automatizarea se deblochează gradual:

- preset-uri simple;
- o condiție și o acțiune;
- AND și OR;
- timere, hysteresis și cooldown;
- reguli între clustere;
- scheduler pentru mai multe task-uri;
- predictive thermal control.

# 20. Research

## 20.1 Resursă și domenii

Jocul folosește un singur stoc numeric numit Research Data. Nu introduce cinci monede colorate separate. Domeniile sunt arbori diferiți cu cerințe proprii:

1. Compute Architecture;
2. Fabrication and Materials;
3. Memory and Interconnect;
4. Power and Thermal;
5. Software and Algorithms;
6. Quantum Control and Error Correction, după deblocare.

Software and Algorithms are un arbore separat vizual de hardware. Cele două pot avea prerechizite comune.

## 20.2 Costul unui nod

Un nod poate cere simultan:

- Cash;
- Research Data;
- Compute rezervat;
- timp;
- un tip de laborator;
- un Evidence Tag obținut dintr-un task;
- un benchmark;
- un nod anterior.

Research-ul pasiv există, dar este lent și plafonat. Experimentele și proiectele istorice reprezintă sursa principală de Research Data.

Research nodes folosesc tag-uri pentru Domain, Mandatory, Optional, Branch Exclusive, Experimental, Required Lab, Evidence și Unlock. Un tag Experimental afișează probabilitatea curentă și ce date se păstrează la eșec.

## 20.3 Mandatory și optional

Research-ul obligatoriu deschide generația următoare. Research-ul opțional schimbă mecanici, oferă automatizare sau specializează compania.

Upgrade-urile bune schimbă comportamentul:

- ECC transformă erorile în retry-uri mai rare;
- cache hierarchy reduce penalizarea de distanță;
- compiler vectorization schimbă suitability;
- HBM crește bandwidth-ul, dar concentrează căldura;
- auto-routing reduce timpul de proiectare;
- liquid cooling schimbă forma și capacitatea zonelor termice.

## 20.4 Experimente probabilistice

Experimentele pot eșua. Un eșec nu șterge complet investiția. El produce Diagnostic Data, care crește șansa următoarei încercări și poate debloca o ramură ascunsă.

## 20.5 Respec

Nodurile opționale pot fi respec înainte de proiectul final al generației. Jucătorul recuperează 75 la sută din Research Data, nu recuperează timpul și plătește 10 la sută din costul Cash. Prima utilizare din tutorial este gratuită.

O arhitectură primară din capitolul Beyond Silicon se blochează pentru run-ul curent după capstone. Alegerea trebuie să aibă greutate.

[[PAGEBREAK]]

# 21. Economia companiei

## 21.1 Cash și datorie

Cash poate scădea sub zero până la limita de credit. Dacă firma rămâne sub limita sigură, începe Insolvency Countdown. Jucătorul primește un plan clar de salvare, cu task-uri, vânzări și restructurare.

Prima insolvență permite un bailout. Forma lui depinde de perioadă și situație:

- împrumut cu dobândă;
- grant guvernamental condiționat;
- investitor care primește control;
- vânzarea unei facilități;
- contract exclusiv dezavantajos.

A doua insolvență încheie run-ul campaniei. Jucătorul poate relua ultimul checkpoint major sau începe un run nou.

## 21.2 Costuri

Compania plătește:

- achiziția hardware-ului;
- energie;
- mentenanță;
- salarii și manoperă;
- chirie sau cumpărarea spațiului;
- research;
- dobândă;
- licențe și software în anumite perioade.

Valorile sunt exprimate în dolari nominali ai perioadei. Un tooltip opțional arată echivalentul aproximativ în dolari din 2026. Prețurile energiei și evenimentele de piață folosesc tabele istorice simplificate, nu variații zilnice.

Stocul componentelor poate fi limitat în perioade și evenimente justificate. Exemplele includ loturi experimentale, crize de memorie, penurie de materiale și prioritate pentru contracte guvernamentale.

## 21.3 Spațiu

Jucătorul poate închiria sau cumpăra. Chiria reduce investiția inițială, dar adaugă un cost permanent și limite de modificare. Cumpărarea este mult mai scumpă, dar oferă extindere, control și valoare de revânzare.

## 21.4 Salvage și compatibilitate

La o tranziție, sistemul împarte automat hardware-ul în trei grupe:

1. Compatible, poate continua fără modificări.
2. Retrofit-able, poate fi adaptat cu bani și downtime.
3. Obsolete, funcționează slab sau nu mai poate folosi standardul nou.

Jucătorul poate păstra, moderniza sau vinde fiecare grup. Salvage-ul standard recuperează 35 la sută din valoarea de bază, ajustată pentru vârstă istorică, cerere și raritate. O acțiune Recommended aplică automat o soluție sigură, dar jucătorul poate modifica alegerea.

Această variantă păstrează ideea de a schimba piesele compatibile pe bucăți fără a transforma tranziția într-un inventar obositor.

# 22. Companie privată sau publică

Compania începe privată. Mai târziu poate rămâne privată sau poate face IPO.

## 22.1 Companie privată

- ritm de capital mai lent;
- libertate mare asupra research-ului;
- fără obiective trimestriale obligatorii;
- penalizare mai mică pentru întârzierea tehnologică;
- acces mai redus la proiecte foarte mari.

## 22.2 Companie publică

- injecție de capital;
- facilități și împrumuturi mai mari;
- obiective trimestriale;
- investitori care cer venit, reputație sau o generație tehnologică;
- bonusuri pentru depășirea țintelor;
- penalizări pentru întârzieri, task-uri eșuate și lipsa progresului.

Sistemul nu devine un simulator complet de bursă. El adaugă o presiune strategică și o a doua sursă de obiective.

# 23. Narațiune, personaje și etică

Compania persistă, dar oamenii îmbătrânesc. Personajele apar rar, în special la Architecture Breakthrough, crize și succesiuni. Povestea folosește:

- memo-uri scurte;
- event log;
- ecrane de tranziție;
- câteva dialoguri cu alegeri;
- intrări în Museum și Encyclopedia.

Alegerile narative nu formează un sistem separat. Ele se leagă de gameplay. Jucătorul poate refuza proiecte militare sau considerate lipsite de etică. Refuzul poate pierde bani și granturi, dar poate crește reputația în alte sectoare și poate deschide alternative.

Evenimentele și proiectele se inspiră din istorie. Companiile comerciale folosesc denumiri fictive recognoscibile, fără logo-uri reale. Intrările educaționale din Museum pot numi evenimente și instituții reale.

Jucătorul poate descoperi o tehnologie înaintea datei istorice. Costul, riscul de research și cerințele de laborator cresc cu distanța față de anul de referință. Această regulă permite run-uri în care quantum sau alte tehnologii apar mult mai devreme.

# 24. Cronologia campaniei

## 24.1 Prolog, Human Computers, 1946

Durată țintă: 5 până la 10 minute.

Jucătorul alocă oameni, timp și verificări pentru un calcul manual. Prologul explică task queue, precizia și deadline-ul. Automatizarea mecanică și electronică devine imediat o nevoie de gameplay.

## 24.2 Capitolul 0, Foundations, 1946 până în 1958

| Element | Conținut |
|---|---|
| Hardware | Relee, tuburi electronice, memorie drum, linii de întârziere, primele tranzistoare discrete, memorie magnetică. |
| Problema principală | Spațiu, consum, defecte și programare dificilă. |
| Task-uri | Tabele balistice, recensământ, prognoză meteo, calcule științifice și traiectorii. |
| Breakthrough | Calculator complet tranzistorizat. |
| Durată | Aproximativ 1,5 ore. |

Generații propuse:

1. Electromechanical Assistance;
2. Vacuum Tube System;
3. Stored-Program Architecture;
4. Discrete Transistor System.

## 24.3 Capitolul 1, Integrated Circuits, 1958 până în 1971

| Element | Conținut |
|---|---|
| Hardware | Circuite integrate, SSI, MSI, TTL, MOS, core memory și mainframe-uri. |
| Problema principală | Yield, compatibilitate, I/O și densitate. |
| Task-uri | Rezervări aeriene, payroll, simulări inginerești și programe spațiale. |
| Breakthrough | Primul microprocesor comercial al companiei. |
| Durată | Aproximativ 1,5 ore. |

Generații propuse:

1. Planar Process;
2. SSI Logic;
3. MSI and TTL Platform;
4. MOS Integration.

## 24.4 Capitolul 2, Microprocessor Revolution, 1971 până în 1990

| Element | Conținut |
|---|---|
| Noduri orientative | 10 µm, 6 µm, 3 µm, 1,5 µm și aproximativ 1 µm. |
| Hardware | CPU, RAM, coprocesoare, storage, magistrale și workstation-uri. |
| Problema principală | Memory latency, software compatibility și cost. |
| Task-uri | Banking, CAD, simulări industriale și software personal. |
| Research | CMOS, cache, pipelining, instruction sets și virtual memory. |
| Durată | Aproximativ 2 ore. |

Jucătorul începe să salveze server sau workstation blueprint-uri. Arhitecturile RISC și CISC pot deveni specializări diferite, nu o alegere strict corectă și greșită.

## 24.5 Capitolul 3, Networked Compute, 1990 până în 2005

| Element | Conținut |
|---|---|
| Noduri orientative | 800 nm, 350 nm, 180 nm și 90 nm. |
| Hardware | Workstation-uri, servere, clustere, acceleratoare și prime GPU programabile. |
| Problema principală | Networking, distribuția datelor și paralelism. |
| Task-uri | Web hosting, genom, CGI, motoare de căutare și volunteer computing. |
| Research | Superscalar, out-of-order, cluster scheduling, virtualization și GPU compute. |
| Durată | Aproximativ 2 ore. |

Aici se deblochează sistemul ierarhic complet: proiectezi serverul într-un mini-grid, îl salvezi, apoi îl multiplici în rack-uri. Poți păstra simultan blueprint-uri CPU-focused, GPU-focused și hibride.

## 24.6 Capitolul 4, Power Wall and Accelerators, 2005 până în 2020

| Element | Conținut |
|---|---|
| Noduri orientative | 65 nm, 32 nm, 14 nm și 7 nm. |
| Hardware | Multicore CPU, GPGPU, SSD, FPGA și acceleratoare. |
| Problema principală | Căldură, paralelism software și memory bandwidth. |
| Task-uri | Protein folding, climate models, machine learning, randare și servicii cloud. |
| Research | FinFET, multicore scheduling, vectorization, liquid cooling și acceleratoare. |
| Durată | Aproximativ 2,5 ore. |

## 24.7 Capitolul 5, Chiplets, AI and Angstrom Era

| Element | Conținut |
|---|---|
| Generații | 5 nm, 3 nm, 2 nm și clase comerciale angstrom. |
| Hardware | GAAFET, chiplets, HBM, interposer, AI accelerators și backside power. |
| Problema principală | Yield, packaging, power delivery și bandwidth. |
| Task-uri | Training AI, inference, molecular dynamics și digital twins. |
| Research | EUV, High-NA EUV, advanced packaging, interconnect și process control. |
| Durată | Aproximativ 2,5 ore. |

Numele comerciale ale nodurilor sunt tratate ca generații tehnologice. Jocul nu pretinde că numărul reprezintă o singură dimensiune fizică.

# 25. EUV ca lanț principal de progresie

EUV devine advancement-ul central al Capitolului 5. Nu este un singur buton de research.

## 25.1 Lanțul de research

1. Vacuum and Contamination Control.
2. Tin Droplet Generator.
3. Pre-pulse Shaping.
4. Main CO2 Pulse and Plasma Stability.
5. Collector Optics and Multilayer Mirrors.
6. Source Power and Spectral Purity.
7. Mask, Pellicle and Defect Inspection.
8. EUV Resist and Outgassing Control.
9. Overlay and Metrology.
10. Yield Recipe and Production Qualification.

ASML descrie două impulsuri laser asupra picăturilor de staniu și până la 50.000 de cicluri pe secundă. Jocul folosește această succesiune drept bază pentru research și calibrare.

## 25.2 Gameplay de calibrare

Jucătorul nu operează direct o mașină reală. El controlează trei sau patru variabile care produc compromisuri:

- Droplet Timing;
- Pre-pulse Energy;
- Main Pulse Focus;
- Debris Mitigation.

Creșterea source power poate scădea stabilitatea, poate crește debris-ul și poate reduce uptime-ul. O calibrare bună trebuie să atingă simultan source power, overlay și yield.

După ce jucătorul găsește o rețetă stabilă, o salvează ca Process Recipe și automatizează menținerea ei. Gameplay-ul nu cere recalibrare manuală constantă.

## 25.3 Capstone

Capitolul se încheie când compania produce un lot stabil la target yield, trece Workload Suite și integrează un package cu chiplet-uri și memorie HBM.

# 26. Capitolul 6, Beyond Silicon

Durată țintă: 3 până la 4 ore. Capitolul este mai lung deoarece alegerea arhitecturii trebuie să fie simțită în gameplay.

Jucătorul alege o Primary Architecture. Poate cerceta maximum două tehnologii suplimentare ca Supporting Technologies. Nu poate maximiza toate cele șase ramuri într-un singur run.

## 26.1 Cele șase arhitecturi

| Arhitectură | Puncte forte | Limite | Workload-uri potrivite |
|---|---|---|---|
| 2D Materials | Densitate, control electrostatic și leakage redus | Contact resistance, materiale și yield | General compute eficient, mobile și dense logic. |
| Carbon Nanotube FET | Performanță per watt și canale foarte mici | Aliniere, puritate, variație și producție | CPU rapid, acceleratoare și compute general. |
| Silicon Photonics | Bandwidth, latență și distanță de interconectare | Conversie electro-optică, memorie și operații neliniare | Rețele, AI matrix operations și clustere distribuite. |
| Neuromorphic | Eficiență mare pentru evenimente și inferență | Compatibilitate limitată, precizie și software special | Senzori, robotică, edge AI și pattern recognition. |
| Monolithic 3D | Densitate și interconectări scurte | Hotspot-uri verticale, yield și proces termic | General compute, in-memory compute și sisteme compacte. |
| Reversible Computing | Consum și căldură foarte mici în regim potrivit | Clocking, logică, garbage management și viteză | Compute de lungă durată, eficiență extremă și endgame fizic. |

## 26.2 Identitatea de gameplay

2D Materials pune accent pe fabricație și contact quality. CNTFET cere aliniere și sortare. Silicon Photonics mută blocajul spre conversie și memorie. Neuromorphic cere software și task-uri compatibile. Monolithic 3D transformă temperatura într-o problemă verticală. Reversible Computing schimbă relația dintre viteză, energie și ștergerea informației.

## 26.3 Tranziții vizuale

Toate Architecture Breakthroughs folosesc aceeași gramatică de zoom și reconstrucție. Fiecare primește un element propriu:

- straturi atomice care se așază pentru 2D Materials;
- nanotuburi care se aliniază pentru CNTFET;
- impulsuri luminoase pentru Silicon Photonics;
- spike-uri neuronale pentru Neuromorphic;
- straturi verticale pentru Monolithic 3D;
- o undă care se întoarce controlat pentru Reversible Computing.

Această consistență păstrează identitatea jocului și evită tranziții complet diferite.

[[PAGEBREAK]]

# 27. Capitolul 7, Quantum-Classical Systems

Durată țintă: aproximativ 3 ore. Quantum este obligatoriu în campania principală, dar funcționează ca accelerator. Infrastructura clasică rămâne necesară până la final.

## 27.1 Două canvas-uri conectate

Deblocarea QPU adaugă un Quantum Lab Canvas și păstrează Classical Facility Canvas. O animație extinde harta companiei. Jucătorul comută între ele prin tab-uri sau shortcut-uri.

Un task hibrid trece prin etape:

1. pregătire și compresie pe CPU sau GPU;
2. compilarea circuitului și control pe infrastructură clasică;
3. execuție pe QPU;
4. error correction și syndrome decoding pe hardware clasic;
5. post-procesare și validare pe CPU sau GPU.

În endgame, un Unified Hybrid Scheduler poate ascunde rutarea manuală. Sistemul continuă să folosească resurse clasice și cuantice. Quantum nu devine un PC clasic universal.

## 27.2 Resurse cuantice

- Physical Qubits;
- Logical Qubits;
- Gate Fidelity;
- Coherence T1 și T2;
- Error Correction Capacity;
- Cryogenic Capacity;
- Classical Control Compute;
- Readout Bandwidth;
- Calibration Stability.

## 27.3 Physical și Logical Qubits

Physical Qubits reprezintă dispozitivele reale. Ele au erori și coerență limitată. Error correction combină mai mulți physical qubits într-un Logical Qubit mai fiabil.

Jocul folosește complexitate medie. Jucătorul vede:

- raportul Physical per Logical;
- code distance;
- error budget;
- resursele clasice pentru syndrome decoding;
- efectul fidelității asupra overhead-ului.

Nu există un raport universal fix. Research-ul, arhitectura și calitatea hardware-ului modifică necesarul.

## 27.4 Arhitecturi de qubit

| Arhitectură | Avantaj de gameplay | Cost și risc |
|---|---|---|
| Superconducting | Gate-uri rapide și integrare bună în module dense | Criogenie severă, crosstalk și coerență mai scurtă. |
| Trapped Ion | Fidelitate și coerență ridicate, conectivitate flexibilă | Gate-uri lente, laser control și vacuum complex. |
| Photonic | Networking bun și integrare cu interconectări optice | Pierderi, generare și detecție, operații probabilistice. |
| Neutral Atom | Array-uri mari și reconfigurabile | Laser control, atom loss și maturitate operațională. |
| Silicon Spin | Densitate și compatibilitate cu fabricația semiconductorilor | Control, variație, wiring și temperatură joasă. |
| Topological, Majorana | Potențial de protecție la erori | Ramură speculativă, foarte scumpă și cu risc mare de research. |

Ramura Topological nu este prezentată drept tehnologie demonstrată fără dubiu. Ea apare ca research high-risk. Sursele academice și știrile științifice din 2025 și 2026 arată progres, dar și scepticism. În joc, avantajul potențial este error correction mai eficient. Costul este probabilitatea mare de eșec și o cale lungă de validare.

## 27.5 Vizualizarea coerenței

Vizualizarea propusă este viabilă. Ea folosește trei niveluri:

1. Selected Qubit View, o sferă Bloch pseudo-3D. Vectorul se micșorează pe măsură ce coerența se pierde.
2. QPU Coherence Map, fiecare qubit apare ca o celulă. Zgomotul transformă gradual celulele din albastru în nuanțe de roșu.
3. T1 and T2 Graphs, grafice scurte care arată relaxation și dephasing.

Culoarea roșie nu este aleatoare fără sens. Distribuția vizuală folosește valorile de zgomot, temperatură, crosstalk și calibrare.

Pentru topological qubits, jocul afișează o rețea de parity și braiding paths. Pierderea protecției rupe vizual unele conexiuni și reduce fidelitatea. Qubit-urile nu dispar literalmente. Efectul reprezintă pierderea protecției topologice.

Reduced Animations înlocuiește sfera și efectele cu o hartă 2D și grafice simple.

## 27.6 Task-uri cuantice

- simulări moleculare;
- optimizare combinatorială;
- materiale exotice;
- criptografie;
- quantum machine learning experimental;
- verificare și calibrare de coduri de corecție;
- task-uri hibride HPC plus QPU.

Criptografia poate produce alegeri narative și un easter egg în arhitectura finală. Consecințele apar prin contracte, reglementări și reputație.

# 28. Epilogul, Physical Limits

Tranziția către final trebuie pregătită. Jocul nu sare brusc la o tehnologie fără context.

Ultimele proiecte urmăresc limite fizice și informaționale:

- Landauer Limit Experiments;
- Fault-Tolerant Quantum Fabric;
- Reversible Logic at Scale;
- Ultra-dense Information Storage;
- Cosmic Scale Simulation;
- Boundary Proof Project.

Finalizarea lor produce Singularity Data. Ecranul final explică ce a demonstrat compania și ce rămâne speculativ. Abia apoi se deblochează Boundary Reset.

O ramură post-silicon fără QPU poate exista ca challenge sau endless path. Campania principală cere totuși integrarea unui accelerator cuantic.

# 29. Tranziții și reseturi

| Nivel | Nume | Efect |
|---|---|---|
| Schimbare normală | Deployment | Instalează hardware fără reset. |
| Mini-rebirth | Generation Transition | Deblochează standarde și componente noi. Hardware-ul vechi rămâne de gestionat. |
| Schimbare de capitol | Architecture Breakthrough | Introduce o mecanică nouă și o tranziție vizuală majoră. |
| Final de campanie | Boundary Reset | Resetează istoria după confirmare și acordă Fundamental Insights. |

Fiecare capitol are în medie patru Generation Transitions. Unele au trei, altele cinci, în funcție de momentele tehnologice care schimbă gameplay-ul. Nu trebuie inventat un nod numai pentru a atinge același număr în fiecare capitol.

## 29.1 Condiții

O Generation Transition poate cere:

- proiectul principal;
- research obligatoriu;
- Cash;
- certificatele de benchmark;
- reputation;
- o configurație validă;
- un process recipe stabil.

Jucătorul poate amâna tranziția și poate continua să producă bani. Săritul unei generații este posibil, dar foarte greu și cere research avansat, capital și un benchmark peste nivelul curent.

## 29.2 Ce se păstrează

- Cash;
- Research Data;
- nodurile de research deja obținute;
- Reputation;
- contractele active compatibile;
- blueprint-urile;
- Museum;
- automatizările;
- hardware-ul compatibil.

Research-ul generațiilor vechi rămâne vizibil într-o zonă gray-out, separată de o linie de cut-off. Blueprint-urile vechi primesc tag-ul Outdated și pot fi inspectate, actualizate sau folosite în challenge-uri.

Reputation se păstrează, dar pragurile contractelor cresc între generații. Faptul că firma domina generația veche nu îi oferă automat acces la cele mai grele proiecte ale generației noi.

## 29.3 Generații alternative

Alternativele reprezintă specializări tehnologice comparabile, nu o ordine istorică paralelă completă. Exemple:

- RISC sau CISC;
- vector compute sau scalar performance;
- general-purpose CPU sau accelerator-heavy;
- air optimized sau liquid optimized facility;
- package monolitic sau chiplet.

Unele alegeri se exclud atunci când tehnologia o justifică. Altele pot coexista în blueprint-uri diferite.

# 30. Museum

Museum păstrează fiecare generație și Architecture Breakthrough finalizată.

Pentru fiecare exponat, jucătorul vede:

- snapshot-ul grid-ului;
- blueprint-urile folosite;
- compute teoretic și util;
- power draw;
- temperatură medie și maximă;
- graficele ultimului benchmark;
- costul total;
- task-urile importante;
- anul finalizării;
- informații istorice;
- deciziile companiei;
- buton pentru Historical Challenge.

Muzeul oferă bonusuri mici de reputație și obiective de colecție. El nu devine o sursă mare de multiplicatori.

# 31. Fundamental Insights și Singularity Data

Fundamental Insights este numele final pentru meta-currency. El exprimă cunoașterea păstrată după reset.

Singularity Data este dataset-ul produs în proiectul final. Calitatea lui depinde de:

- capitole finalizate;
- benchmark-uri;
- challenge-uri;
- diversitatea arhitecturilor;
- stabilitatea sistemului final;
- research opțional;
- proiecte istorice;
- decizii etice și de companie.

La Boundary Reset, Singularity Data se convertește în Fundamental Insights.

Upgrade-urile finite oferă funcții:

- un task slot suplimentar;
- telemetry avansată mai devreme;
- auto-routing deblocat mai devreme;
- un blueprint păstrat ca Legacy Template;
- o ramură de research cunoscută;
- Historical Challenges noi;
- un bailout alternativ;
- un slot Supporting Technology suplimentar.

După cumpărarea funcțiilor finite, Endless Insight oferă bonusuri mici, de ordinul unu până la două procente per nivel, cu diminishing returns.

# 32. Challenge-uri

Challenge-urile apar în campanie, Museum și endless mode.

Tipuri principale:

- Compute Cup, cel mai mare Useful Compute cu reguli fixe;
- Fixed Budget;
- Low Power;
- No Active Cooling;
- Legacy Hardware;
- One Blueprint Only;
- Deadline Chain;
- Reliability Mode;
- Public Company Crisis;
- Speedrun Generation;
- Historical Reconstruction;
- No Overclock;
- Manual Routing Only.

Challenge-urile oferă achievements, Museum variants, cosmetic UI themes și unele funcții meta. Ele nu trebuie să fie obligatorii pentru finalizarea primei campanii.

# 33. Interfața principală

## 33.1 Structura recomandată

| Zonă | Funcție |
|---|---|
| Header | Era, an, generație, obiectiv, Pause, viteze, Cash, Useful Compute, Power și Temperature. |
| Left Rail | Build, Operations, Research, Company, Museum, Achievements și Settings. |
| Center Workspace | Canvas-ul sau ecranul principal al modului selectat. |
| Bottom Build Tray | Inventory, Catalog, filtre, prebuild-uri și blueprint-uri în Build Mode. |
| Right Operations Stack | Task-uri active, Telemetry și Inspector. |
| Event Log | Panou restrângibil, sub canvas sau în drawer. |

![Mockup conceptual pentru Build Workspace](generated_images/exec-32576efc-4280-438a-b317-3e71bc3241d1.png)

Figura 1. Explorare vizuală pentru un ecran modern de Build. Valorile, numărul de task-uri și componentele din imagine sunt orientative. Grila centrală, build tray-ul și separarea panourilor reprezintă direcția recomandată.

## 33.2 Cum evităm schimbarea repetată de panouri

Build Mode nu cere jucătorului să intre într-un shop separat. Catalogul și inventarul apar în bara extensibilă de jos. Jucătorul cumpără și plasează într-o singură acțiune.

Fluxul este:

1. selectează o piesă din Inventory sau Catalog;
2. vede costul, compatibilitatea și forma pe grilă;
3. o plasează;
4. ține o tastă pentru plasare repetată;
5. Undo anulează ultima serie.

Research, Company și Museum folosesc centrul ecranului deoarece au nevoie de spațiu. Starea Build Mode rămâne păstrată. O miniatură live și indicatorii critici permit monitorizarea sistemului. Escape sau shortcut-ul B revine instant la grilă.

Floating windows apar numai unde ajută:

- comparație între două componente;
- Blueprint Manager;
- rezultat de benchmark;
- contract details;
- grafice detașate.

Panourile principale pot fi redimensionate în limite sigure. Layout Presets readuc rapid configurația Build, Operations sau Diagnostics.

## 33.3 Telemetry Panel

Panoul din dreapta are trei preset-uri:

1. Compact, arată numai alerte și bottleneck-ul principal.
2. Standard, arată toate resursele și task-urile active.
3. Diagnostics, adaugă grafice, formule și istoric.

Jucătorul poate restrânge întregul panou sau numai secțiunea Graphs. Nu recomand afișarea permanentă a tuturor resurselor într-un chenar foarte mic. Valorile ar deveni greu de citit și ar concura cu grila.

Grafice recomandate:

- Useful Compute;
- power draw și headroom;
- temperatură medie și maximă;
- memory bandwidth;
- compute allocation;
- retry rate;
- task progress;
- coherence, în era quantum.

## 33.4 Achievements

Achievements au un ecran separat cu rânduri și coloane clare. Deblocarea produce un popup în dreapta sus, cu sunet scurt și animație satisfăcătoare. Categoriile includ History, Engineering, Economy, Challenges, Hidden și Endgame.

# 34. Info Lens și Encyclopedia

ATOM Inc. permite acces la informații utile prin interacțiunea directă cu atomii. OVERCLOCK adaptează ideea într-o funcție mai potrivită pentru desktop.

Jucătorul apasă I, dublu-click sau Info pe o componentă, un tag ori un termen. Info Lens are patru niveluri:

1. Quick, ce face obiectul în una sau două propoziții.
2. Engineering, statistici, compatibilitate și bottleneck-uri.
3. Formula, contribuția exactă la Useful Compute, power și temperature.
4. History, articolul din Encyclopedia și legături către tehnologii asociate.

Tag-urile din task-uri sunt interactive. Apăsarea pe PARALLEL explică ce hardware beneficiază și arată configurațiile jucătorului care se potrivesc.

# 35. Direcția vizuală

## 35.1 Principii

- dashboard dens, dar nu sufocant;
- canvas-ul rămâne zona dominantă;
- panourile se deblochează gradual prin tutorial;
- efect Matrix de intensitate medie;
- scanlines și glitch controlate;
- animații mici, repetabile și ieftine;
- efectele nu ascund cifrele sau starea sistemului.

## 35.2 Culori

- cyan și albastru pentru compute și data;
- portocaliu pentru power și overclock;
- roșu pentru temperature critică;
- verde pentru validare și progres;
- mov pentru research și quantum;
- gri pentru hardware inactiv sau outdated.

Starea nu se transmite exclusiv prin culoare. Pictogramele, pattern-urile și etichetele rămân vizibile chiar fără un mod color-blind dedicat.

## 35.3 Evoluția între ere

Structura UI rămâne stabilă. Materialele vizuale se schimbă:

- 1940s și 1950s, instrumente analogice, hârtie, amber CRT;
- mainframe era, terminale verzi și panouri industriale;
- microprocessor era, vector graphics și PCB;
- network era, rack-uri albastre și trafic de rețea;
- modern era, dashboard tehnic curat;
- beyond silicon, materiale și fluxuri specifice ramurii;
- quantum, mov controlat, criogenie și coherence visualization.

# 36. Audio

Muzica este ambientală și discretă. Fiecare capitol primește un strat sonor diferit, fără a schimba complet identitatea jocului.

Sunete reactive:

- ventilatoare care cresc cu sarcina;
- pompe și coolant;
- relee și terminale în erele timpurii;
- task complete;
- thermal warning;
- benchmark start și pass;
- Generation Transition;
- achievement popup;
- coherence warning.

Jucătorul poate regla separat Music, UI, Machinery și Alerts.

# 37. Tutorialul

Primele zece minute:

1. alocă human computers unui calcul;
2. observă un deadline;
3. construiește sursa de power;
4. plasează modulul de compute;
5. conectează memoria;
6. acceptă un proiect meteorologic;
7. observă că proiectul întârzie;
8. activează Boost;
9. vede temperatura crescând;
10. instalează cooling;
11. finalizează proiectul;
12. primește Cash și Research Data;
13. salvează primul blueprint;
14. deblochează research-ul pentru tranzistor.

Tutorialul poate fi omis. Jucătorul poate alege Simple Guidance sau Engineering Guidance. Tooltips au mod Simple și Advanced.

Assisted Mode păstrează aceleași formule și aceeași economie. El adaugă auto-suggestions, confirmări înaintea unui risc, placement ghost optimizat și reguli de automatizare gata configurate. Nu oferă multiplicatori ascunși.

[[PAGEBREAK]]

# 38. Platformă și tehnologie

## 38.1 Recomandarea finală

Jocul va fi construit web-first cu TypeScript. Aceeași versiune de producție va rula:

1. în browser pe itch.io;
2. într-o aplicație Windows creată cu Tauri;
3. mai târziu, în pachete Linux și macOS;
4. eventual, pe Steam după finalizarea jocului.

Jucătorul care descarcă versiunea Windows nu deschide un fișier HTML. El instalează sau pornește o aplicație normală.

## 38.2 Stack recomandat

| Strat | Tehnologie | Motiv |
|---|---|---|
| Limbaj | TypeScript | Tipuri pentru simulator, save-uri și fișiere de conținut. |
| Build | Vite | Build web rapid și output static pentru itch.io. |
| UI | React | Panouri, meniuri, research tree, task-uri și inspector. |
| Canvas | PixiJS 8 | Grilă 2D, heatmap, conexiuni, particule și animații prin WebGL. |
| Grafice | uPlot | Serii temporale compacte și rapide. |
| Validare date | Zod | Validarea JSON, save și migrații. |
| Traduceri | i18next și react-i18next | Română și engleză, organizate pe namespace-uri. |
| Teste unitare | Vitest | Simulator, economie, research și tranziții. |
| Teste end-to-end | Playwright | Tutorial, save/load și fluxurile UI critice. |
| Desktop | Tauri 2 | Instalator și aplicație desktop din același frontend. |

React nu controlează fiecare tile. PixiJS redă canvas-ul. Simulatorul rulează separat de ambele.

## 38.3 De ce Tauri

Tauri poate împacheta același frontend în instalatoare pentru Windows, macOS și Linux. Pe Windows folosește WebView2. Windows 10 recent și Windows 11 îl includ, iar installer-ul poate gestiona runtime-ul unde lipsește.

Avantaje pentru acest proiect:

- pachet mai mic decât o aplicație care include propriul Chromium;
- consum mai mic de memorie;
- aceeași bază TypeScript pentru browser și desktop;
- export Windows normal pentru itch.io;
- acces viitor la fișiere locale, screenshot-uri și modding.

Electron rămâne fallback-ul dacă testele arată diferențe grave între webview-uri. Electron include Chromium și oferă randare mai uniformă, dar crește dimensiunea și consumul de memorie.

## 38.4 Alte opțiuni analizate

| Opțiune | Avantaj | Dezavantaj | Verdict |
|---|---|---|---|
| Web și PWA | Cel mai simplu build | Versiunea descărcată se simte mai puțin ca un joc desktop | Bun pentru prototip, insuficient singur. |
| Electron | Chromium consistent | Pachet și RAM mai mari | Fallback. |
| Tauri | Pachet mic și aceeași bază web | Folosește webview-ul sistemului | Recomandat. |
| Godot | Engine complet și export desktop/web | Dashboard-ul dens și instrumentele web cer mai multă adaptare | Nu pentru prima implementare. |
| Unity | Tooling cunoscut și export pe multe platforme | WebGL mai greu, UI complex și build mai mare pentru acest tip de joc | Nu este recomandat pentru OVERCLOCK. |

# 39. Arhitectura software

## 39.1 Separarea simulatorului

Simulatorul trebuie să poată rula fără UI. Aceasta permite teste, balansare și mii de run-uri automate.

Structură recomandată:

```text
src/
  app/
  sim/
    systems/
    formulas/
    commands/
    events/
    save/
  content/
    hardware/
    tasks/
    research/
    eras/
    events/
  grid/
    model/
    routing/
    thermal/
    blueprints/
  rendering/
    pixi/
    effects/
    heatmap/
  ui/
    panels/
    workspaces/
    charts/
    inspector/
  localization/
  audio/
  devtools/
  tests/
```

## 39.2 Tick system

Simulatorul folosește fixed tick de 10 actualizări pe secundă. UI-ul nu trebuie să re-randeze integral la fiecare tick.

Ordinea unui tick:

1. citește comenzile jucătorului;
2. calculează power;
3. calculează workload allocation;
4. actualizează temperatura;
5. aplică throttling și stability;
6. calculează Useful Compute;
7. avansează task-uri și research;
8. actualizează economie și mentenanță;
9. emite evenimente;
10. creează snapshot-ul necesar UI-ului.

Simularea trebuie să fie deterministă pentru același seed și aceleași comenzi. Evenimentele probabilistice folosesc un generator pseudo-aleator controlat.

## 39.3 State și UI

Simulatorul păstrează state-ul autoritativ în obiecte serializabile. React primește numai slice-urile de care are nevoie. PixiJS primește un view model pentru elementele vizibile.

Această separare evită re-randarea a sute de tile-uri când se schimbă o singură valoare din header.

## 39.4 Event bus

Un event bus tipizat transmite evenimente precum:

- THERMAL_WARNING;
- TASK_PHASE_COMPLETE;
- BENCHMARK_FAILED;
- BLUEPRINT_UPDATED;
- RESEARCH_UNLOCKED;
- COMPANY_INSOLVENT;
- ACHIEVEMENT_UNLOCKED.

Event bus-ul nu înlocuiește state-ul. El transmite schimbări și efecte către UI, audio și log.

# 40. Save, import și date

## 40.1 Save local

Browser-ul folosește IndexedDB. Versiunea Tauri păstrează aceeași structură logică și poate adăuga o copie locală pe disc. Jocul salvează automat, păstrează trei rotații și creează checkpoint-uri la tranziții.

## 40.2 Export și import

Jucătorul poate exporta un fișier JSON comprimat și îl poate importa în altă versiune. Importul verifică:

- schema;
- versiunea;
- integritatea;
- conținutul lipsă;
- migrațiile necesare.

## 40.3 Versionare

Fiecare save include:

- saveVersion;
- contentVersion;
- createdAt;
- lastPlayedAt;
- seed;
- campaign state;
- settings;
- achievements;
- Museum snapshots;
- checksum.

Migrațiile sunt testate automat. Un save vechi nu se suprascrie înainte de validarea copiei migrate.

## 40.4 Conținut editabil

Hardware-ul, task-urile, research-ul, erele și evenimentele sunt definite în JSON. Dezvoltatorul poate modifica datele fără a rescrie simulatorul. Build-ul trebuie regenerat pentru versiunea browser, dar codul TypeScript nu se recompilă conceptual pentru fiecare valoare de balans.

Mod support nu intră în prima versiune. Structura data-driven îl face posibil ulterior.

## 40.5 Asset-uri și buget

Producția pornește cu buget aproape zero. UI-ul folosește CSS, forme PixiJS, iconuri open-source și elemente generate intern. Imaginile AI pot produce concept art, texturi și variații, dar nu înlocuiesc diagramele tehnice exacte. Se cumpără asset-uri numai când economisesc clar timp și au licență potrivită pentru distribuție.

# 41. Analytics și statistici

În prima versiune nu se colectează analytics extern. Jocul păstrează local:

- timpul pe generație;
- numărul de tranziții;
- cauzele bottleneck-urilor;
- task-uri finalizate și abandonate;
- configurații de benchmark;
- crash-uri de simulare;
- economy graph;
- tutorial steps.

Jucătorul sau testerul poate exporta un Playtest Report fără date personale. Analytics online poate fi adăugat mai târziu numai prin opt-in.

# 42. Publicarea pe itch.io

itch.io poate găzdui direct proiecte HTML, JavaScript și CSS într-un iframe. Pentru browser se încarcă un ZIP cu `index.html` la rădăcină.

Aceeași pagină poate avea fișiere descărcabile separate:

- Play in browser;
- Windows installer;
- Windows portable build, dacă testarea justifică;
- Linux și macOS ulterior.

Versiunea Windows recomandată folosește installer NSIS produs de Tauri. Jucătorul descarcă un fișier `.exe`, nu pornește manual HTML-ul.

Canale de upload recomandate:

- `html5`;
- `windows-installer`;
- `windows-portable`;
- `linux`;
- `macos`.

# 43. Rezoluție și control

## 43.1 Rezoluții

| Nivel | Țintă |
|---|---|
| Rezoluție principală de design | 1920 × 1080. |
| Rezoluții obligatorii de test | 1600 × 900 și 1366 × 768. |
| Minimum funcțional | 1280 × 720, cu Telemetry în Compact și panouri restrânse. |
| Browser | Buton Fullscreen și layout care tolerează bara browserului. |

Interfața se proiectează în primul rând pentru 1920 × 1080. La 1600 × 900 și 1366 × 768 păstrează toate funcțiile principale, cu panouri redimensionate. La 1280 × 720 trece în configurația minimă funcțională, restrânge secțiunile secundare și mută graficele extinse în tab-uri sau ferestre detașate.

## 43.2 Control

- mouse și tastatură;
- drag-and-drop și click-to-place;
- shortcut-uri complete;
- selection box;
- copy, paste, rotate, undo și redo;
- zoom și pan;
- touch exclus din prima versiune;
- reduced motion;
- tutorial și tooltips configurabile.

# 44. Performanță

Ținta explicită este ca sistemul cu Intel i7-2600 și GTX 1050 să ruleze jocul fără probleme în 1080p cu setări normale sau reduse.

Bugete recomandate:

- 60 FPS pe GTX 1050 la 1080p;
- 30 FPS stabil în Reduced Effects pe hardware integrat compatibil WebGL2;
- sub 4 ms pentru un tick normal de simulare;
- sub 12 ms pentru frame-ul de randare la 60 FPS;
- maximum 5 până la 10 actualizări UI pe secundă pentru cifre;
- grafice actualizate la 1 până la 2 Hz;
- maximum 2.000 de obiecte vizibile detaliate înainte de agregare.

Tehnici obligatorii:

- object pooling pentru particule și pulse-uri;
- texture atlases;
- batching PixiJS;
- cache pentru zone statice;
- dirty regions pentru heatmap;
- agregarea rack-urilor la zoom-out;
- virtualizarea listelor;
- lazy loading pentru Museum, Encyclopedia și Quantum visuals;
- evitarea filtrelor blur costisitoare;
- downsampling pentru grafice;
- profiling pe hardware-ul țintă după fiecare milestone.

Reduced Effects schimbă:

- frame cap la 30 sau 45 FPS;
- densitatea particulelor;
- pulse frequency;
- scanlines și glitch;
- rezoluția heatmap-ului;
- render scale;
- pseudo-3D quantum view în variantă 2D.

Heatmap-ul și alertele rămân funcționale. Setarea nu ascunde informații de gameplay.

# 45. Leaderboards

Într-un joc client-side, un leaderboard global poate fi falsificat ușor. De aceea planul are trei etape:

1. Local records și export de rezultat în prima versiune.
2. Challenge replay care salvează seed-ul și comenzile.
3. Server verification și leaderboard global după ce există infrastructură și anti-cheat de bază.

Jucătorul poate folosi nume local sau identificator opțional. Contul nu este necesar pentru campanie.

# 46. Vertical Slice 0.1

## 46.1 Conținut

- perioada 1946 până în 1948;
- un prolog Human Computers;
- o singură generație complet jucabilă, Vacuum Tube System;
- transistorul ca reveal final, nu ca a doua generație completă;
- un Facility Canvas;
- 12 tipuri de module;
- 8 task-uri;
- 10 noduri de research;
- două task slots;
- cele patru profiluri de overclock;
- temperatură locală și globală;
- heatmap;
- un blueprint de subansamblu;
- un benchmark Peak și unul Sustained;
- save, load, export și import;
- tutorial de 10 minute;
- română și engleză;
- un ecran Museum pentru sistemul final.

## 46.2 Durată

Durată țintă: 45 până la 75 de minute. Primul task trebuie finalizat în 2 până la 3 minute. Primul bottleneck apare în 4 până la 6 minute. Primul blueprint apare în 10 până la 15 minute.

## 46.3 Criterii de succes

Vertical slice trece testul dacă:

- un tester poate explica de ce Useful Compute diferă de Theoretical Compute;
- poate construi două configurații valide diferite;
- folosește Boost fără a considera cooling-ul o corvoadă;
- înțelege task tags;
- revine voluntar la grid pentru optimizare;
- finalizează sesiunea fără o pauză moartă mai lungă de 5 minute;
- jocul rulează stabil pe hardware-ul țintă.

# 47. Roadmap de producție

## Faza 0, Design Lock

- finalizează acest GDD;
- definește nomenclatura;
- creează schema JSON;
- stabilește stilul UI;
- face prototipuri pentru grilă, heatmap și Telemetry.

## Faza 1, Headless Simulator

- resource model;
- task allocation;
- power și thermal;
- overclock;
- research;
- economie;
- save schema;
- bot simplu pentru balans.

## Faza 2, Build Workspace

- Pixi grid;
- drag-and-drop;
- routing;
- inspector;
- heatmap;
- blueprint;
- undo și redo.

## Faza 3, Vertical Slice Content

- prolog;
- 12 module;
- task-uri;
- research;
- tutorial;
- audio;
- achievements;
- Museum snapshot.

## Faza 4, Browser Release Candidate

- optimizare;
- localizare;
- save migration;
- browser compatibility;
- itch.io page;
- playtest extern.

## Faza 5, Desktop Package

- integrare Tauri;
- Windows installer;
- file export;
- setări grafice;
- test pe hardware slab;
- update flow.

## Faza 6, Extinderea campaniei

Capitolele se adaugă numai după validarea buclei. Fiecare capitol trebuie să aducă o problemă nouă, nu doar numere mai mari.

# 48. Balansare și debug

Consola internă trebuie să includă:

```text
time 1
time 2
time 4
time 100
pause
simulate 1h
cash add X
research add X
research unlock ID
task complete ID
task phase ID N
force generation
force breakthrough
force boundary
heatmap toggle
thermal stress X
stability set X
benchmark run ID
blueprint validate ID
blueprint compare A B
export snapshot
validate save
run bots 1000
detect deadtime
detect hardwall
report bottlenecks
profile sim
profile render
```

Simulatorul automat trebuie să detecteze:

- perioade fără acțiuni utile;
- costuri imposibile;
- strategii dominante;
- loop-uri de datorie;
- task-uri care nu pot fi finalizate;
- research branches blocate;
- blueprint-uri care depășesc limitele;
- thermal runaway inevitabil;
- tranziții prea rapide;
- multiplicatori meta care rup economia.

# 49. Riscuri și soluții

| Risc | Soluție |
|---|---|
| Prea multe sisteme simultan | Deblocare graduală, tutorial și workspaces contextuale. |
| Grid obositor | Blueprint-uri ierarhice, prebuild-uri, copy, versioning și auto-route. |
| Cooling repetitiv | Cooling automat și control prin arhitectură și reguli. |
| Realism care blochează distracția | Realism selectiv. O regulă rămâne numai dacă produce o decizie. |
| UI sufocant | Patru valori permanente, Telemetry cu trei preset-uri și panouri restrângibile. |
| Un singur build optim | Suitability, task tags și compromisuri reale. |
| Rebuild dureros | Compatible, Retrofit-able și Obsolete, cu acțiune Recommended. |
| Quantum pare alt joc | Canvas separat, dar workflow hibrid și infrastructură clasică permanentă. |
| Beyond Silicon pare cosmetic | Primary Architecture lungă, workload-uri și probleme distincte. |
| Istorie rigidă | Ordine aproximativă, posibilitatea de a avansa devreme și ramuri alternative. |
| Damage frustrant | Damage permanent numai în Reliability Challenge. |
| Leaderboard falsificat | Local records, replay și verificare ulterioară pe server. |
| Scope prea mare pentru o persoană | Vertical slice de o generație și extindere numai după test. |
| Lag pe PC slab | PixiJS, simulare agregată, profilare și Reduced Effects. |
| Save incompatibil | Schema versionată, migrații și checkpoint-uri. |

# 50. Definition of Done pentru planificare

Planificarea de bază este suficientă pentru prototip atunci când există:

- schema resurselor;
- formula Useful Compute;
- modelul thermal;
- schema HardwareModule;
- schema Task;
- schema ResearchNode;
- schema Blueprint;
- schema Generation și Chapter;
- layout-ul Build Workspace;
- lista completă pentru vertical slice;
- curbele economice inițiale;
- criteriile benchmark-urilor;
- stilul vizual și audio;
- planul de testare.

Următorul document tehnic trebuie să fie Technical Design Document pentru vertical slice. El va conține tipurile TypeScript, comenzile simulatorului, fișierele JSON și contractele dintre React, PixiJS și simulator.

# 51. Surse de referință

1. Computer History Museum, The Silicon Engine Timeline, invenția tranzistorului în 1947: https://www.computerhistory.org/siliconengine/timeline/
2. ASML, EUV lithography systems și sursa de lumină cu picături de staniu: https://www.asml.com/products/euv-lithography-systems
3. ASML, Light and lasers, detalii despre pre-pulse, main pulse și 50.000 de cicluri pe secundă: https://www.asml.com/technology/lithography-principles/light-and-lasers
4. Folding@home, istoria proiectului început în 2000: https://foldingathome.org/science/folding
5. BOINC, volunteer computing: https://boinc.berkeley.edu/
6. IBM, quantum-centric supercomputing și integrarea QPU cu CPU, GPU, rețele și storage: https://www.ibm.com/quantum/blog/qcsc-software
7. IBM Research, reference architecture pentru quantum-centric supercomputing: https://research.ibm.com/blog/quantum-centric-supercomputing-system-reference-architecture
8. Nature, progres și scepticism privind topological qubits: https://www.nature.com/articles/d41586-026-01788-y
9. Nature, parity measurement pentru arhitecturi Majorana: https://www.nature.com/articles/s41586-024-08445-2
10. IBM Research, carbon nanotube transistor technology: https://research.ibm.com/publications/carbon-nanotube-transistor-technology-for-extending-logic-roadmap
11. Intel, integrated silicon photonics: https://www.intel.com/content/www/us/en/research/integrated-photonics.html
12. IBM Research, neuromorphic computing: https://research.ibm.com/blog/what-is-neuromorphic-or-brain-inspired-computing
13. AIP Advances, energy limits și reversible computing: https://pubs.aip.org/aip/aed/article/1/3/030902/3364907/Industry-perspective-Limits-of-energy-efficiency
14. PixiJS 8, introduction și performance tips: https://pixijs.com/8.x/guides/getting-started/intro
15. Tauri 2, distribuție și Windows installer: https://v2.tauri.app/distribute/
16. itch.io, încărcarea jocurilor HTML5: https://itch.io/docs/creators/html5
17. Vite, production build și browser support: https://vite.dev/guide/build
18. i18next, documentație: https://www.i18next.com/
19. ATOM Inc., descrierea oficială și accesul la informații despre atomi: https://apps.apple.com/us/app/idle-atom-inc-element-merge/id6676996063

# 52. Verdict final

Direcția este viabilă dacă dezvoltarea începe cu simulatorul și o singură generație. Sistemul ierarhic de blueprint-uri rezolvă trecerea de la micromanagement la management de facilități. Task tags fac cerințele lizibile. EUV oferă un lanț de progresie puternic. Beyond Silicon creează replayability prin ramuri reale. Quantum rămâne conectat logic la infrastructura clasică.

Stack-ul TypeScript, React, PixiJS, Vite și Tauri oferă combinația potrivită pentru browser, aplicație Windows, efecte vizuale și performanță pe hardware modest. Riscul principal nu este tehnologia. Riscul principal este volumul de conținut. Vertical slice-ul de o generație trebuie să dovedească bucla înainte de extinderea campaniei.
