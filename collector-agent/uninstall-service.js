const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'FerreteriaCollector',
  script: path.join(__dirname, 'src', 'index.js'),
});

svc.on('uninstall', () => {
  console.log('Servicio "FerreteriaCollector" desinstalado.');
});

svc.uninstall();
