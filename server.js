'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const PROTOCOL = 1;

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout: 10000,
  maxHttpBufferSize: 1e5,
});

// Registri in memoria: nessuna persistenza.
const controllers = new Map(); // id -> { id, connectedAt, lastMotionAt, name, slot }
const tvs = new Map(); // id -> { id, connectedAt }

/* ---------------------------------------------------------------------------
 * Helper
 * ------------------------------------------------------------------------ */

/** Converte in numero solo i valori finiti, altrimenti null. */
function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Nome controller: max 24 caratteri [A-Za-z0-9 _-], trim, default "Wiimote". */
function sanitizeName(raw) {
  if (raw === undefined || raw === null) return 'Wiimote';
  const cleaned = String(raw)
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .slice(0, 24);
  return cleaned || 'Wiimote';
}

/**
 * Slot 1-based: viene riusato il primo slot libero quando un controller
 * si disconnette (contatore non monotono).
 */
function allocateSlot() {
  const used = new Set(Array.from(controllers.values(), (c) => c.slot));
  let slot = 1;
  while (used.has(slot)) slot += 1;
  return slot;
}

function controllerList() {
  return Array.from(controllers.values(), (c) => ({
    id: c.id,
    name: c.name,
    connectedAt: c.connectedAt,
  }));
}

/** Invia l'elenco aggiornato dei controller a tutte le TV. */
function broadcastControllerList() {
  io.to('tvs').emit('tv:controller_list', {
    controllers: controllerList(),
    total: controllers.size,
  });
}

function notifyPresence() {
  io.to('controllers').emit('tv:presence', {
    online: tvs.size > 0,
    total: tvs.size,
  });
}

/** Restituisce il record controller se il socket è registrato come controller. */
function getController(socket) {
  if (socket.data.role !== 'controller') return null;
  return controllers.get(socket.id) || null;
}

/** Serve una pagina statica gestendo in modo esplicito l'ENOENT. */
function sendPage(res, fileName, missingText) {
  res.sendFile(path.join(__dirname, 'public', fileName), (err) => {
    if (!err) return;
    if (res.headersSent) return;
    if (err.code === 'ENOENT') {
      res.status(404).type('text/plain').send(missingText);
    } else {
      res.status(500).type('text/plain').send('Errore interno del server');
    }
  });
}

/* ---------------------------------------------------------------------------
 * HTTP
 * ------------------------------------------------------------------------ */

app.get('/', (req, res) => {
  res.redirect(302, '/tv');
});

app.get('/tv', (req, res) => {
  sendPage(res, 'tv.html', 'tv.html non ancora disponibile (STEP 3)');
});

app.get('/controller', (req, res) => {
  sendPage(res, 'controller.html', 'controller.html non ancora disponibile (STEP 2)');
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    controllers: controllers.size,
    tvs: tvs.size,
  });
});

/* ---------------------------------------------------------------------------
 * Socket.io
 * ------------------------------------------------------------------------ */

io.on('connection', (socket) => {
  console.log(`socket connesso: ${socket.id}`);
  socket.data.role = null;

  /* ---------------------------- Controller ---------------------------- */

  socket.on('controller:hello', (payload) => {
    try {
      if (socket.data.role === 'tv') {
        socket.emit('error', { code: 'already_registered' });
        return;
      }
      if (socket.data.role === 'controller') {
        // Secondo hello con lo stesso ruolo: idempotente.
        const existing = controllers.get(socket.id);
        if (!existing) return;
        socket.emit('controller:ready', {
          id: existing.id,
          slot: existing.slot,
          serverTime: Date.now(),
          protocol: PROTOCOL,
        });
        return;
      }

      const name = sanitizeName(payload && payload.name);
      const record = {
        id: socket.id,
        connectedAt: Date.now(),
        lastMotionAt: null,
        name,
        slot: allocateSlot(),
      };
      controllers.set(socket.id, record);
      socket.data.role = 'controller';
      socket.join('controllers');

      console.log(
        `controller registrato: ${record.id} (${record.name}, slot ${record.slot})`
      );

      socket.emit('controller:ready', {
        id: record.id,
        slot: record.slot,
        serverTime: Date.now(),
        protocol: PROTOCOL,
      });

      // Stato iniziale della TV al solo controller appena registrato.
      socket.emit('tv:presence', { online: tvs.size > 0, total: tvs.size });

      io.to('tvs').emit('controller:connected', {
        id: record.id,
        name: record.name,
        connectedAt: record.connectedAt,
        total: controllers.size,
      });
      broadcastControllerList();
    } catch (err) {
      // Payload malformato: non deve terminare il processo.
    }
  });

  socket.on('controller:motion', (payload) => {
    try {
      const record = getController(socket);
      if (!record) return;

      const data = payload || {};
      const alpha = finiteNumber(data.alpha);
      const beta = finiteNumber(data.beta);
      const gamma = finiteNumber(data.gamma);
      const ax = finiteNumber(data.ax);
      const ay = finiteNumber(data.ay);
      const az = finiteNumber(data.az);
      const swing = finiteNumber(data.swing);
      const t = finiteNumber(data.t);

      if (
        alpha === null ||
        beta === null ||
        gamma === null ||
        ax === null ||
        ay === null ||
        az === null ||
        swing === null ||
        t === null
      ) {
        return; // pacchetto scartato in silenzio
      }

      const now = Date.now();
      record.lastMotionAt = now;

      io.to('tvs').volatile.emit('motion', {
        id: record.id,
        alpha: ((alpha % 360) + 360) % 360,
        beta: Math.max(-180, Math.min(180, beta)),
        gamma: Math.max(-90, Math.min(90, gamma)),
        ax,
        ay,
        az,
        swing,
        t,
        serverTime: now,
      });
    } catch (err) {
      // ignora silenziosamente
    }
  });

  socket.on('controller:button', (payload) => {
    try {
      const record = getController(socket);
      if (!record) return;

      const data = payload || {};
      const button =
        typeof data.button === 'string'
          ? data.button.trim().toUpperCase()
          : '';
      const state = data.state;

      if (!['A', 'B', 'CALIBRA'].includes(button)) return;
      if (state !== 'down' && state !== 'up') return;

      const t = finiteNumber(data.t);
      io.to('tvs').emit('button', {
        id: record.id,
        button,
        state,
        t: t === null ? Date.now() : t,
      });
    } catch (err) {
      // ignora silenziosamente
    }
  });

  socket.on('controller:calibrate', (payload) => {
    try {
      const record = getController(socket);
      if (!record) return;

      const data = payload || {};
      const t = finiteNumber(data.t);
      io.to('tvs').emit('calibrate', {
        id: record.id,
        t: t === null ? Date.now() : t,
      });
    } catch (err) {
      // ignora silenziosamente
    }
  });

  socket.on('controller:bye', () => {
    try {
      socket.disconnect(true);
    } catch (err) {
      // ignora silenziosamente
    }
  });

  /* -------------------------------- TV -------------------------------- */

  socket.on('tv:hello', () => {
    try {
      if (socket.data.role === 'controller') {
        socket.emit('error', { code: 'already_registered' });
        return;
      }
      if (socket.data.role === 'tv') {
        // Secondo hello con lo stesso ruolo: idempotente.
        socket.emit('tv:ready', {
          id: socket.id,
          serverTime: Date.now(),
          protocol: PROTOCOL,
          controllers: controllerList(),
        });
        return;
      }

      tvs.set(socket.id, { id: socket.id, connectedAt: Date.now() });
      socket.data.role = 'tv';
      socket.join('tvs');

      console.log(`tv registrata: ${socket.id}`);

      socket.emit('tv:ready', {
        id: socket.id,
        serverTime: Date.now(),
        protocol: PROTOCOL,
        controllers: controllerList(),
      });
      socket.emit('tv:controller_list', {
        controllers: controllerList(),
        total: controllers.size,
      });

      notifyPresence();
    } catch (err) {
      // Payload malformato: non deve terminare il processo.
    }
  });

  /* ---------------------------- Disconnessione ---------------------------- */

  socket.on('disconnect', () => {
    try {
      if (socket.data.role === 'controller') {
        if (!controllers.has(socket.id)) return;
        controllers.delete(socket.id);
        console.log(`controller disconnesso: ${socket.id}`);
        io.to('tvs').emit('controller:disconnected', {
          id: socket.id,
          total: controllers.size,
        });
        broadcastControllerList();
      } else if (socket.data.role === 'tv') {
        if (!tvs.has(socket.id)) return;
        tvs.delete(socket.id);
        console.log(`tv disconnessa: ${socket.id}`);
        notifyPresence();
      }
    } catch (err) {
      // non deve mai terminare il processo
    }
  });
});

/* ---------------------------------------------------------------------------
 * Avvio
 * ------------------------------------------------------------------------ */

let startPromise = null;

function start(port = PORT) {
  if (server.listening) {
    return Promise.resolve(server.address().port);
  }
  if (startPromise) return startPromise;

  startPromise = new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      startPromise = null;
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      startPromise = null;
      resolve(server.address().port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });

  return startPromise;
}

if (require.main === module) {
  start(PORT)
    .then((actualPort) => {
      console.log(`Mini-Wii Web Console in ascolto sulla porta ${actualPort}`);
      console.log(`TV: http://localhost:${actualPort}/tv`);

      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name] || []) {
          if (net.family === 'IPv4' && !net.internal) {
            console.log(`Telefono: http://${net.address}:${actualPort}/controller`);
          }
        }
      }
    })
    .catch((err) => {
      console.error(`Errore di avvio: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { app, server, io, start };
