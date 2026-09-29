const path = require('path');
const fs = require('fs');
const { createPoller } = require('./snmpKonica');
const { createWatcher } = require('./papercutWatcher');
const { createLocalServer } = require('./localServer');
const { createJobBuffer } = require('./jobBuffer');

const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Falta config.json. Copia config.example.json a config.json y completa los datos.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.statePath = path.resolve(__dirname, '..', config.statePath || './state');
fs.mkdirSync(config.statePath, { recursive: true });

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(config.statePath, 'agent.log'), line + '\n');
  } catch (e) {
    /* si falla el log a archivo, seguimos igual */
  }
}

// Por ahora el agente NO escribe en Firebase: todo lo detectado queda
// en este buffer en memoria, servido por /jobs para que la app web lo
// consuma por HTTP directo (ver test-agente.html). Firestore se retoma
// más adelante si se decide llevar los datos a la nube.
const jobBuffer = createJobBuffer((config.localServer && config.localServer.bufferSize) || 300);

async function onCapture(data) {
  const job = jobBuffer.push(data);
  log(`trabajo detectado (#${job.seq}): ${data.fuente} · ${data.hojas} hojas · color=${!!data.color}`);
}

const konicaPoller = createPoller(config, { onCapture, log });
const papercutWatcher = createWatcher(config, { onCapture, log });
createLocalServer(config, { log, jobBuffer });

log('Agente de captura iniciado (modo local, sin Firebase).');

setInterval(() => {
  konicaPoller.tick().catch((e) => log(`[konica] error inesperado: ${e.message}`));
}, config.konica.pollIntervalMs);

setInterval(() => {
  papercutWatcher.tick().catch((e) => log(`[papercut] error inesperado: ${e.message}`));
}, config.papercut.pollIntervalMs);

konicaPoller.tick().catch((e) => log(`[konica] error inesperado: ${e.message}`));
papercutWatcher.tick().catch((e) => log(`[papercut] error inesperado: ${e.message}`));

process.on('SIGINT', () => {
  log('Agente detenido (SIGINT).');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('Agente detenido (SIGTERM).');
  process.exit(0);
});
