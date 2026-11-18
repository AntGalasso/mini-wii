# Mini-Wii Web Console

Console di gioco "Wii-like" nel browser: il PC fa da schermo TV, il telefono fa da
Wiimote con giroscopio, accelerometro e tasti A/B/Calibra.

Stack: Node.js + Express + Socket.io + HTML5 Canvas. Nessuna dipendenza CDN.

## Avvio

```bash
npm install && npm start
```

Il server ascolta sulla porta `3000` (modificabile con `PORT`). All'avvio stampa
gli indirizzi utili per PC e telefono.

## Come si gioca

1. Apri **`http://<ip-del-pc>:3000/tv`** sul PC: vedi il QR e l'URL del telecomando.
2. Inquadra il QR con il telefono oppure apri **`http://<ip-del-pc>:3000/controller`**
   sullo stesso telefono, **stessa rete Wi-Fi** del PC.
3. Concedi il permesso ai sensori quando richiesto, poi muovi il telefono: il mirino
   sulla TV segue l'orientamento in tempo reale.
4. Premi **A/B** per i click e **Calibra** per ricentrare il mirino.

Tasti sulla schermata TV: **F** = schermo intero, **C** = centra il mirino.

## Note

- **HTTPS / giroscopio**: i browser mobili espongono `DeviceOrientationEvent` solo in
  contesto sicuro (HTTPS o `localhost`). Se apri il controller via IP in HTTP, la pagina
  resta utilizzabile con il **touch-pad di fallback**; per il giroscopio in rete locale
  serve HTTPS (es. reverse proxy con certificato) oppure un tunnel HTTPS.
- Il QR è generato **lato server** dall'endpoint `GET /qr?url=...` (`qrcode`, SVG,
  correzione errori `M`); vengono accettati solo URL `http:`/`https:` con host valido.
- Il mirino si attenua dopo 5 secondi senza movimento e torna pieno al primo pacchetto.
- Contatore e lista dei telefoni collegati sono in alto; oltre 4 controller compare `…`.

## Mappa eventi Socket.io

| Direzione | Evento | Payload |
| --- | --- | --- |
| TV → server | `tv:hello` | `{}` |
| server → TV | `tv:ready` | `{ id, serverTime, protocol, controllers[] }` |
| server → TV | `tv:controller_list` | `{ controllers[], total }` |
| server → TV | `controller:connected` | `{ id, name, connectedAt, total }` |
| server → TV | `controller:disconnected` | `{ id, total }` |
| server → TV | `motion` (volatile) | `{ id, alpha, beta, gamma, ax, ay, az, swing, t, serverTime }` |
| server → TV | `button` | `{ id, button, state, t }` |
| server → TV | `calibrate` | `{ id, t }` |
| controller → server | `controller:hello` | `{ name }` |
| controller → server | `controller:motion` | `{ alpha, beta, gamma, ax, ay, az, swing, t }` |
| controller → server | `controller:button` | `{ button, state, t }` |
| controller → server | `controller:calibrate` | `{ t }` |
| server → controller | `controller:ready` | `{ id, slot, serverTime, protocol }` |
| server → controller | `tv:presence` | `{ online, total }` |

`alpha` ∈ [0, 360), `beta` ∈ [-180, 180], `gamma` ∈ [-90, 90].

## Test

```bash
npm test
```

Smoke test senza browser: avvia il server su porta effimera, verifica socket
(registrazione, motion, button, calibrate, disconnessione) e HTTP (`/`, `/tv`, `/qr`,
URL QR non valido, 404).
