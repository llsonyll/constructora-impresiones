// Lista en memoria de los últimos trabajos detectados (SNMP + PaperCut).
// No persiste en disco ni en la nube: es solo lo que el agente sirve por
// /jobs mientras está corriendo. La app web decide qué hacer con cada uno
// (asignar a una venta, ignorar, o guardarlo pendiente en su propio
// localStorage) y lleva su propio control de cuáles ya vio.
function createJobBuffer(maxSize) {
  const limit = maxSize || 300;
  // token único por cada arranque del agente, para que los ids nunca
  // choquen con los de una corrida anterior (importante: el navegador
  // puede quedar con la pestaña abierta de una sesión previa del agente)
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let seq = 0;
  const items = [];

  function push(data) {
    seq += 1;
    const job = { seq, id: 'job-' + runId + '-' + seq, ...data };
    items.push(job);
    if (items.length > limit) items.shift();
    return job;
  }

  function getAll() {
    return items.slice();
  }

  return { push, getAll };
}

module.exports = { createJobBuffer };
