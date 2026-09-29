const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'FerreteriaCollector',
  description: 'Captura automática de impresiones y copias (Epson/PaperCut + Konica SNMP) hacia Firestore.',
  script: path.join(__dirname, 'src', 'index.js'),
  // reinicia solo si se cae inesperadamente
  wait: 2,
  grow: 0.25,
  maxRetries: 10,
});

svc.on('install', () => {
  console.log('Servicio "FerreteriaCollector" instalado. Iniciando...');
  svc.start();
});
svc.on('alreadyinstalled', () => {
  console.log('El servicio ya estaba instalado.');
});
svc.on('start', () => {
  console.log('Servicio iniciado. Revisa el Visor de eventos de Windows o state/agent.log para ver el estado.');
});

svc.install();
