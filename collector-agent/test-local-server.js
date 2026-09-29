// Prueba mínima: solo levanta el servidor HTTP local en 127.0.0.1.
// No requiere config.json ni service-account.json.
//
// Uso: node test-local-server.js
// Después abre en el navegador (o desde la página de prueba en GitHub Pages)
// una petición GET a http://localhost:4000/health

const { createLocalServer } = require('./src/localServer');

createLocalServer(
  { localServer: { port: 4000, allowedOrigin: '*' } },
  { log: (msg) => console.log(msg) }
);

console.log('Prueba mínima corriendo. Abre https://tu-sitio.github.io/test-agente.html para probar, o entra a http://localhost:4000/health directo en el navegador de esa PC.');
console.log('Presiona Ctrl+C para detener.');
