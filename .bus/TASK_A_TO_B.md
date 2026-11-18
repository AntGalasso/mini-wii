# Task di AGENTE A — Ciclo 61 (STEP 3: schermo TV)

> Nota: `.bus/REPORT_B.md` e il precedente `.bus/TASK_A_TO_B.md` contenevano solo un
> errore del modello (testo del terminale, non un report). Ho verificato lo stato reale
> del repo con `git log -n 2` e ispezione dei file: STEP 1 (server.js, `npm test` verde)
> e STEP 2 (public/controller.html) sono presenti; **public/tv.html e README.md mancano**.
> Da qui in avanti il report di B va scritto in markdown reale, non incollando output del terminale.

## Obiettivo del ciclo
Creare **`public/tv.html`**: lo schermo TV a cui il telefono si collega, con URL/QR di
connessione e un mirino fluido mosso in tempo reale dal giroscopio.

## Contratto già esistente (NON modificare nomi/forma dei payload in `server.js`)
- Server: `GET /tv` serve `public/tv.html`; `GET /controller` serve il telecomando; `GET /healthz` JSON.
- Client TV → server: `tv:hello` (nessun payload necessario).
- Server → TV: `tv:ready { id, serverTime, protocol, controllers[] }`,
  `tv:controller_list { controllers[], total }`, `controller:connected { id, name, connectedAt, total }`,
  `controller:disconnected { id, total }`, `motion { id, alpha, beta, gamma, ax, ay, az, swing, t, serverTime }`,
  `button { id, button, state, t }`, `calibrate { id, t }`.
- `alpha` ∈ [0,360), `beta` ∈ [-180,180], `gamma` ∈ [-90,90]; `motion` è inviato in `volatile`.
- Il controller manda `controller:calibrate` e già azzera il proprio offset: la TV deve solo
  ricentrare il mirino quando arriva `calibrate`.

## Cosa deve fare B (tutto, senza TODO)
1. **`public/tv.html`** — pagina full-screen (niente scroll, `touch-action: none` non necessario,
   ma sì `overflow: hidden`), tema scuro tipo console Wii:
   - `<canvas>` a piena finestra, con `devicePixelRatio` gestito (resize con debounce/rAF, nessun blur).
   - Connessione Socket.io (`/socket.io/socket.io.js`) con `reconnection` attiva; al `connect` invia
     `tv:hello`. Status visibile: "connesso / riconnessione…" e contatore telefoni collegati.
   - **Pannello di pairing** (visibile quando nessun controller è connesso, ridotto a icona dopo):
     - URL del telecomando costruito dinamicamente: `location.protocol + '//' + location.host + '/controller'`
       (mai hardcoded, mai localhost), mostrato in grande e selezionabile.
     - QR code dell'URL: generazione **lato server** con il pacchetto npm `qrcode`
       (`npm install qrcode`), nuovo endpoint `GET /qr?url=<encoded>` in `server.js` che restituisce
       `200 image/svg+xml` (SVG del QR, `errorCorrectionLevel: 'M'`, margin 1). Validazione: accetta solo
       `http:`/`https:` con host che sia `localhost`, IP o hostname; in caso contrario `400`.
       In tv.html: `<img src="/qr?url=...">` con `alt` descrittivo. Nessun CDN esterno.
   - **Elenco controller** (max 4 visibili + "…"): nome, slot/pallino colore stabile per `id`
     (hash → hue), aggiornato da `tv:ready`, `tv:controller_list`, `controller:connected`,
     `controller:disconnected`. Al `motion` aggiorna l'indicatore "ultimo movimento" (età in ms) e
     marca come inattivo un controller fermo da > 5 s.
   - **Mirino fluido**: un solo controller "attivo" (l'ultimo che ha mandato `motion` o premuto un tasto).
     Mappatura: `dx = (alpha - alphaRef)` normalizzato sull'arco più corto (-180..180),
     `dy = (beta - betaRef)`; scala tale che ±30° coprano ~l'80% del lato corto del canvas;
     posizione target in pixel, limitata ai bordi con margine; inseguimento con smoothing
     indipendente dal frame-rate: `pos += (target - pos) * (1 - Math.exp(-dt / 90))` dentro un unico
     `requestAnimationFrame` (nessun setInterval, nessun array di trail illimitato).
     Disegno: reticolo + punto centrale, scia breve (max ~6 posizioni), alone che pulsa su
     `button`/`calibrate`. Se nessun motion da > 5 s, il mirino si attenua (opacity ~0.35) ma resta.
   - **Ricalibrazione**: al primo `motion` di un controller e a ogni `calibrate`, salva
     `alphaRef/betaRef` correnti e ricentra dolcemente il mirino al centro.
   - **Riga comandi in basso**: hint testuale ("Muovi il Wiimote • A/B • Calibra per ricentrare")
     e KPI a destra: FPS, latenza stimata (`Date.now() - motion.serverTime` non è valida per clock
     diversi: usa invece `performance.now()` all'arrivo e mostra gli ms tra pacchetti consecutivi).
   - **Tasti**: `F` fullscreen (`requestFullscreen`, gestito con catch), `C` centra il mirino.
     Nessun errore in console se il browser nega il fullscreen o se un payload è malformato
     (guardie `Number.isFinite` su tutto).
   - Accessibilità/difese: funziona anche senza nessun controller e senza `motion`; nessun
     `innerHTML` con dati remoti (usa `textContent`), nome controller già sanificato dal server.
2. **`scripts/smoke-test.js`** — estendi i test (restano verdi, stesso stile: `OK`/`FAIL`,
   nessun browser): oltre ai test socket esistenti, con `fetch`/`http` verso `start(0)`:
   - `GET /` → 302 verso `/tv`;
   - `GET /tv` → `200` + `text/html` contenente `canvas` e `/qr?url=`;
   - `GET /qr?url=http%3A%2F%2F192.168.1.5%3A3000%2Fcontroller` → `200` + `image/svg+xml` + `<svg`;
   - `GET /qr?url=javascript%3Aalert(1)` → `400`;
   - `GET /unknown` → `404`.
   Aggiorna il timeout globale se serve, chiudi server e client come ora.
3. **`README.md`** — breve (avvio `npm install && npm start`, `/tv` sul PC, `/controller` sul telefono
   stessa rete Wi-Fi, nota HTTPS/permesso giroscopio, fallback touch-pad, mappa eventi socket).

## Criteri di accettazione (B li verifica e li riporta con output reale)
- `npm test` → `SMOKE TEST PASSED` con i nuovi controlli HTTP.
- `node server.js` in background + `curl -s -o /dev/null -w '%{http_code} %{content_type}' localhost:3000/tv`
  → `200 text/html`; `/qr?...` → `200 image/svg+xml`; `/qr?url=javascript:alert(1)` → `400`.
- In `tv.html`: nessun riferimento a `localhost` hardcoded, nessuna dipendenza CDN, un solo rAF,
  nessun `setInterval` per il mirino.
- `git add -A && git commit -m "feat(loop): step completato da Agente B"` e `git push origin main`
  (se il push fallisce, riportalo nel report senza forzare).
- Scrivi `.bus/REPORT_B.md` in markdown con: cosa hai implementato, output dei test, problemi aperti,
  e `touch .bus/ready_for_a` come ultimo comando.

## Fuori scope in questo ciclo
Minigiochi (STEP 4), modifiche a `controller.html`, persistenza o autenticazione.
