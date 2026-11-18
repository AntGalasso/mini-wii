# TASK A → B — STEP 3 / 4 (recupero)

**Obiettivo:** consegnare `public/tv.html` funzionante (TV a schermo intero con QR
di collegamento e un mirino fluido per ogni telefono) e il supporto server che gli
serve (`lib/qr.js`, `GET /qr.svg`, `GET /net-info`, campo `slot`).

---

## 0. QA del ciclo 2 (verificato da A, non ripetere)

- `git log -n 2`: `a9a736f` (`auto(ciclo-2): sync automatico fine turno B`) e
  `0daa652`. Il commit `a9a736f` modifica **solo** `.bus/REPORT_B.md` e
  `.bus/TASK_A_TO_B.md`: **zero righe di codice**.
- Stato reale: `public/tv.html` **non esiste**, `lib/` **non esiste**,
  `server.js` non ha `/qr.svg` né `/net-info`, `controllerList()` non ha `slot`.
- `npm test` → verde, 12 check `OK`, `SMOKE TEST PASSED`: il codice dello STEP 1/2
  è sano, manca solo lo STEP 3.
- `.bus/REPORT_B.md` è **illeggibile**: contiene il dump di una TUI (barra di
  stato, prompt, messaggio `Your session ended before this request started`)
  invece della relazione. Causa probabile: il turno B è morto prima di iniziare.
  **In questo ciclo il report deve essere markdown strutturato** (§7). Un report
  non conforme è un fallimento dello step.

Questo file è l'**unica** fonte di verità: ignora task precedenti e messaggi di
commit citati altrove.

---

## 1. Perimetro (solo questi file)

```
lib/qr.js             (nuovo)
public/tv.html        (nuovo, autosufficiente)
server.js             (modifiche puntuali §3)
scripts/smoke-test.js (nuovi check §5, nessuno rimosso)
package.json          (dipendenze §6)
```

Vietato: minigiochi e `README.md` (STEP 4), modifiche a `public/controller.html`
(solo se un bug reale lo impone: dichiararlo), riscrittura di
`.bus/METAPROMPT.md` / `knowledge.md`, nuove dipendenze oltre a quelle del §6.

---

## 2. `lib/qr.js` — QR offline, generazione affidabile

**Decisione di A:** non scrivere un encoder Reed–Solomon a mano. Usa il pacchetto
`qrcode` (§6), che è puro JavaScript e lavora offline; `lib/qr.js` è un wrapper
sottile che espone la matrice e **disegna l'SVG da sé** (un `<rect>` per modulo
scuro, contratto del §5).

API richiesta (CommonJS, `'use strict'`):

```js
module.exports = { encode, toSvg, MAX_BYTES };
// encode(text) -> { version, ecc: 'M', mask, size, modules: boolean[][] }
//                 modules[y][x] === true  => modulo scuro
// toSvg(text, { scale, border }) -> stringa SVG completa
// MAX_BYTES = 200; input non stringa o > 200 caratteri -> throw RangeError
```

- `encode`: `QRCode.create(text, { errorCorrectionLevel: 'M' })` (versione scelta
  automaticamente, byte mode). Espone `version`, `mask` (`maskPattern`),
  `size` (`modules.size`) e converte `modules.data` in `boolean[][]` con
  `modules[y][x] = Boolean(data[y * size + x])`. Deterministico.
- `toSvg`: viewBox `0 0 (size+2·border) (size+2·border)`, `shape-rendering="crispEdges"`,
  un `<rect>` bianco a piena area, poi **un `<rect>` per ogni modulo scuro**
  (niente `<path>`), `width`/`height` = `scale × lato viewBox` in pixel.
  `scale` default 6, `border` default 4, entrambi sanitizzati (`clamp` intero).
- Nessun accesso a rete, nessun asset, nessun `console.log`.

## 3. `server.js` — rotte e `slot`

```
GET /qr.svg?data=<testo>&scale=<1..12>&border=<0..8>
  data mancante            -> 400 text/plain "parametro data mancante"
  data.length > 200        -> 400 text/plain "parametro data troppo lungo"
  encode/toSvg lancia      -> 500 text/plain "QR non generabile"
  ok                       -> 200 image/svg+xml; charset=utf-8,
                              Cache-Control "public, max-age=300", body = SVG
  scale/border fuori range o NaN -> default, mai 400

GET /net-info -> 200 JSON { port, urls: ["http://<ipv4>:<port>", ...], primary }
  urls: tutti gli IPv4 non-internal sulla porta effettiva; primary = urls[0] ?? null
```

- Helper `lanUrls(port)` usata **sia** da `/net-info` sia dal logging di avvio,
  senza cambiare il testo dei log (`TV: ...` / `Telefono: ...`).
- `controllerList()` deve restituire `{ id, name, connectedAt, slot }`.
- Aggiungere `slot: record.slot` **anche** al payload `controller:connected`
  (campo additivo, la TV ne ha bisogno per il chip). Nessun altro campo o nome di
  evento cambia: protocollo, porta e contratto di `start()` identici.

## 4. `public/tv.html` — file unico, niente asset esterni

HTML + CSS + JS inline. Unici riferimenti ammessi: `/socket.io/socket.io.js`,
`/qr.svg`, `/net-info`, `href="data:,"` per il favicon. Nessun CDN/font/immagine,
niente `alert()`, testi in italiano, tema scuro (`100dvh` con fallback `100vh`,
`overflow: hidden`).

Struttura minima richiesta (id usati anche dai test, non rinominarli):

1. Top bar fissa: brand `MINI-WII`, stato `#tv-status` (`Connessione…` /
   `TV online` / `Riconnessione…`), `#controller-count` (`N controller`).
2. Card `#join-card` in alto al centro: titolo `Collega il telefono`, URL grande
   in `#join-url` (monospace, selezionabile), QR in `#qr` (`<img alt>`), pulsante
   `#btn-copy`; quando almeno un controller è connesso la card prende la classe
   `compact` (QR piccolo, resta l'URL) e torna estesa a zero controller.
   Se `/qr.svg` risponde 400/500: nascondi `#qr` e mostra solo l'URL.
   `navigator.clipboard` può mancare su HTTP: fallback = seleziona il testo e
   toast `Copia manuale: link selezionato`.
3. Arena `#arena` full screen con i mirini e, a zero controller, l'overlay
   `#idle-hint` (`Scansiona il QR per iniziare`).
4. `#badges` in basso a sinistra: un chip per controller con pallino del colore
   slot, `Slot N`, nome, indicatori `A`/`B`; si aggiorna con
   `controller:connected` / `controller:disconnected` / `tv:controller_list`.
5. `#toasts` in basso al centro: max 3, auto-dismiss 1,8 s.
6. HUD discreto: `#fps` aggiornato a 1 Hz.

Mirino: `<template id="crosshair-template">` con l'elemento `.crosshair`
(clonato per controller: anello Ø 34 px, due trattini, punto Ø 6 px, glow;
colore da `--c`: slot 1 `#4ade80`, 2 `#38bdf8`, 3 `#f472b6`, 4 `#fbbf24`,
oltre `#a78bfa`). Posizionamento **solo** con
`transform: translate3d(x,y,0) translate(-50%,-50%) scale(s)` +
`will-change: transform` (mai `left`/`top`).

### 4.1 Logica client (contratto)

- `const socket = io({ transports: ['websocket', 'polling'] });` (nessun URL
  hardcoded). Su `connect`: `socket.emit('tv:hello', {})`. Su `tv:ready`: salva
  `id`/`protocol`, stato `TV online`, popola mirini e chip con
  `payload.controllers`. Su `tv:controller_list`: sincronizza per **id**
  (crea, rimuovi, ordina per `slot`). Su `controller:connected`: aggiungi chip +
  mirino, toast `Slot N collegato`. Su `controller:disconnected`: rimuovi chip +
  mirino, toast `Slot N disconnesso`. Su `disconnect`: stato `Riconnessione…`,
  svuota chip e mirini, card estesa. Su `error` con `code:'already_registered'`:
  stato di errore e **stop** dei `tv:hello`.
- `motion`/`button`/`calibrate` da id sconosciuto: ignorati in silenzio.
- URL telefono: se `location.hostname` è `localhost`/`127.0.0.1`/`::1` interroga
  `/net-info` e usa `primary` (se `null` o fetch fallisce → `location.origin`);
  altrimenti `location.origin`. URL = base + `/controller`;
  `#qr.src = '/qr.svg?scale=6&data=' + encodeURIComponent(url)` (una sola
  `encodeURIComponent`).

### 4.2 Movimento (cuore dello step)

- L'handler `motion` **non tocca il DOM**: salva solo i target nel record.
- Mappatura, da documentare in un commento:
  `x = 0.5 + (gamma / 45) * 0.42`, `y = 0.5 - (beta / 90) * 0.42`;
  dead zone `|gamma| < 1.2 && |beta| < 1.2` (mantiene il target);
  clamp in `[0.02, 0.98]`.
- **Un solo** `requestAnimationFrame` per tutti i mirini, smoothing indipendente
  dal frame rate: `dt` reale clampato a 50 ms,
  `k = 1 - Math.exp(-dt / 55)`, `current += (target - current) * k`.
- Loop fermo con `document.hidden`, riavvio su `visibilitychange` resettando
  `lastFrame` (nessun teletrasporto, nessun salto).
- Pixel da `arena.getBoundingClientRect()` cacheato e aggiornato su
  `resize`/`orientationchange`.
- `swing` = ultimo valore ricevuto con decadimento esponenziale a 0 in 300 ms,
  `scale = 1 + Math.min(swing / 12, 0.35)`.
- Classe `.stale` (opacità ridotta) se quel controller non invia `motion` da
  > 1500 ms.
- `#fps` aggiornato una volta al secondo; **nessun** `console.log` per frame o
  per campione; nessun `setTimeout`/`setInterval` per animare i mirini.
- `button` `down` accende `A`/`B` del chip, `up` spegne. `button: 'CALIBRA'` **e**
  `calibrate` fanno lo stesso lavoro (il controller invia entrambi): target a
  `0.5, 0.5` raggiunto in ~300 ms + toast `Slot N calibrato`, idempotente (due
  eventi ravvicinati non producono più di un toast).

## 5. Nuovi check in `scripts/smoke-test.js`

Aggiungere **dopo** i 12 esistenti, senza indebolirli; `SMOKE TEST PASSED` e
exit 0 restano obbligatori. Usa `fetch` di Node 20 e la porta effettiva.

1. `GET /tv` → 200, `text/html`, body contiene `crosshair`, `id="qr"`,
   `id="join-url"`, `/socket.io/socket.io.js` → `ok('GET /tv 200 text/html con mirino e QR')`
2. `GET /` con `redirect:'manual'` → 302 + `location: /tv`
   → `ok('GET / reindirizza a /tv')`
3. `GET /controller` → 200 e body con `btn-permission`
   → `ok('GET /controller 200 (regressione STEP 2)')`
4. `GET /net-info` → `port` uguale alla porta effettiva, `urls` array, ogni url
   inizia con `http://` e contiene `:${port}`, `primary` stringa o `null`
   → `ok('GET /net-info coerente con la porta effettiva')`
5. `/qr.svg`:
   - `?data=<url controller>` → 200, `image/svg+xml`, body inizia con `<svg`,
     contiene `crispEdges`;
   - numero di `<rect>` = moduli scuri di `encode(url)` + 1 (sfondo);
   - senza `data` → 400; `data` di 201 caratteri → 400
   → `ok('GET /qr.svg genera SVG completo e rifiuta input non validi')`
6. **Decodifica reale** con `jsqr`: renderizza `encode(text).modules` in RGBA
   (scale 4, border 4, bianco/nero, `Uint8ClampedArray`), `jsqr(rgba,w,h)`,
   `result.data` **identico** al testo. Tre payload:
   `http://192.168.1.10:3000/controller`,
   `https://example.test/a?b=1&c=2`,
   `http://192.168.1.10:3000/controller?nome=Città è` (UTF-8, versione alta).
   Decodifica fallita = test fallito, nessun `try` silenzioso
   → `ok('QR decodificato da jsqr su 3 payload (v1-v10)')`
7. Dopo la registrazione del controller: il `tv:controller_list` successivo
   contiene `controllers[0].slot === ctrlReady.slot` **e**
   `controller:connected` contiene `slot` → `ok('tv:controller_list include lo slot')`
8. Chiusura: nessun handle aperto, il processo esce da solo con exit 0 (chiudi
   eventuali body di `fetch`).

## 6. Dipendenze

```bash
npm install qrcode@^1.5.4 --save
npm install --save-dev jsqr@^1.4.0
```

- `qrcode`: unica dipendenza runtime nuova, puro JS, offline a runtime, usata
  **solo** dentro `lib/qr.js`. Nessun'altra dipendenza, nessun bundler, nessun
  script npm nuovo.
- `jsqr`: **solo** `devDependencies`, usato **solo** in `scripts/smoke-test.js`.
- Se `npm install` fallisce (rete assente): non lasciare `package.json` /
  `package-lock.json` incoerenti, implementa comunque `lib/qr.js` con `qrcode`
  solo se installato; in caso contrario **fermati e riporta il blocco** nel
  report senza inventare un encoder. I check strutturali del punto 5 restano
  obbligatori; dichiara esplicitamente cosa non hai potuto eseguire.

## 7. Verifica e report

Nessun browser/display: verifica **statica + HTTP + Socket.io**. Dichiaralo.

1. `node --check server.js`, `node --check lib/qr.js`,
   `node --check scripts/smoke-test.js` → exit 0.
2. Estrazione e `node --check` dello script inline di `public/tv.html`
   (`/tmp/tv.inline.js`) → exit 0; `node --check` anche di
   `/tmp/controller.inline.js` (regressione).
3. `npm test` → riporta **l'output integrale**, `SMOKE TEST PASSED`, exit 0, con i
   12 `OK` preesistenti e i 7 nuovi.
4. Server reale su porta effimera (`PORT=0 node server.js` o `start(0)`):
   `curl -i` per `/tv`, `/`, `/controller`, `/healthz`, `/net-info`,
   `/qr.svg?data=test`, `/qr.svg` → riporta status, content-type e prima riga del
   body.
5. `grep` di conformità in `public/tv.html`: tutte presenti
   `/socket.io/socket.io.js`, `requestAnimationFrame`, `tv:hello`, `tv:ready`,
   `tv:controller_list`, `controller:connected`, `controller:disconnected`,
   `motion`, `button`, `calibrate`, `getBoundingClientRect`, `translate3d`,
   `visibilitychange`, `/qr.svg`, `/net-info`, `dvh`.
6. Nessun `src=`/`href=` verso `http://` o `https://` in `tv.html`.
7. `.bus/REPORT_B.md` in markdown con le sezioni esatte
   `## Cosa ho fatto`, `## File`, `## Comandi e output`, `## Check di verifica`,
   `## Limiti`, `## Note per l'Agente A`. Ultime due sezioni: max 10 righe in
   totale. **Mai** incollare dump di terminale/TUI.

## 8. Criteri di accettazione

- [ ] `lib/qr.js` deterministico, ECC M, output SVG con un `<rect>` per modulo scuro.
- [ ] `/qr.svg` 200 `image/svg+xml`; 400 su `data` mancante o > 200 caratteri;
      `/net-info` coerente con la porta effettiva; `lanUrls()` usata anche nei log.
- [ ] `controllerList()` e `controller:connected` includono `slot`; nessun altro
      cambiamento di protocollo.
- [ ] `public/tv.html` autosufficiente: scroll script inline valido, zero asset
      esterni, zero `alert()`, zero log per frame.
- [ ] Mirino per controller, un solo `rAF`, smoothing `1-exp(-dt/55)`, dead zone
      e clamp come da mappatura documentata, `.stale` dopo 1,5 s, rimozione
      immediata alla disconnessione.
- [ ] Card QR compatta/estesa, copia link con fallback, QR nascosto se `/qr.svg`
      fallisce.
- [ ] `npm test` verde con 12 + 7 check; `public/controller.html` invariato.
- [ ] Commit esattamente:
      `git add -A && git commit -m "feat(loop): step 3 completato da Agente B (tv.html + QR)"`
      poi `git push origin main` (se il push fallisce per chiave SSH, annotalo e
      considera lo step completo).
- [ ] Ultimo comando assoluto del turno: `touch .bus/ready_for_a`.

## 9. Priorità se il tempo non basta

Ordine di consegna non negoziabile: (1) `lib/qr.js` + rotte + `slot` + check 1–5,
(2) `tv.html` completo, (3) check 6 (decodifica `jsqr`). Se ti fermi prima della
fine, il report deve dire **esattamente** a che punto sei e cosa manca: uno step
parziale dichiarato vale più di un report inventato.
