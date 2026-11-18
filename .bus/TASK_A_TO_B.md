# TASK A → B — STEP 1 / 4

**Obiettivo dello step:** inizializzare il progetto Node.js e costruire il **core di trasporto realtime** del "Mini-Wii Web Console": `package.json` + `server.js` con Express + Socket.io sulla porta **3000**, che inoltra a bassa latenza dal telefono (`/controller`) alla TV (`/tv`) orientamento, accelerazione/swing e i tasti **A**, **B**, **Calibra**.

Stato repo attuale: nessun codice applicativo (solo `.bus/`, `knowledge.md`, `.gitignore`). Ambiente: Node v20.19.2, npm 9.2.0, ultimo commit `c886cad`.

> **Perimetro:** in questo step si consegnano **solo** i file elencati al punto 1. Non creare `public/controller.html`, `public/tv.html`, i minigiochi o il `README.md`: sono gli STEP 2, 3 e 4. Il protocollo definito qui è **vincolante** per gli step successivi.

---

## 1. File da creare

```
package.json
server.js
public/.gitkeep          (la cartella public/ deve esistere ed essere servita staticamente)
scripts/smoke-test.js    (verifica automatica del relay, eseguibile con `npm test`)
package-lock.json        (generato da `npm install`, da committare)
```

`node_modules/` è già in `.gitignore`: non committarlo.

---

## 2. `package.json`

- `"name": "mini-wii-web-console"`, `"version": "0.1.0"`, `"private": true`, `"type": "commonjs"`, `"main": "server.js"`.
- `"engines": { "node": ">=18" }`.
- dependencies: `express` (^4.x) e `socket.io` (^4.x). Nessun'altra dipendenza runtime.
- devDependencies: `socket.io-client` (^4.x), usato **solo** dallo smoke test.
- Script:
  - `"start": "node server.js"`
  - `"dev": "node server.js"`
  - `"test": "node scripts/smoke-test.js"`
- Installare con `npm install`.

---

## 3. `server.js`

### 3.1 HTTP / Express
- `const PORT = Number(process.env.PORT) || 3000;`
- `app.disable('x-powered-by')`.
- `app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }))`.
- Route:
  - `GET /` → redirect **302** a `/tv`.
  - `GET /tv` → `res.sendFile(path.join(__dirname, 'public', 'tv.html'))`. Se il file manca, rispondere **404 con testo** `tv.html non ancora disponibile (STEP 3)`, senza crash.
  - `GET /controller` → come sopra con `public/controller.html` e testo `controller.html non ancora disponibile (STEP 2)`.
  - `GET /healthz` → JSON `{ ok: true, uptime: <secondi>, controllers: <n>, tvs: <n> }` (conteggi dalle Map in memoria).
- Usare il **callback di errore** di `sendFile`: `ENOENT` → 404 col messaggio dello step; ogni altro errore → 500 con messaggio generico (niente stack trace al client).
- Listen su `0.0.0.0` così il telefono sulla LAN raggiunge il PC.
- All'avvio (solo quando avviato come main) stampare:
  - `Mini-Wii Web Console in ascolto sulla porta <PORT>`
  - `TV: http://localhost:<PORT>/tv`
  - per ogni IPv4 non interna da `os.networkInterfaces()`: `Telefono: http://<ip>:<PORT>/controller`

### 3.2 Contratto di avvio (vincolante per lo smoke test)
Esporre:

```js
module.exports = { app, server, io, start };
```

- `start(port = PORT)` crea l'ascolto (`server.listen(port, '0.0.0.0')`) e restituisce una `Promise` che risolve con la porta effettiva (`server.address().port`) all'evento `listening`, e rifiuta su `error`.
- Il listen automatico avviene **solo** se `require.main === module`: `start(PORT)` + log di avvio.
- `require('./server.js')` **non deve** mettere in ascolto nulla: lo smoke test chiama `start(0)` sullo stesso processo.
- `io.attach(server)` va fatto una sola volta, alla creazione; `start()` chiamato due volte deve rifiutare o essere idempotente (nessun doppio listen).

### 3.3 Socket.io
- `new Server(server, { cors: { origin: '*' }, pingInterval: 5000, pingTimeout: 10000, maxHttpBufferSize: 1e5 })`.
- **Movimento** inoltrato con `socket.volatile.emit(...)` / `io.to('tvs').volatile.emit(...)`: se un client è lento i campioni vecchi vengono scartati invece di accumulare ritardo.
- **Tasti, calibrazione, presenza e lifecycle** emessi in modo **affidabile** (senza `volatile`).
- Registri in memoria (niente DB/persistenza):
  ```js
  const controllers = new Map(); // id -> { id, connectedAt, lastMotionAt, name, slot }
  const tvs = new Map();         // id -> { id, connectedAt }
  ```
- Room: ogni controller registrato fa `socket.join('controllers')`, ogni TV registrata `socket.join('tvs')`.
- Un socket è **controller oppure TV**, mai entrambi: il primo `hello` valido fissa il ruolo. Un `hello` successivo con ruolo diverso viene ignorato e il socket riceve `error` con `{ code: 'already_registered' }`. Un secondo `hello` con lo **stesso** ruolo è idempotente (ri-emette l'ack, nessuna doppia registrazione).
- `slot` = intero progressivo 1-based assegnato alla registrazione del controller (riusa il primo slot libero se un controller si disconnette, oppure contatore monotono: scegli una delle due e documentala in un commento).

### 3.4 Protocollo (contratto vincolante)

**Controller → Server**

| Evento | Payload | Note |
|---|---|---|
| `controller:hello` | `{ name?: string }` | registra il socket come controller |
| `controller:motion` | `{ alpha, beta, gamma, ax, ay, az, swing, t }` | campioni giroscopio/accelerometro |
| `controller:button` | `{ button: 'A' \| 'B' \| 'CALIBRA', state: 'down' \| 'up', t }` | pressione/rilascio |
| `controller:calibrate` | `{ t?: number }` | richiesta di calibrazione (azzeramento orientamento sulla TV) |
| `controller:bye` | `{}` | disconnessione pulita opzionale |

- `name`: sanitizzato a max 24 caratteri `[A-Za-z0-9 _-]`, trim, default `Wiimote`.

**Server → Controller**
- ack `controller:hello` → `controller:ready` → `{ id, slot, serverTime, protocol: 1 }`.
- `tv:presence` → `{ online: boolean, total: number }`, emesso ai socket della room `controllers` quando una TV si connette o si disconnette.

**TV → Server**
- `tv:hello` `{}` → ack `tv:ready` → `{ id, serverTime, protocol: 1, controllers: [{ id, name, connectedAt }] }`.

**Server → TV** (room `tvs`, con `io.to('tvs').emit`)

| Evento | Payload |
|---|---|
| `motion` | `{ id, alpha, beta, gamma, ax, ay, az, swing, t, serverTime }` |
| `button` | `{ id, button, state, t }` |
| `calibrate` | `{ id, t }` |
| `controller:connected` | `{ id, name, connectedAt, total }` |
| `controller:disconnected` | `{ id, total }` |
| `tv:controller_list` | `{ controllers: [{ id, name, connectedAt }], total }` (inviato anche alla nuova TV dopo `tv:ready` e a ogni variazione dell'elenco) |

> `serverTime` è sempre aggiunto dal server (`Date.now()`), mai preso dal client.

### 3.5 Validazione e robustezza (obbligatoria)
- Helper `finiteNumber(v)` → `Number.isFinite(Number(v)) ? Number(v) : null`; niente `NaN`/`Infinity` verso i client.
- `motion`:
  - `alpha` normalizzato in `[0, 360)` con modulo positivo: `((a % 360) + 360) % 360`;
  - `beta` in `[-180, 180]` e `gamma` in `[-90, 90]` per **clamp** (non scarto);
  - `ax, ay, az, swing, t` devono essere finiti, altrimenti l'intero pacchetto viene **scartato in silenzio** (nessun throw, nessun log).
  - Ogni evento `motion` valido aggiorna `lastMotionAt`.
- `button`: accettato solo se `button` (uppercase, `trim`) è in `A|B|CALIBRA` e `state` in `down|up`; altrimenti ignorato. `t` opzionale → se non finito usa `serverTime`.
- `calibrate`: `t` opzionale → se non finito usa `serverTime`.
- `controller:motion` / `controller:button` / `controller:calibrate` da socket non registrato come controller → ignorati.
- Ogni handler dentro `try/catch`: un payload malformato non deve poter terminare il processo.
- `disconnect`: rimuovere da `controllers`/`tvs`, uscire dalle room implicitamente, notificare le TV con `controller:disconnected`, aggiornare `tv:presence` ai controller.
- Log **solo** a eventi discreti (listen, connect, registrazione, disconnect). **Mai** un log per singolo pacchetto di movimento.

---

## 4. `scripts/smoke-test.js` (verifica end-to-end del relay)

Deve funzionare **senza display/browser** e chiudere tutto in modo pulito.

1. `process.env.PORT = '0'` prima del require, poi `const { start } = require('../server.js')` e `const port = await start(0)`.
2. Con `socket.io-client` connettere due client: `tv` e `controller` su `http://127.0.0.1:<port>`, `transports: ['websocket']`.
3. La TV emette `tv:hello` e riceve `tv:ready` con `protocol: 1`, `id` stringa.
4. Il controller emette `controller:hello` con `{ name: 'Test Wiimote' }` e riceve `controller:ready` con `id`, `slot >= 1`.
5. La TV riceve `controller:connected` con `id` corretto e `total >= 1`.
6. Il controller emette `controller:motion` con `{ alpha: 90, beta: 10, gamma: -5, ax: 0.1, ay: 0.2, az: 1, swing: 3.5, t: Date.now() }`; la TV riceve `motion` con **gli stessi valori**, `id` corretto e `serverTime` numerico. Tolleranza solo in virgola mobile (`Math.abs(diff) < 1e-9`).
7. Il controller emette `controller:button` `{ button: 'A', state: 'down', t: Date.now() }`; la TV riceve `button` con gli stessi campi e `id` corretto.
8. Il controller emette `controller:calibrate` `{}`; la TV riceve `calibrate` con `id` corretto.
9. Invia un motion invalido (`{ alpha: 'abc', ax: Infinity, ... }`) e verifica che la TV **non** riceva alcun `motion` entro **300 ms**.
10. Disconnette il controller e verifica `controller:disconnected` sulla TV con `total` aggiornato.
11. Chiude client, `io.close()` e `server.close()`; stampa una riga `OK <check>` per ogni verifica e poi `SMOKE TEST PASSED`; `process.exit(0)`.
12. Su qualunque fallimento o timeout (globale **10 s**) stampa `FAIL <check>: <dettaglio>`, poi `SMOKE TEST FAILED`, e `process.exit(1)`.

Il test deve passare su una macchina senza display/browser: usare solo i client Node.

---

## 5. Criteri di accettazione (da riportare con output in `REPORT_B.md`)

- [ ] `npm install` completa senza errori (e genera `package-lock.json`).
- [ ] `node --check server.js` e `node --check scripts/smoke-test.js` escono con codice 0.
- [ ] `npm test` stampa `SMOKE TEST PASSED` ed esce con 0; riportare l'output completo.
- [ ] Avvio reale: `PORT=3000 npm start` resta in ascolto; poi
      - `curl -s localhost:3000/healthz` → JSON con `"ok":true` e conteggi numerici;
      - `curl -sI localhost:3000/` → `302` con `Location: /tv`;
      - `curl -s -o /dev/null -w '%{http_code}' localhost:3000/tv` → `404`, corpo `tv.html non ancora disponibile (STEP 3)`;
      - idem `/controller` → `404`, corpo `controller.html non ancora disponibile (STEP 2)`.
      Riportare comandi e output. Terminare il processo dopo la verifica.
- [ ] `require('./server.js')` non apre porte (verificabile con lo smoke test che usa `start(0)`).
- [ ] Nessun `console.log` per singolo pacchetto di movimento; nessuna dipendenza oltre quelle indicate.
- [ ] Commit finale: `git add -A && git commit -m "auto(agent-b): step completato"` e `git push origin main`.
- [ ] Ultimo comando assoluto del turno: `touch .bus/ready_for_a`.

## 6. Cosa NON fare in questo step
- Non creare HTML/CSS/JS dentro `public/` (solo `public/.gitkeep`).
- Non aggiungere autenticazione, pairing, stanze multiple, persistenza o QR.
- Non riscrivere i file di `.bus/` né `knowledge.md`.
