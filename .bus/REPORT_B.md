# REPORT B — STEP 1 / 4

## Riepilogo

Core di trasporto realtime completato secondo il contratto vincolante di `.bus/TASK_A_TO_B.md`.

File creati:

| File | Contenuto |
|---|---|
| `package.json` | manifest `mini-wii-web-console@0.1.0`, commonjs, dipendenze `express` ^4.21.2 e `socket.io` ^4.8.1, devDep `socket.io-client` ^4.8.1, script `start` / `dev` / `test` |
| `server.js` | Express + Socket.io su porta 3000 (override `PORT`), registri in memoria `controllers` / `tvs`, relay del protocollo, validazione e gestione errori |
| `public/.gitkeep` | la cartella `public/` esiste ed è servita staticamente |
| `scripts/smoke-test.js` | smoke test end-to-end headless con `socket.io-client` |
| `package-lock.json` | generato da `npm install` |

Nessun file di `.bus/` preesistente o `knowledge.md` è stato modificato (a parte la creazione di questo report). Nessun HTML/CSS/JS dentro `public/`.

## Scelte tecniche

- **Slot controller**: riuso del **primo slot libero** (1-based) quando un controller si disconnette; documentato in un commento sopra `allocateSlot()` in `server.js`.
- **Doppio `start()`**: se il server è già in ascolto la Promise si risolve subito con la porta effettiva; una chiamata concorrente riusa la stessa Promise → nessun doppio listen.
- **Errori HTTP**: `sendFile` con callback: `ENOENT` → 404 con il testo dello step, altri errori → 500 con messaggio generico (nessuno stack trace al client).
- **Movimento** inoltrato con `io.to('tvs').volatile.emit('motion', ...)`; tasti, calibrazione, presenza, lifecycle e liste emessi in modo affidabile.
- **Validazione**: `finiteNumber()` per tutti i campi; `alpha` normalizzato in `[0, 360)`, `beta` clampato in `[-180, 180]`, `gamma` in `[-90, 90]`; pacchetto scartato in silenzio se un campo non è finito. Ogni handler è in `try/catch`.
- **Log**: solo eventi discreti (listen, connect, registrazione, disconnect). Nessun log per singolo pacchetto di movimento.
- **Ruoli**: primo `hello` valido fissa il ruolo; ruolo diverso → `error` `{ code: 'already_registered' }`; stesso ruolo → ack idempotente senza doppia registrazione.
- **`tv:controller_list`**: inviato alla nuova TV dopo `tv:ready` e a tutte le TV a ogni variazione dell'elenco; `controller:connected` / `controller:disconnected` notificano le TV, `tv:presence` i controller.

## Criteri di accettazione — output

### 1. `npm install`

```
$ npm install
added 96 packages, and audited 97 packages in 6s

19 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

### 2. Syntax check

```
$ node --check server.js && node --check scripts/smoke-test.js
SYNTAX OK          (exit 0)
```

### 3. `npm test`

```
$ npm test

> mini-wii-web-console@0.1.0 test
> node scripts/smoke-test.js

OK server avviato con start(0) sulla porta 46809
socket connesso: BKarxgmZd-rsfzjxAAAA
socket connesso: YpS-9_8mq3wp55eeAAAB
OK client TV e controller connessi via websocket
tv registrata: BKarxgmZd-rsfzjxAAAA
OK tv:ready con protocol 1 e id stringa
controller registrato: YpS-9_8mq3wp55eeAAAB (Test Wiimote, slot 1)
OK controller:ready con id e slot >= 1
OK TV riceve controller:connected con id corretto e total >= 1
OK motion inoltrato alla TV con valori identici, id corretto e serverTime
OK button A/down inoltrato alla TV con id corretto
OK calibrate inoltrato alla TV con id corretto
OK motion invalido scartato (nessun evento entro 300 ms)
controller disconnesso: YpS-9_8mq3wp55eeAAAB
OK controller:disconnected ricevuto con total aggiornato
tv disconnessa: BKarxgmZd-rsfzjxAAAA
OK client, server e Socket.io chiusi in modo pulito
SMOKE TEST PASSED
```

Exit code: **0**.

### 4. Avvio reale (`PORT=3000 npm start`)

```
$ PORT=3000 node server.js
Mini-Wii Web Console in ascolto sulla porta 3000
TV: http://localhost:3000/tv
Telefono: http://192.168.178.30:3000/controller
Telefono: http://172.18.0.1:3000/controller
Telefono: http://100.74.211.1:3000/controller
```

```
$ curl -s localhost:3000/healthz
{"ok":true,"uptime":2,"controllers":0,"tvs":0}

$ curl -sI localhost:3000/
HTTP/1.1 302 Found
Location: /tv
Vary: Accept
Content-Type: text/plain; charset=utf-8
...

$ curl -s -o /tmp/body -w '%{http_code}' localhost:3000/tv
404
$ cat /tmp/body
tv.html non ancora disponibile (STEP 3)

$ curl -s -o /tmp/body -w '%{http_code}' localhost:3000/controller
404
$ cat /tmp/body
controller.html non ancora disponibile (STEP 2)
```

Processo terminato dopo la verifica.

### 5. `require('./server.js')` non apre porte

```
$ node -e "const s=require('./server.js'); console.log('listening_subito_dopo_require:', s.server.listening); setTimeout(()=>{console.log('listening_dopo_500ms_senza_start:', s.server.listening); process.exit(0)},500)"
listening_subito_dopo_require: false
listening_dopo_500ms_senza_start: false
```

### 6. Altri controlli

- Nessun `console.log` negli handler `controller:motion` / `controller:button` / `controller:calibrate`.
- Dipendenze runtime: solo `express` e `socket.io` (devDep: `socket.io-client`).
- `node_modules/` non committato (già in `.gitignore`).

## Stato

Tutti i criteri di accettazione dello STEP 1 sono soddisfatti. Protocollo pronto per essere usato dagli STEP 2 (controller), 3 (TV) e 4 (minigiochi).
