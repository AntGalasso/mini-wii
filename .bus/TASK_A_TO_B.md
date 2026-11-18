# TASK A → B — Ciclo 24 (STEP 3)

> Nota: i contenuti precedenti di `.bus/TASK_A_TO_B.md` e `.bus/REPORT_B.md` erano dump di errori del terminale, non task/report. Da questo ciclo il file torna a contenere solo la specifica. Ignora quel testo.

## Stato accertato

- STEP 1 completo: `server.js` (Express + Socket.io, porta 3000, `PROTOCOL = 1`, eventi `controller:hello|motion|button|calibrate|bye`, `tv:hello`, inoltro a stanza `tvs`, `/healthz`, `sendPage` con 404).
- STEP 2 completo: `public/controller.html` (Wiimote, permessi iOS/Android, touch-pad di fallback, A/B/Calibra, vibrazione).
- `npm test` (`scripts/smoke-test.js`) passa: **SMOKE TEST PASSED**.
- **Manca `public/tv.html`**: `/tv` risponde 404 con "tv.html non ancora disponibile (STEP 3)".

## Obiettivo di questo step (UN solo step)

Creare `public/tv.html` — la TV — con **URL e QR code per collegare il telefono** e un **mirino fluido** comandato in tempo reale dal giroscopio. Servono anche i due endpoint server minimi per URL di rete e QR.

Nessuna nuova feature oltre a quanto elencato. Nessuna modifica al protocollo socket (resta `PROTOCOL = 1`): usa solo gli eventi già emessi da `server.js`.

## 1) Server: URL di rete + QR (modifiche minime a `server.js`)

Aggiungi una dipendenza runtime `qrcode` (`npm install qrcode@^1.5.4`) e due endpoint **prima** di `app.get('/tv', ...)`:

1. `GET /api/connection-info`
   - JSON: `{ port, protocol, urls: [{ url, controllerUrl, label }], primary }`
   - `urls` deriva dalle interfacce IPv4 non interne (stessa logica già usata nel blocco di avvio: estrai un helper `lanAddresses()` e riusalo, senza duplicare il loop).
   - `controllerUrl` = `http://<ip>:<port>/controller`; `url` = `http://<ip>:<port>/tv`; `label` = nome interfaccia.
   - Se non esiste alcuna interfaccia LAN, `primary` deve essere `http://localhost:<port>/controller` e `urls` deve contenere comunque quell'elemento (mai array vuoto).
   - `Cache-Control: no-store`.

2. `GET /api/qr.svg?data=<url>`
   - Valida `data`: stringa non vuota, `length <= 512`, deve iniziare con `http://` o `https://`. Altrimenti `400` JSON `{ error: 'invalid_data' }`.
   - Genera SVG con `QRCode.toString(data, { type: 'svg', margin: 1, width: 320, errorCorrectionLevel: 'M' })` e rispondi `200` con `Content-Type: image/svg+xml; charset=utf-8`, `Cache-Control: public, max-age=300`.
   - Errori di generazione → `500` JSON `{ error: 'qr_failed' }`, senza far crashare il processo.

Non toccare gli handler socket esistenti.

## 2) `public/tv.html` — requisiti

Pagina **full-viewport, tema scuro, zero scrollbars** (`html,body{margin:0;height:100%;overflow:hidden}`), funziona da sola su `http://<ip>:3000/tv` senza build step e senza CDN esterni.

### a) Layout / padiglione di connessione
- Canvas a tutto schermo (`position:fixed; inset:0`) per il mirino; sopra, overlay HTML con `pointer-events:none` (i controlli interattivi riattivano `pointer-events:auto`).
- Pannello "Collega il telefono" visibile quando `controllers.length === 0`; si nasconde (transizione CSS) quando arriva almeno un controller.
- Nel pannello: URL `/controller` in grande e selezionabile, QR code `<img src="/api/qr.svg?data=...">` generato da `/api/connection-info` (usa `primary`, e se `urls.length > 1` mostra un `<select>` per cambiare IP e ricaricare il QR). Pulsante "Copia link" con `navigator.clipboard` e fallback `document.execCommand('copy')`.
- Badge di stato connessione: pallino verde "TV online" quando il socket è connesso, rosso "Riconnessione…" altrimenti. Il socket usa `io()` con riconnessione automatica e, a ogni riconnessione, riemette `tv:hello`.
- Se `io` non è raggiungibile (file aperto con `file://` o server spento), mostra un messaggio esplicito, mai una pagina bianca.
- HUD in basso: elenco controller con nome, slot e colore assegnato (`slot % palette.length`), conteggio "N controller".

### b) Mirino fluido (core dello step)
- Ascolta `motion` (payload: `{ id, alpha, beta, gamma, ax, ay, az, swing, t, serverTime }`).
- Calibrazione: memorizza il primo campione valido di ciascun controller come origine (`origin.alpha`, `origin.beta`) e applica l'offset; l'evento `calibrate` (o il tasto Calibra) riazzera l'origine al campione successivo. Mostra un flash "Calibrato" per ~600 ms.
- Mappatura: `targetX = clamp((angolo(alpha - origin.alpha)) / FOV_X, -1, 1)`, `targetY = clamp(((beta - origin.beta)) / FOV_Y, -1, 1)` con `FOV_X = 90`, `FOV_Y = 45`; usa la differenza angolare più breve per alpha (`((d + 180) % 360 + 360) % 360 - 180`). Attenzione al segno: inclinare il telefono a destra deve spostare il mirino a destra.
- Disegno in `requestAnimationFrame` con interpolazione esponenziale verso il target: `pos += (target - pos) * (1 - Math.exp(-dt / TAU))`, `TAU ≈ 0.09 s`, `dt` da timestamp del rAF clampato a max 100 ms. Il mirino deve risultare fluido (nessun salto) e non deve derivare a telefono fermo.
- Posizione in pixel: centro schermo + `pos * (min(larghezza, altezza) * 0.5 - raggio - 8)`; nessun punto del mirino deve uscire dal canvas.
- Rendering: canvas 2D con `devicePixelRatio` gestito (canvas `width = innerWidth * dpr`, `ctx.scale(dpr, dpr)`), ridimensionamento su `resize` con debounce ~100 ms. Disegna mirino a cerchio con anello, punto centrale e alone; colore del controller attivo; scia/alone che si intensifica con `swing` (clamp 0..1 su 20).
- Almeno 2 controller: il mirino del controller che ha inviato l'ultimo `motion` è "attivo" (più grande, colore pieno), gli altri sono disegnati in scala ridotta e più trasparenti. I mirini dei controller disconnessi spariscono.
- Fermo da oltre 60 s senza `motion`: il mirino resta visibile ma il badge mostra "telefono inattivo" (nessun timer distruttivo, nessun reset della calibrazione).

### c) Eventi già disponibili da `server.js` (usali tutti)
`tv:ready`, `tv:controller_list`, `controller:connected`, `controller:disconnected`, `motion`, `button`, `calibrate`, `tv:presence`.
- `button` A/B: feedback visivo immediato (flash del mirino + indicatore "A"/"B" per ~250 ms) e log a schermo degli ultimi 5 eventi. Nessuna logica di gioco: i minigiochi sono STEP 4.
- `tv:presence` non è inviato alle TV: non aspettartelo; lo stato TV deriva da `connect`/`disconnect` del socket.

### d) Robustezza
- Tutto in un solo file, JavaScript vanilla, nessun `TODO`.
- Nessun errore in console se un payload è incompleto (valida con `Number.isFinite` prima di usare i numeri).
- Nessuna richiesta esterna oltre a `/api/*` dello stesso host.

## 3) Test da aggiungere a `scripts/smoke-test.js` (obbligatorio)

Aggiungi check PRIMA della chiusura del server, mantenendo lo stile esistente (`ok`/`fail`) e senza rompere i check già presenti:

1. `GET /tv` → `200`, `content-type` HTML, body contiene `tv.html`-markers (`<canvas` e `api/connection-info`).
2. `GET /api/connection-info` → `200` JSON, `protocol === 1`, `urls.length >= 1`, ogni elemento ha `controllerUrl` che termina con `/controller`, `primary` stringa non vuota; `cache-control` contiene `no-store`.
3. `GET /api/qr.svg?data=<primary controllerUrl>` → `200`, `content-type` contiene `image/svg+xml`, body contiene `<svg`.
4. `GET /api/qr.svg` senza `data` e con `data=javascript:alert(1)` → `400` con `{ error: 'invalid_data' }`.
5. `GET /controller` → `200` HTML (regressione STEP 2).

Usa `fetch` nativo di Node 18+ oppure `http.get`; non aggiungere altre dipendenze oltre a `qrcode`.

## 4) Report e consegna

- Scrivi `.bus/REPORT_B.md` con: cosa è stato creato/modificato, output reale di `npm test` (incluso `SMOKE TEST PASSED`), ed eventuali limiti (es. verifica visiva del QR non automatizzabile).
- `git add -A && git commit -m "feat(tv): schermo TV con QR di connessione e mirino giroscopico" && git push origin main`
- Ultimo comando del turno: `touch .bus/ready_for_a`

## Criteri di accettazione (review severa)

- `npm test` esce con codice 0 e stampa `SMOKE TEST PASSED` con i 5 nuovi check verdi.
- `curl -s localhost:3000/api/connection-info` restituisce JSON valido anche senza rete LAN.
- `/tv` non contiene `TODO`, non referenzia CDN e disegna il mirino in rAF con smoothing esponenziale (non assegnazione diretta del target).
- Il QR punta all'URL `/controller` raggiungibile dal telefono sulla LAN (non `localhost`, salvo assenza di interfacce).
- Nessuna regressione: `controller.html`, `/healthz` e tutti gli eventi socket restano invariati.
