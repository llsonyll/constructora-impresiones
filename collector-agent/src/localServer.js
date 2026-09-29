const http = require('http');

// Servidor HTTP mínimo, solo escucha en 127.0.0.1 (no expuesto a la red).
// Por ahora solo expone /health para probar que una página HTTPS puede
// hablarle a este proceso en localhost (contenido mixto).
function createLocalServer(cfg, { log, jobBuffer }) {
  const port = (cfg.localServer && cfg.localServer.port) || 4000;
  const allowedOrigin = (cfg.localServer && cfg.localServer.allowedOrigin) || '*';

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agente: 'ferreteria-collector', hora: new Date().toISOString() }));
      return;
    }

    if (req.url === '/jobs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jobBuffer ? jobBuffer.getAll() : []));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('error', (e) => log(`[servidor local] error: ${e.message}`));

  server.listen(port, '127.0.0.1', () => {
    log(`[servidor local] escuchando en http://localhost:${port} (origen permitido: ${allowedOrigin})`);
  });

  return server;
}

module.exports = { createLocalServer };
