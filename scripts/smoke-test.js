'use strict';

// Lo smoke test avvia il server sullo stesso processo, senza display/browser.
process.env.PORT = '0';

const { io: createClient } = require('socket.io-client');
const { start, io, server } = require('../server.js');

const GLOBAL_TIMEOUT_MS = 10000;
const WAIT_TIMEOUT_MS = 3000;

let currentCheck = 'setup';

function ok(name) {
  console.log(`OK ${name}`);
}

function fail(name, detail) {
  console.log(`FAIL ${name}: ${detail}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('timeout di connessione del client'));
    }, WAIT_TIMEOUT_MS);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout in attesa dell'evento "${event}"`));
    }, WAIT_TIMEOUT_MS);

    function onEvent(payload) {
      let matches;
      try {
        matches = predicate(payload);
      } catch (err) {
        clearTimeout(timer);
        socket.off(event, onEvent);
        reject(err);
        return;
      }
      if (!matches) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }

    socket.on(event, onEvent);
  });
}

async function run() {
  let tv = null;
  let controller = null;

  try {
    currentCheck = 'avvio server';
    const port = await start(0);
    assert(Number.isInteger(port) && port > 0, `porta effettiva non valida: ${port}`);
    const url = `http://127.0.0.1:${port}`;
    ok(`server avviato con start(0) sulla porta ${port}`);

    currentCheck = 'connessione client';
    tv = await connect(url);
    controller = await connect(url);
    ok('client TV e controller connessi via websocket');

    currentCheck = 'tv:ready';
    const tvReadyPromise = waitFor(tv, 'tv:ready');
    tv.emit('tv:hello', {});
    const tvReady = await tvReadyPromise;
    assert(typeof tvReady.id === 'string' && tvReady.id.length > 0, 'id non è una stringa');
    assert(tvReady.protocol === 1, `protocol atteso 1, ricevuto ${tvReady.protocol}`);
    ok('tv:ready con protocol 1 e id stringa');

    currentCheck = 'controller:ready / controller:connected';
    const connectedPromise = waitFor(tv, 'controller:connected');
    const readyPromise = waitFor(controller, 'controller:ready');
    controller.emit('controller:hello', { name: 'Test Wiimote' });
    const ctrlReady = await readyPromise;
    assert(typeof ctrlReady.id === 'string' && ctrlReady.id.length > 0, 'id non è una stringa');
    assert(
      Number.isInteger(ctrlReady.slot) && ctrlReady.slot >= 1,
      `slot non valido: ${ctrlReady.slot}`
    );
    ok('controller:ready con id e slot >= 1');

    const connected = await connectedPromise;
    assert(connected.id === ctrlReady.id, 'id controller diverso da quello atteso');
    assert(connected.total >= 1, `total atteso >= 1, ricevuto ${connected.total}`);
    ok('TV riceve controller:connected con id corretto e total >= 1');

    currentCheck = 'motion';
    const sample = {
      alpha: 90,
      beta: 10,
      gamma: -5,
      ax: 0.1,
      ay: 0.2,
      az: 1,
      swing: 3.5,
      t: Date.now(),
    };
    const motionPromise = waitFor(tv, 'motion');
    controller.emit('controller:motion', sample);
    const motion = await motionPromise;
    for (const key of ['alpha', 'beta', 'gamma', 'ax', 'ay', 'az', 'swing', 't']) {
      assert(typeof motion[key] === 'number', `${key} non è numerico`);
      assert(
        Math.abs(motion[key] - sample[key]) < 1e-9,
        `${key} atteso ${sample[key]}, ricevuto ${motion[key]}`
      );
    }
    assert(motion.id === ctrlReady.id, 'id controller errato nel payload motion');
    assert(Number.isFinite(motion.serverTime), 'serverTime non numerico');
    ok('motion inoltrato alla TV con valori identici, id corretto e serverTime');

    currentCheck = 'button';
    const buttonAt = Date.now();
    const buttonPromise = waitFor(tv, 'button');
    controller.emit('controller:button', { button: 'A', state: 'down', t: buttonAt });
    const button = await buttonPromise;
    assert(button.id === ctrlReady.id, 'id controller errato nel payload button');
    assert(button.button === 'A', `button atteso A, ricevuto ${button.button}`);
    assert(button.state === 'down', `state atteso down, ricevuto ${button.state}`);
    assert(button.t === buttonAt, `t atteso ${buttonAt}, ricevuto ${button.t}`);
    ok('button A/down inoltrato alla TV con id corretto');

    currentCheck = 'calibrate';
    const calibratePromise = waitFor(tv, 'calibrate');
    controller.emit('controller:calibrate', {});
    const calibrate = await calibratePromise;
    assert(calibrate.id === ctrlReady.id, 'id controller errato nel payload calibrate');
    assert(Number.isFinite(calibrate.t), 't non numerico nel payload calibrate');
    ok('calibrate inoltrato alla TV con id corretto');

    currentCheck = 'motion invalido';
    let leakedMotion = null;
    const onLeaked = (payload) => {
      leakedMotion = payload;
    };
    tv.on('motion', onLeaked);
    controller.emit('controller:motion', {
      alpha: 'abc',
      beta: 10,
      gamma: -5,
      ax: Infinity,
      ay: 0.2,
      az: 1,
      swing: 3.5,
      t: Date.now(),
    });
    await sleep(300);
    tv.off('motion', onLeaked);
    assert(leakedMotion === null, 'un motion invalido è stato inoltrato alla TV');
    ok('motion invalido scartato (nessun evento entro 300 ms)');

    currentCheck = 'controller:disconnected';
    const disconnectedPromise = waitFor(tv, 'controller:disconnected');
    controller.disconnect();
    controller = null;
    const disconnected = await disconnectedPromise;
    assert(
      disconnected.id === ctrlReady.id,
      `id disconnesso atteso ${ctrlReady.id}, ricevuto ${disconnected.id}`
    );
    assert(disconnected.total === 0, `total atteso 0, ricevuto ${disconnected.total}`);
    ok('controller:disconnected ricevuto con total aggiornato');

    currentCheck = 'chiusura';
    if (tv) {
      tv.disconnect();
      tv = null;
    }
    io.close();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    ok('client, server e Socket.io chiusi in modo pulito');

    console.log('SMOKE TEST PASSED');
    process.exit(0);
  } catch (err) {
    fail(currentCheck, err && err.message ? err.message : String(err));
    console.log('SMOKE TEST FAILED');
    try {
      if (controller) controller.disconnect();
      if (tv) tv.disconnect();
      io.close();
      server.close();
    } catch (cleanupErr) {
      // best effort
    }
    process.exit(1);
  }
}

const globalTimer = setTimeout(() => {
  fail('timeout globale', `il test non è terminato entro ${GLOBAL_TIMEOUT_MS} ms`);
  console.log('SMOKE TEST FAILED');
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);

run().catch((err) => {
  clearTimeout(globalTimer);
  fail(currentCheck, err && err.message ? err.message : String(err));
  console.log('SMOKE TEST FAILED');
  process.exit(1);
});
