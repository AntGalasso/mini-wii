# Report di AGENTE B — Ciclo 61 (STEP 3: schermo TV)

## Cosa ho implementato

### 1. `server.js` — endpoint QR
- Aggiunta dipendenza `qrcode` (`^1.5.4`, `npm install qrcode`), nessun CDN.
- Nuovo `GET /qr?url=<encoded>`:
  - valida l'URL con `new URL()`: accetta **solo** `http:`/`https:` e host
    `localhost`, IPv4 (ottetti 0-255), IPv6 o hostname RFC-ish; lunghezza max 2048.
    Qualsiasi altro schema/host → `400 text/plain`.
  - genera l'SVG con `QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })`
    e risponde `200 image/svg+xml`.
- Contratto socket invariato (nessuna modifica a `tv:hello`, `tv:ready`, `motion`, ecc.).

### 2. `public/tv.html` (nuovo)
- Canvas full-window, `overflow: hidden`, `devicePixelRatio` limitato a 3 e gestito al resize
  (resize coalescato via rAF + `orientationchange`); nessun blur: si ridisegna subito dopo il resize.
- Socket.io locale (`/socket.io/socket.io.js`), `reconnection: true` con backoff; al `connect`
  invia `tv:hello`. Status in alto: `connesso` / `riconnessione…` + contatore telefoni.
- Pannello pairing: URL costruito da `location.protocol + '//' + location.host + '/controller'`,
  mostrato in grande e selezionabile; QR via `<img src="/qr?url=...">` con `alt` descrittivo.
  Il pannello si riduce a un pulsante "QR / istruzioni" al primo controller connesso e si riapre al click.
- Elenco controller (max 4 + `… +N`): pallino con hue stabile da hash dell'id, nome via
  `textContent`, età dell'ultimo movimento in ms, stato `inattivo` oltre 5 s, evidenza dell'attivo.
  Sincronizzato da `tv:ready`, `tv:controller_list`, `controller:connected`, `controller:disconnected`.
- Mirino: un solo controller attivo (ultimo `motion` o tasto), `dx` su arco più corto
  (`((d + 540) % 360) - 180`), `dy = beta - betaRef`, scala `(min(lato) * 0.4) / 30` (±30° ≈ 80% del
  lato corto), clamp con margine, smoothing `pos += (target - pos) * (1 - exp(-dt/90))` in **un unico
  loop rAF**. Disegno: reticolo + croce centrale, scia max 6 punti, alone pulsante su `button`/`calibrate`.
  Oltre 5 s senza `motion` l'opacità scende a 0.35.
- Ricalibrazione: al primo motion di un controller e a ogni `calibrate` salva `alphaRef/betaRef` e
  ricentra dolcemente il target al centro; i tasti `C` e `Calibra` riallineano anche il riferimento.
- Barra inferiore: hint "Muovi il Wiimote • A/B • Calibra per ricentrare", FPS reali e `Δt` in ms
  tra pacchetti consecutivi dello stesso controller (basato su `performance.now()`, non sul clock del server).
- Tasti `F` (fullscreen con `catch` silenzioso) e `C` (centra). Tutti gli handler hanno guardie
  `Number.isFinite`/tipo e try/catch: nessun errore con payload malformati.
- Nessun `innerHTML` con dati remoti, nessun `setInterval`, nessun riferimento hardcoded a localhost,
  nessuna risorsa esterna.

### 3. `scripts/smoke-test.js`
Aggiunti 5 controlli HTTP dopo i test socket esistenti (prima della chiusura), timeout globale 10 s → 20 s:
`GET /` (302 + `location: /tv`), `GET /tv` (200, `text/html`, contiene `canvas` e `/qr?url=`),
`GET /qr?url=http://192.168.1.5:3000/controller` (200, `image/svg+xml`, contiene `<svg`),
`GET /qr?url=javascript:alert(1)` (400), `GET /unknown` (404).

### 4. `README.md` (nuovo)
Avvio `npm install && npm start`, uso `/tv` sul PC e `/controller` sul telefono in stessa Wi-Fi,
nota HTTPS/permesso giroscopio con fallback touch-pad, mappa completa degli eventi socket e test.

## Output reali dei test

`npm test` (exit code 0):

```
> mini-wii-web-console@0.1.0 test
> node scripts/smoke-test.js

OK server avviato con start(0) sulla porta 33305
OK client TV e controller connessi via websocket
OK tv:ready con protocol 1 e id stringa
OK controller:ready con id e slot >= 1
OK tv:presence iniziale al controller
OK TV riceve controller:connected con id corretto e total >= 1
OK motion inoltrato alla TV con valori identici, id corretto e serverTime
OK button A/down inoltrato alla TV con id corretto
OK calibrate inoltrato alla TV con id corretto
OK motion invalido scartato (nessun evento entro 300 ms)
OK controller:disconnected ricevuto con total aggiornato
OK GET / risponde 302 verso /tv
OK GET /tv risponde 200 text/html con canvas e /qr?url=
OK GET /qr risponde 200 image/svg+xml con SVG del QR
OK GET /qr con scheme javascript: risponde 400
OK GET /unknown risponde 404
OK client, server e Socket.io chiusi in modo pulito
SMOKE TEST PASSED
```

Server reale (`node server.js` in background, poi terminato) + `curl`:

```
Mini-Wii Web Console in ascolto sulla porta 3000
TV: http://localhost:3000/tv
Telefono: http://192.168.178.30:3000/controller
---
200 text/html; charset=UTF-8          # GET /tv
200 image/svg+xml; charset=utf-8      # GET /qr?url=http%3A%2F%2F192.168.1.5%3A3000%2Fcontroller
400 text/plain; charset=utf-8         # GET /qr?url=javascript%3Aalert(1)
404                                   # GET /unknown
302 http://localhost:3000/tv          # GET /
```

Controlli statici su `public/tv.html`:

```
localhost: 0 riferimenti
CDN/risorse esterne: 0
setInterval: 0
requestAnimationFrame: 3 (1 loop di animazione + 1 coalescing resize + 1 avvio)
JS inline: sintassi valida (668 righe)
```

## Problemi aperti / note
- Il push verso `origin main` è stato eseguito; esito riportato qui sotto dopo il commit.
- Il QR richiede che il telefono raggiunga l'host usato per aprire `/tv`: se si apre la TV da
  `127.0.0.1`, il QR conterrà `127.0.0.1` e non sarà raggiungibile dal telefono. Comportamento
  corretto rispetto al requisito "mai hardcoded": conviene aprire `/tv` dall'IP LAN del PC.
- Su HTTP in rete locale il giroscopio non è disponibile: resta il touch-pad del controller
  (già previsto dallo STEP 2). Documentato nel README.
- Nessun browser disponibile in questo ambiente: la verifica di `tv.html` è statica (sintassi JS +
  ispezione + HTTP), non un test visivo end-to-end.
