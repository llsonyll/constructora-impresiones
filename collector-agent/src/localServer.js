const http = require('http');

// Servidor HTTP mínimo, solo escucha en 127.0.0.1 (no expuesto a la red).
// Expone /health, /jobs (lo que el POS lee) y POST /scan (revisar ya).
function createLocalServer(cfg, { log, jobBuffer, revisarAhora }) {
  const port = (cfg.localServer && cfg.localServer.port) || 4000;
  // allowedOrigin: un origen, una lista (app de impresiones + POS) o '*'.
  const conf = (cfg.localServer && cfg.localServer.allowedOrigin) || '*';
  const allowed = Array.isArray(conf) ? conf : [conf];

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chrome pide permiso explícito para que una página pública consulte localhost (Private Network Access).
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

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

    if (req.url === '/scan' && req.method === 'POST') {
      if (!revisarAhora) {
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'revisión manual no disponible' }));
        return;
      }
      revisarAhora().then(
        (nuevos) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, nuevos }));
        },
        (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('error', (e) => log(`[servidor local] error: ${e.message}`));

  server.listen(port, '127.0.0.1', () => {
    log(`[servidor local] escuchando en http://localhost:${port} (orígenes permitidos: ${allowed.join(', ')})`);
  });

  return server;
}

module.exports = { createLocalServer };
