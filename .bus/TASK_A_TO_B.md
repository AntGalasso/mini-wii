# TASK A → B — STEP 2 / 4

**Obiettivo dello step:** creare `public/controller.html`, il telecomando Wiimote verticale per telefono, che:
- chiede i permessi `DeviceOrientationEvent` (iOS 13+ / Android) con un tap esplicito,
- invia al server orientamento (`alpha`, `beta`, `gamma`) e accelerazione/swing a bassa latenza,
- usa un **touch-pad di fallback** quando il giroscopio non è disponibile (tipico su HTTP in LAN),
- invia i tasti **A**, **B**, **Calibra** con feedback aptico (`navigator.vibrate`) e stato visivo.

## Stato verificato del repository (QA di A)

- Commit HEAD: `7cf7257` — `auto(agent-b): step completato` (STEP 1).
- `node --check server.js` / `scripts/smoke-test.js` → OK; `npm test` → `SMOKE TEST PASSED`, exit 0.
- `public/` contiene **solo** `.gitkeep`: lo STEP 2 non è mai stato implementato.
- `server.js` espone `{ app, server, io, start }`, protocollo 1, relay `motion` / `button` / `calibrate` / `controller:connected` / `controller:disconnected` / `tv:controller_list`.
- **Difetto reale confermato:** `socket.emit('tv:presence', ...)` esiste solo dentro `notifyPresence()` (riga ~76), chiamata solo al cambio di stato TV (`tv:hello`, disconnect TV). Un controller registrato a TV già online riceve `controller:ready` ma **mai** lo stato iniziale della TV.

> **Perimetro:** in questo step si consegnano `public/controller.html` e un **micro-fix** a `server.js` + `scripts/smoke-test.js` (punto 1). NON creare `tv.html`, minigiochi o `README.md`: sono gli STEP 3 e 4. Non riscrivere `.bus/` né `knowledge.md`.

---

## 1. Micro-fix obbligatorio al server (prima dell'HTML)

In `server.js`, dentro l'handler `controller:hello`, nel ramo di **prima registrazione** (quello che crea il record, `socket.join('controllers')`, emette `controller:ready`, `controller:connected` e chiama `broadcastControllerList()`), **dopo** l'emissione di `controller:ready`, inviare al solo socket appena registrato:

```js
socket.emit('tv:presence', { online: tvs.size > 0, total: tvs.size });
```

Nessun'altra modifica a `server.js` (non toccare il ramo idempotente, `notifyPresence`, la validazione o il contratto di `start()`).

In `scripts/smoke-test.js`, **dopo** il check `controller:ready` e **prima** di attendere `controller:connected`, attendere `tv:presence` sul client controller (usare la helper `waitFor` esistente) e verificare `online === true` e `total === 1` (la TV è già registrata in quel punto dello script). Stampare esattamente:

```js
ok('tv:presence iniziale al controller');
```

Il test deve restare verde e nessun altro check deve cambiare.

---

## 2. File da creare

```
public/controller.html
```

File **unico e autosufficiente**: HTML + CSS + JS inline. Nessun CDN, nessuna risorsa esterna, nessuna immagine (forme e gradienti CSS). Client Socket.io caricato da `/socket.io/socket.io.js` (stessa origine, servito da Socket.io). Non toccare `public/.gitkeep`.

---

## 3. Struttura e stile (Wiimote verticale)

Mobile-first, solo verticale, senza scroll e senza zoom:

- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`.
- `html, body { height: 100%; margin: 0; overscroll-behavior: none; }`, sfondo scuro con corpo del telecomando centrato, larghezza `min(92vw, 420px)`, alto `min(92vh, 780px)` con fallback `100dvh`, `border-radius` generoso, gradiente bianco/ghiaccio, ombra.
- Area interattiva con `touch-action: none; user-select: none; -webkit-user-select: none;` e `-webkit-tap-highlight-color: transparent`.
- Supporto `env(safe-area-inset-bottom)` per iPhone.

Dall'alto verso il basso:

1. **Header di stato**: pallino `#status-dot`, testo `#status-text` con stati `Connessione…`, `Connesso — in attesa TV`, `Connesso — TV online`, `Riconnessione…`; badge `#slot-badge` con lo slot assegnato.
2. **Pannello giroscopio**: pulsante grande `#btn-permission` "Attiva giroscopio" (visibile finché i permessi non sono concessi), istruzioni brevi ("Tieni il telefono in verticale, punta verso la TV"), e `#gyro-readout` con alpha/beta/gamma aggiornati a ~10 Hz per debug.
3. **Touch-pad di fallback** `#touchpad`: area ampia (≥ 180 px di altezza), bordo tratteggiato, etichetta "Touch-pad", indicatore `#touch-dot`. **Visibile solo in modalità fallback**, con banner `#fallback-banner`: "Giroscopio non disponibile su HTTP. Usa il touch-pad o apri la pagina in HTTPS." e pulsante `#btn-use-touch` per forzare manualmente il touch-pad.
4. **Tasto B** `#btn-b`: barra orizzontale larga sotto il touch-pad, etichetta "B" (stile grilletto).
5. **Tasto A** `#btn-a`: bottone circolare grande (Ø ~ 110 px) in basso a destra, etichetta "A".
6. **Calibra** `#btn-calibra`: bottone pillola, etichetta "Calibra" con icona testuale `⌖`, sotto/sinistra del tasto A.
7. **Footer**: nome dispositivo (`Wiimote`) e nota "protocollo 1".

Tutti i bottoni devono avere `type="button"`, `aria-label`, e stato `:active`/`.pressed` evidente (scala + luminosità).

---

## 4. Logica client (contratto vincolante)

### 4.1 Connessione
- `const socket = io({ transports: ['websocket', 'polling'] });` — nessun URL hardcoded.
- Su `connect`: `socket.emit('controller:hello', { name: 'Wiimote' })`.
- Su `controller:ready`: salvare `id`, `slot`, `protocol`; aggiornare `#slot-badge`; log discreto in console.
- Su `disconnect`: stato `Riconnessione…`; alla `connect` successiva ri-emettere `hello` (nuovo id assegnato dal server) e ripulire lo stato tasti premuti (nessun `up` pendente).
- Su `tv:presence`: aggiornare l'header (`TV online` / `in attesa TV`) usando `online` e `total`.
- Su `error` con `code: 'already_registered'`: mostrare stato di errore e **non** ritentare `hello`.
- Su `pagehide` (e `beforeunload`): `socket.emit('controller:bye')` in `try/catch` per liberare subito lo slot (il server ha già l'handler `controller:bye`). Nessun `alert()` bloccante, mai.

### 4.2 Permessi orientamento
- Rilevare il supporto: `'DeviceOrientationEvent' in window`.
- iOS (`typeof DeviceOrientationEvent.requestPermission === 'function'`): il tap su `#btn-permission` deve chiamare **direttamente** `DeviceOrientationEvent.requestPermission()` nello stesso gesto utente (nessun `await` prima della chiamata) e gestire `granted` / `denied` / eccezione.
- Android/desktop: il tap registra `window.addEventListener('deviceorientation', onOrientation, { passive: true })`; su desktop senza sensori non arriverà alcun evento → fallback automatico.
- Su `denied` o eccezione: messaggio in `#fallback-banner` e fallback attivo.
- **Fallback automatico**: se entro **1500 ms** dal tap non è arrivato alcun evento `deviceorientation` con `alpha`, `beta`, `gamma` finiti, attivare la modalità touch-pad. `#btn-use-touch` la attiva subito (utile anche per test su desktop).
- Al consenso `#btn-permission` scompare; in modalità fallback resta visibile solo il touch-pad.

### 4.3 Campionamento e invio del movimento
- `deviceorientation` → `alpha`, `beta`, `gamma`; accelerazione da `event.accelerationIncludingGravity` con fallback `event.acceleration`, altrimenti `ax = ay = 0`, `az = 9.81`.
- Applicare gli **offset di calibrazione** correnti (`alpha0`, `beta0`, `gamma0`, default 0) e normalizzare `alpha` in `[0, 360)`. Il server ri-normalizza comunque: non delegare a lui il calcolo degli offset.
- Filtro passa-a-basso anti-jitter: `v = 0.25 * nuovo + 0.75 * precedente` su alpha/beta/gamma; nessun filtro sull'accelerazione.
- `swing` = `Math.abs(Math.hypot(ax, ay, az) - 9.81)`, arrotondato a 3 decimali; sempre finito e ≥ 0.
- Invio **al massimo a 60 Hz**: scartare i campioni se `now - lastSent < 16 ms`; invio immediato, senza batching né timer. Se `!socket.connected`, scartare il campione.
- Payload esatto:
  ```js
  { alpha, beta, gamma, ax, ay, az, swing, t: Date.now() }
  ```
  Se un campo non è finito, non inviare il pacchetto.
- Nessun `console.log` per singolo campione.

### 4.4 Touch-pad di fallback
- **Pointer Events** con `setPointerCapture` e `touch-action: none`.
- Mappatura deterministica (documentarla in un commento: la userà la TV nello STEP 3):
  - `alpha` = `x / width * 360` in `[0, 360)` (orizzontale = imbardata),
  - `beta` = `(0.5 - y / height) * 180` in `[-90, 90]` (in alto = positivo),
  - `gamma` = `((x / width) - 0.5) * 90` in `[-45, 45]`,
  - `ax = 0, ay = 0, az = 9.81`, `swing = 0`, `t = Date.now()`.
- Al `pointerup` / `pointercancel` / `pointerleave` mantenere l'ultimo orientamento (niente reset a 0) e fermare l'invio; `#touch-dot` mostra la posizione.
- Stessa funzione di invio del giroscopio, stesso limite di 60 Hz.
- In modalità giroscopio il touch-pad è nascosto e non invia nulla.

### 4.5 Tasti A, B, Calibra
- `pointerdown` → `state: 'down'`; `pointerup` / `pointercancel` / `pointerleave` → `state: 'up'`. Nessun `up` senza `down` precedente; nessun `down` duplicato per lo stesso pointer.
- Payload: `{ button: 'A' | 'B' | 'CALIBRA', state: 'down' | 'up', t: Date.now() }`.
- Vibrazione su `down`: `navigator.vibrate?.(15)` dentro `try/catch`; nessuna vibrazione su `up`.
- **Calibra**: azzera gli offset (`alpha0`, `beta0`, `gamma0` = valori grezzi correnti, 0 se assenti), invia `controller:calibrate` con `{ t: Date.now() }` e vibra con pattern `[20, 40, 20]`. In modalità touch-pad non deve rompersi: resetta il touch-pad al centro e invia comunque `calibrate`.
- Feedback visivo immediato tramite `:active`; non attendere ack (il server non ne invia).
- Se il socket è disconnesso, i tasti vibrano/animano ma non inviano nulla.

### 4.6 Robustezza e UX
- Nessun errore JS non gestito: handler DOM e callback Socket.io in `try/catch` dove ragionevole.
- Niente scroll, niente selezione testo, niente zoom su doppio tap.
- Testi in italiano, coerenti con il resto del progetto.
- Identico funzionamento su desktop (touch-pad + mouse) per i test manuali.

---

## 5. Verifica richiesta

Non esiste browser/display nell'ambiente (Chrome non installato): la verifica è **statica + server**, e il report deve dichiararlo esplicitamente.

1. `node --check server.js` e `node --check scripts/smoke-test.js` → exit 0.
2. `npm test` → `SMOKE TEST PASSED`, exit 0, con la nuova riga `OK tv:presence iniziale al controller`.
3. Estrazione e compilazione dell'inline script:
   ```bash
   node -e "const fs=require('fs');const h=fs.readFileSync('public/controller.html','utf8');const m=[...h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)];if(!m.length)throw new Error('nessuno script inline');fs.writeFileSync('/tmp/controller.inline.js',m.map(x=>x[1]).join('\n'));"
   node --check /tmp/controller.inline.js
   ```
   → exit 0.
4. Avvio reale su porta effimera (`PORT=0 node server.js` oppure `start(0)`):
   - `GET /controller` → **200**, `Content-Type: text/html`, corpo contenente `btn-permission`, `touchpad`, `btn-a`, `btn-b`, `btn-calibra`.
   - `GET /` → 302 a `/tv`; `GET /tv` → 404 invariato ("tv.html non ancora disponibile (STEP 3)").
   - `GET /healthz` → JSON valido.
5. `grep` di conformità (tutti presenti in `public/controller.html`): `/socket.io/socket.io.js`, `DeviceOrientationEvent.requestPermission`, `deviceorientation`, `accelerationIncludingGravity`, `navigator.vibrate`, `controller:hello`, `controller:motion`, `controller:button`, `controller:calibrate`, `tv:presence`, `touch-action`, `setPointerCapture`, `controller:bye`.
6. Controllo "nessun asset esterno": nessun `src=`/`href=` verso `http://` o `https://` nel file (solo l'import same-origin di Socket.io).
7. In `REPORT_B.md` riportare che la prova su telefono reale (sensori + vibrazione) **non è eseguibile** qui, con i passi manuali attesi: aprire `/controller` dal telefono sulla LAN (URL stampati all'avvio), tap "Attiva giroscopio", verificare `controllers: 1` su `/healthz`, provare A/B/Calibra, e su HTTP verificare l'attivazione del touch-pad dopo 1,5 s.

---

## 6. Criteri di accettazione

- [ ] `server.js` invia `tv:presence` iniziale al solo controller appena registrato; nessun'altra modifica al server.
- [ ] `npm test` verde con il nuovo check `tv:presence` (exit 0), output riportato integralmente.
- [ ] `public/controller.html` esiste, è autosufficiente (nessun asset esterno) e il suo script inline compila con `node --check`.
- [ ] Tutti gli elementi e gli eventi del protocollo sono presenti e coerenti con il contratto STEP 1.
- [ ] Layout Wiimote verticale, touch-pad di fallback funzionante anche con mouse, vibrazione guarded, nessun `alert()`.
- [ ] `GET /controller` risponde 200 `text/html`; `/tv` continua a rispondere 404 STEP 3.
- [ ] Nessuna nuova dipendenza in `package.json`.
- [ ] Commit: `git add -A && git commit -m "auto(agent-b): step completato"` e `git push origin main`.
- [ ] Ultimo comando assoluto del turno: `touch .bus/ready_for_a`.

## 7. Cosa NON fare

- Non creare `public/tv.html`, minigiochi o `README.md`.
- Non introdurre framework, bundler, CDN o immagini esterne.
- Non modificare il protocollo esistente (nomi eventi/campi) né la porta o il contratto di `start()`.
- Non introdurre log per singolo campione di movimento.
- Non aggiungere dipendenze o script npm.
