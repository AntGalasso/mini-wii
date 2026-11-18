# TASK A → B — STEP 3 / 4

**Obiettivo dello step:** creare `public/tv.html` — la "TV" a schermo intero con
URL + **QR code offline** per collegare il telefono e un **mirino fluido per ogni
controller**, mosso in tempo reale dal giroscopio — più il supporto lato server
necessario (`lib/qr.js`, `GET /qr.svg`, `GET /net-info`, `slot` nell'elenco
controller).

---

## 0. QA dello STEP 2 (verificato da A)

Stato reale del repository:

- `git log -n 2`: `0daa652` (`auto(ciclo-1): sync automatico fine turno B`, contiene
  `public/controller.html` 848 righe + micro-fix server + smoke test) e `7cf7257`
  (STEP 1). Working tree pulito.
- `npm test` → **verde**, 12 check `OK`, `SMOKE TEST PASSED`, exit 0, inclusa la
  nuova riga `OK tv:presence iniziale al controller`.
- `server.js` invia `tv:presence` iniziale al solo controller appena registrato
  (riga ~193): micro-fix corretto, ramo idempotente e `notifyPresence()` intatti.
- `public/controller.html`: contratto STEP 2 rispettato (permessi con
  `requestPermission()` sincrono nel gesto, fallback 1500 ms, filtro
  passa-basso 0.25/0.75, invio max 60 Hz, pointer capture sul touch-pad,
  vibrazione guarded, `controller:bye` su `pagehide`, nessun asset esterno,
  nessun `alert()`).

**STEP 2: SUPERATO.** Due sole note di processo, non di codice:

1. `.bus/REPORT_B.md` è illeggibile: contiene il dump di una TUI (barra di stato,
   `ZlibError`, prompt del terminale) al posto della relazione. In questo turno il
   report deve essere markdown strutturato (vedi §7).
2. `knowledge.md` e i task precedenti indicano due messaggi di commit diversi:
   d'ora in poi vale **quello indicato al §8** di questo file.

---

## 1. Perimetro

In questo step si consegnano **solo**:

```
lib/qr.js            (nuovo, generatore QR offline, zero dipendenze runtime)
public/tv.html       (nuovo, autosufficiente)
server.js            (modifiche puntuali elencate al §2)
scripts/smoke-test.js (nuovi check §5)
package.json         (SOLO devDependency jsqr, per la verifica del QR)
```

NON creare ancora i minigiochi (STEP 4) e NON scrivere `README.md` (STEP 4).
Non toccare `public/controller.html` (solo se serve un fix reale: in tal caso
dichiararlo nel report e non cambiare il protocollo). Non toccare
`public/.gitkeep`. Non riscrivere `.bus/METAPROMPT.md` né `knowledge.md`.

---

## 2. Lavoro lato server (prima di `tv.html`)

### 2.1 `lib/qr.js` — generatore QR offline

CommonJS, puro JavaScript, **zero dipendenze**, `'use strict'`. Nessun uso di
Buffer/crittografia: solo aritmetica su array/stringhe UTF-8-agnostiche (vedi
codifica byte sotto).

API richiesta:

```js
module.exports = { encode, toSvg, MAX_BYTES };
// encode(text) -> { version, ecc: 'M', mask, size, modules: boolean[][] }
//                 modules[y][x] === true  => modulo scuro
// toSvg(text, { scale, border }) -> string SVG completa
// MAX_BYTES = 200 (limite di input accettato; oltre -> throw RangeError)
```

Requisiti tecnici vincolanti:

- **Modalità byte** (mode indicator `0100`). Codifica dei caratteri: per ogni code
  point, se `<= 0x7F` 1 byte, `<= 0x7FF` 2 byte, `<= 0xFFFF` 3 byte, altrimenti
  4 byte (UTF-8 scritto a mano; `TextEncoder` non è disponibile in tutti i
  contesti npm script, non usarlo).
- **ECC level M**, versioni **1–10** scelte automaticamente in base alla
  lunghezza (la più piccola che contiene i dati). Conteggio caratteri: 8 bit per
  v1–9, 16 bit per v10+.
- Terminatore `0000`, padding a byte con `0xEC`/`0x11`, Reed–Solomon su GF(256)
  con polinomio `0x11D`, **interleaving** standard dei blocchi.
- Tabella blocchi ECC M da usare (total codewords, ecc per blocco, blocchi/ dati):

  | v | totali | ecc/blocco | blocchi × dati |
  |---|--------|------------|----------------|
  | 1 | 26  | 10 | 1×16 |
  | 2 | 44  | 16 | 1×28 |
  | 3 | 70  | 26 | 1×44 |
  | 4 | 100 | 18 | 2×32 |
  | 5 | 134 | 24 | 2×43 |
  | 6 | 172 | 16 | 4×27 |
  | 7 | 196 | 18 | 4×31 |
  | 8 | 242 | 22 | 2×38 + 2×39 |
  | 9 | 292 | 22 | 3×36 + 2×37 |
  |10 | 346 | 26 | 4×43 + 1×44 |

- Pattern di funzione: finder 7×7 + separatori, timing, dark module a
  `(8, 4·v+9)`, alignment pattern ai centri
  v1 nessuno, v2 `[6,18]`, v3 `[6,22]`, v4 `[6,26]`, v5 `[6,30]`, v6 `[6,34]`,
  v7 `[6,22,38]`, v8 `[6,24,42]`, v9 `[6,26,46]`, v10 `[6,28,50]`
  (combinazioni, esclusi i tre angoli finder).
- Format info 15 bit BCH (ECC M = `00`), mask `0x5412`; version info 18 bit
  (polinomio `0x1F25`) per v ≥ 7.
- **8 maschere**, penalità standard (regole 1–4) e scelta della maschera con
  penalità minima. Output deterministico: stesso input ⇒ stessa matrice.
- `toSvg`: `viewBox="0 0 (size+2·border) (size+2·border)"`,
  `shape-rendering="crispEdges"`, sfondo bianco `<rect>` a piena area, **un
  `<rect>` per ogni modulo scuro** (niente path compressi: il test conta i
  `<rect>`), attributi `width`/`height` = lato in pixel (`scale` × viewBox).
  `scale` default 6, `border` default 4.

### 2.2 Rotte HTTP nuove in `server.js`

```
GET /qr.svg?data=<testo>&scale=<1..12>&border=<0..8>
  - data mancante -> 400 text/plain "parametro data mancante"
  - data.length > 200 -> 400 text/plain "parametro data troppo lungo"
  - errore di encode -> 500 text/plain "QR non generabile"
  - ok -> 200, Content-Type "image/svg+xml; charset=utf-8",
          Cache-Control "public, max-age=300", body = toSvg(...)
          (scale/border fuori range o non numerici -> default, mai 400)

GET /net-info   -> 200 JSON
  { port: <porta effettiva>, urls: ["http://192.168.1.10:3000", ...],
    primary: "http://192.168.1.10:3000" | null }
  - urls: tutti gli IPv4 non-internal, schema http, porta effettiva;
  - primary: primo elemento di urls, null se urls è vuoto.
```

Refactor richiesto: estrarre la raccolta degli IPv4 in una helper
`lanUrls(port)` usata **sia** da `/net-info` **sia** dal logging di avvio, senza
cambiare il testo dei log esistenti (`TV: ...` / `Telefono: ...`).

### 2.3 `slot` nell'elenco controller

In `controllerList()` aggiungere `slot: c.slot` all'oggetto restituito
(campi: `id`, `name`, `connectedAt`, `slot`). Nessun'altra modifica al
protocollo: nomi eventi, campi di `motion`/`button`/`calibrate`, porta e
contratto di `start()` restano identici. `slot` è additivo: aggiornare il
commento del protocollo solo se ne esiste uno.

---

## 3. `public/tv.html` — struttura

File **unico e autosufficiente**: HTML + CSS + JS inline, nessun CDN, nessuna
immagine esterna, nessun font esterno (system font stack), nessun asset oltre a
`/socket.io/socket.io.js` e alle rotte del server (`/qr.svg`, `/net-info`).
Ammesso solo `<link rel="icon" href="data:,">` per evitare il 404 del favicon.

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  (nessun `user-scalable=no`: è una pagina da PC/TV).
- `html, body { height: 100%; margin: 0; overflow: hidden; }`, tema scuro con
  vignettatura e griglia di profondità in CSS, `100dvh` con fallback `100vh`.
- `cursor: none` quando il mouse è fermo da 2,5 s (ripristinato al `mousemove`).
- Testi in italiano.

Dall'alto verso il basso / per livelli:

1. **Top bar** (`position: fixed`, z-index alto): brand `MINI-WII` + sottotitolo
   `WEB CONSOLE`; al centro stato server (`#tv-status`: `Connessione…`,
   `TV online`, `Riconnessione…`); a destra badge `protocollo 1` e contatore
   `#controller-count` (`0 controller` / `1 controller` / `N controller`).
2. **Card di collegamento** `#join-card`, semitrasparente, centrata in alto:
   titolo `Collega il telefono`, URL grande in monospace `#join-url`
   (selezionabile), QR `#qr` (`<img>` con `alt` descrittivo), nota
   `Scansiona il QR o apri l'URL dal telefono`, pulsante `#btn-copy`
   `Copia link` (guarded: `navigator.clipboard` può mancare su HTTP; in tal caso
   seleziona il testo dell'URL e mostra il toast `Copia manuale: link selezionato`).
   La card si **riduce** (classe `.compact`: QR più piccolo, solo URL) quando
   almeno un controller è connesso, e torna estesa quando non ce ne sono.
3. **Arena** `#arena` a tutto schermo: contiene i mirini, un alone radiale e, con
   zero controller, l'overlay `#idle-hint` (`Scansiona il QR per iniziare`).
4. **Riga badge controller** `#badges` in basso a sinistra: un chip per controller
   con pallino colorato, `Slot N`, nome e due indicatori `A` / `B`. Il chip
   appare su `controller:connected`/`tv:controller_list`, sparisce su
   `controller:disconnected`. Con molti controller i chip vanno a capo e restano
   dentro il viewport (max 8 chip visibili, oltre: `+N`).
5. **Toast** `#toasts` in basso al centro: max 3, auto-dismiss 1,8 s, nessun
   `alert()`.
6. **Footer/HUD** discreto: `#fps` (aggiornato a 1 Hz) e suggerimento
   `Muovi il Wiimote per puntare · Calibra per ricentrare`.

### 3.1 Mirino (una istanza per controller)

Elemento `.crosshair` creato dinamicamente, con CSS custom property `--c` per il
colore. Composizione: anello esterno Ø 34 px, due trattini, punto centrale Ø 6 px,
glow `box-shadow` del colore dello slot. Palette fissa per slot:
`1 #4ade80`, `2 #38bdf8`, `3 #f472b6`, `4 #fbbf24`, oltre `#a78bfa`.

- Posizionamento **solo** con `transform: translate3d(Xpx, Ypx, 0) translate(-50%,-50%) scale(s)`
  e `will-change: transform`; mai `left`/`top`.
- Classe `.stale` (opacità ridotta) se quel controller non invia `motion` da
  > 1500 ms.
- Su `controller:disconnected` il mirino viene rimosso subito (nessun fantasma).

---

## 4. `public/tv.html` — logica client (contratto vincolante)

### 4.1 Connessione

- `const socket = io({ transports: ['websocket', 'polling'] });` (nessun URL
  hardcoded).
- Su `connect`: `socket.emit('tv:hello', {})`; su `tv:ready`: salvare
  `id`/`protocol`, aggiornare lo stato, popolare l'elenco controller con
  `payload.controllers` (che ora include `slot`).
- Su `tv:controller_list`: sincronizzare chip e mirini con l'elenco ricevuto
  (creazione, rimozione, **ordine per slot**).
- Su `controller:connected`: aggiungere chip + mirino; toast
  `Slot N collegato`.
- Su `controller:disconnected`: rimuovere chip + mirino; toast
  `Slot N disconnesso`.
- Su `disconnect`: stato `Riconnessione…`, **svuotare** chip e mirini (nessun
  fantasma), mantenere la card estesa; alla `connect` successiva ri-emettere
  `tv:hello`.
- Su `error` con `code: 'already_registered'`: stato di errore visibile e **stop**
  dei tentativi di `tv:hello` (nessun loop).
- `motion`, `button`, `calibrate` ricevuti da id sconosciuto: **ignorati** in
  silenzio (l'elenco è la fonte di verità).

### 4.2 URL del telefono e QR

```js
// Host di rete (es. http://192.168.1.10:3000) -> usa location.origin.
// localhost/127.0.0.1/[::1] -> interroga /net-info e usa primary.
```

- Se `primary` è `null` o la fetch fallisce: fallback `location.origin`, senza
  eccezioni non gestite.
- URL finale = base + `/controller`; `#join-url` mostra l'URL; `#qr.src` =
  `/qr.svg?scale=6&data=` + `encodeURIComponent(url)`.
- Un solo `encodeURIComponent`, niente concatenazioni fragili, nessun carattere
  `&` non codificato nel parametro.

### 4.3 Movimento e fluidità (cuore dello step)

Il gestore `motion` **non tocca il DOM**: salva solo i valori di target nel
record del controller.

```
// Mappatura normalizzata dell'arena, documentata in un commento:
//   x = 0.5 + (gamma / 45) * GAIN_X
//   y = 0.5 - (beta  / 90) * GAIN_Y
//   GAIN_X = GAIN_Y = 0.42, dead zone |gamma| < 1.2 && |beta| < 1.2 (mantiene il target)
//   clamp finale in [0.02, 0.98] su entrambi gli assi
```

- Loop unico `requestAnimationFrame` per **tutti** i mirini.
- Smoothing indipendente dal frame rate:
  `k = 1 - Math.exp(-dt / 55)` con `dt` reale in ms limitato a 50 ms; ogni asse
  `current += (target - current) * k`.
- Il loop si ferma quando `document.hidden` e riparte su `visibilitychange`
  resettando `lastFrame` (nessun salto).
- Posizione in pixel calcolata da `arena.getBoundingClientRect()` cacheato e
  aggiornato su `resize`/`orientationchange`.
- `swing` dagli eventi `motion` (ultimo valore, decadimento esponenziale verso 0
  in 300 ms): `scale = 1 + Math.min(swing / 12, 0.35)`.
- `#fps` aggiornato **una volta al secondo** con media mobile; nessun
  `console.log` per frame o per campione.
- Se `dt` anomalo (tab tornata visibile) non deve esserci teletrasporto del
  mirino: `dt` clampato.

### 4.4 Tasti e calibrazione

- `button` con `state: 'down'` accende l'indicatore `A`/`B` del chip dello slot;
  `'up'` lo spegne; un `'up'` senza `'down'` non deve lasciare stati accesi.
- `button: 'CALIBRA'` **e** l'evento `calibrate` producono lo stesso effetto (il
  controller invia entrambi): ricentrare il mirino di quello slot con un
  passaggio fluido al centro (target `0.5, 0.5`, 300 ms) e toast
  `Slot N calibrato`. Effetto **idempotente**: due eventi ravvicinati non
  duplicano il toast oltre il limite di 3.
- Su `controller:disconnected` spegnere gli indicatori di quel chip.

### 4.5 Robustezza

- Nessun errore JS non gestito: handler Socket.io e DOM in `try/catch` dove
  ragionevole; nessun `alert()`; nessuna dipendenza dal fatto che il QR esista
  (se `/qr.svg` risponde 400/500: nascondere `#qr` e mostrare solo l'URL).
- Desktop e TV funzionano identici; test manuale possibile aprendo `/controller`
  sullo stesso PC e usando il touch-pad col mouse.
- Nessun asset esterno: solo `src`/`href` same-origin o `data:`.

---

## 5. Nuovi check in `scripts/smoke-test.js`

Aggiungere **dopo** i check esistenti (che devono restare invariati) e mantenere
`SMOKE TEST PASSED` + exit 0. Nessun check esistente può essere rimosso o
indebolito.

1. HTTP, usando `fetch` di Node 20 e la porta effettiva di `start(0)`:
   - `GET /tv` → 200, `content-type` contiene `text/html`, body contiene
     `id="crosshair"`, `id="qr"`, `id="join-url"`, `/socket.io/socket.io.js`.
     → `ok('GET /tv 200 text/html con mirino e QR')`
   - `GET /` con `redirect: 'manual'` → 302 e `location: /tv`.
     → `ok('GET / reindirizza a /tv')`
   - `GET /controller` → 200, body contiene `btn-permission` (regressione STEP 2).
     → `ok('GET /controller 200 (regressione STEP 2)')`
   - `GET /healthz` → 200 e JSON con `ok === true`.
     → `ok('GET /healthz JSON valido')`
2. `/net-info` → 200 JSON, `port === port` effettiva, `urls` array,
   `primary === null || typeof primary === 'string'`, ogni url inizia con
   `http://` e contiene `:${port}`.
   → `ok('GET /net-info coerente con la porta effettiva')`
3. `/qr.svg`:
   - `?data=<url del controller>` → 200, `content-type` contiene `image/svg+xml`,
     body inizia con `<svg`, contiene `shape-rendering="crispEdges"`.
   - numero di `<rect>` = numero di moduli scuri + 1 (sfondo), confrontato con
     `require('../lib/qr.js').encode(url)`.
   - senza `data` → 400; `data` di 201 caratteri → 400.
   → `ok('GET /qr.svg genera SVG completo e rifiuta input non validi')`
4. **Decodifica reale** con `jsqr` (vedi §6):
   - renderizzare la matrice di `encode()` su RGBA (`scale` 4, `border` 4,
     bianco/nero, `Uint8ClampedArray`), decodificare con `jsqr(rgba, w, h)` e
     verificare che `result.data` sia **identico** al testo di partenza;
   - tre payload: `http://192.168.1.10:3000/controller` (v2/v3),
     `https://example.test/a?b=1&c=2` e una stringa UTF-8 accentata di ~150 byte
     (`http://192.168.1.10:3000/controller?nome=Città è`), che deve cadere su una
     versione alta e quindi coprire interleaving e more-block;
   - in caso di decodifica fallita, il test deve **fallire** (niente `try`
     silenziosi).
   → `ok('QR decodificato da jsqr su 3 payload (v1-v10)')`
5. Socket, dopo la registrazione del controller (riusando `waitFor`):
   - `tv:controller_list` successivo alla registrazione contiene
     `controllers[0].slot === ctrlReady.slot`.
     → `ok('tv:controller_list include lo slot')`
6. Chiusura: chiudere anche eventuali `fetch` in sospeso prima di `server.close()`
   (nessun handle aperto, il processo deve uscire da solo con exit 0).

---

## 6. Dipendenza di test (unica eccezione ammessa)

```bash
npm install --save-dev jsqr@^1.4.0
```

- Solo `devDependencies`; **nessuna** dipendenza runtime nuova, nessun nuovo
  script npm, nessun bundler.
- `jsqr` va usato **solo** dentro `scripts/smoke-test.js` per la decodifica QR.
- Se l'installazione fallisce (rete assente): **non** lasciare `package.json` o
  `package-lock.json` in stato incoerente, rimuovere la dipendenza, mantenere i
  check strutturali del punto 3 e dichiarare nel report che la decodifica non è
  stata eseguita. Se invece l'installazione riesce (atteso: la rete è
  disponibile), il check 4 è **obbligatorio**.

---

## 7. Verifica richiesta e report

Nessun browser/display nell'ambiente (Chrome non installato): la verifica è
**statica + HTTP + Socket.io**. Dichiararlo esplicitamente nel report.

1. `node --check server.js`, `node --check lib/qr.js`,
   `node --check scripts/smoke-test.js` → exit 0.
2. Estrazione e compilazione degli script inline di **entrambe** le pagine con lo
   stesso comando dello STEP 2 (una pagina per volta, `/tmp/tv.inline.js` e
   `/tmp/controller.inline.js`) → exit 0.
3. `npm test` → `SMOKE TEST PASSED`, exit 0, con i 6 nuovi `OK`; riportare
   **l'output integrale**, non un estratto.
4. Server reale su porta effimera (`PORT=0 node server.js &` oppure `start(0)`):
   `curl -i` per `/tv`, `/`, `/controller`, `/healthz`, `/net-info`,
   `/qr.svg?data=test` e `/qr.svg` (senza data). Riportare **status, content-type
   e prima riga del body** di ciascuno.
5. `grep` di conformità in `public/tv.html` (tutti presenti):
   `/socket.io/socket.io.js`, `requestAnimationFrame`, `tv:hello`, `tv:ready`,
   `tv:controller_list`, `controller:connected`, `controller:disconnected`,
   `motion`, `button`, `calibrate`, `getBoundingClientRect`,
   `translate3d`, `visibilitychange`, `/qr.svg`, `/net-info`, `dvh`.
6. Controllo "nessun asset esterno": nessun `src=`/`href=` verso `http://` o
   `https://` in `tv.html` (solo same-origin e `data:`).
7. Prova manuale **non eseguibile qui**, da descrivere come passi attesi:
   aprire `/tv` sul PC → il QR compare con l'IP LAN; scansionarlo col telefono →
   `/controller`; tap `Attiva giroscopio`; sul PC il mirino segue il telefono in
   modo fluido; premere A/B → gli indicatori del chip si accendono; premere
   `Calibra` → il mirino torna al centro e compare il toast; su HTTP il
   touch-pad del telefono muove il mirino (mappatura x→alpha, y→beta).
8. `.bus/REPORT_B.md` deve essere **markdown strutturato**, non un dump di
   terminale: sezioni `## Cosa ho fatto`, `## File`, `## Comandi e output`,
   `## Check di verifica` (elenco puntato con esito), `## Limiti`, `## Note per
   l'Agente A` (max 10 righe complessive per le ultime due sezioni).

---

## 8. Criteri di accettazione

- [ ] `lib/qr.js` senza dipendenze, deterministico, v1–v10 ECC M; QR decodificato
      correttamente da `jsqr` sui 3 payload.
- [ ] `GET /qr.svg` 200 `image/svg+xml` con un `<rect>` per modulo scuro; 400 su
      `data` mancante o > 200 caratteri.
- [ ] `GET /net-info` coerente con la porta effettiva; helper `lanUrls()` usata
      anche dai log di avvio senza cambiare il testo dei log.
- [ ] `controllerList()` include `slot`; nessun'altra modifica al protocollo.
- [ ] `public/tv.html` esiste, autosufficiente, script inline compilabile, nessun
      asset esterno, nessun `alert()`, nessun log per frame.
- [ ] Mirino per controller, `requestAnimationFrame` unico, smoothing
      indipendente da dt, clamp e dead zone come da mappatura documentata.
- [ ] Card QR compatta/estesa, copia link guarded, fallback su URL se il QR
      fallisce.
- [ ] `npm test` verde (exit 0) con i 6 nuovi check e i 12 preesistenti.
- [ ] Nessuna dipendenza runtime nuova; `public/controller.html` invariato.
- [ ] Commit `git add -A && git commit -m "feat(loop): step 3 completato da Agente B (tv.html + QR)"`, poi `git push origin main`: il remote `origin` (SSH, `git@github.com:AntGalasso/mini-wii.git`) esiste; se il push fallisce (chiave SSH assente) annotare l'errore nel report e considerare lo step completo lo stesso.
- [ ] Ultimo comando assoluto del turno: `touch .bus/ready_for_a`.

## 9. Cosa NON fare

- Non creare i minigiochi né `README.md` (STEP 4).
- Non aggiungere dipendenze runtime, CDN, font, immagini o bundler.
- Non cambiare nomi/campi degli eventi esistenti, la porta o il contratto di
  `start()`.
- Non spostare il calcolo degli offset di calibrazione sul server (resta nel
  controller).
- Non rimpiazzare il QR con un servizio esterno: deve funzionare su LAN senza
  internet.
- Non usare `setTimeout`/`setInterval` per animare il mirino: solo `rAF`.
