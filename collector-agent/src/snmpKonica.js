const snmp = require('net-snmp');
const { loadState, saveState } = require('./state');

// OIDs confirmados (ver investigación previa). printsBW/printsColor solo
// se usan como cross-check informativo, nunca generan capturas (esas
// vienen de PaperCut Print Logger, para no duplicar conteo).
const OIDS = {
  copiesBW: '1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.1.1',
  copiesColor: '1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.2.1',
  printsBW: '1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.1.2',
  printsColor: '1.3.6.1.4.1.18334.1.1.1.5.7.2.2.1.5.2.2',
};

function getCounters(cfg) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(cfg.ip, cfg.community, {
      version: snmp.Version1,
      timeout: 4000,
      retries: 1,
    });
    const oids = [OIDS.copiesBW, OIDS.copiesColor, OIDS.printsBW, OIDS.printsColor];
    session.get(oids, (err, varbinds) => {
      session.close();
      if (err) return reject(err);
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) return reject(new Error(snmp.varbindError(vb)));
      }
      resolve({
        copiesBW: Number(varbinds[0].value),
        copiesColor: Number(varbinds[1].value),
        printsBW: Number(varbinds[2].value),
        printsColor: Number(varbinds[3].value),
      });
    });
  });
}

function createPoller(cfg, { onCapture, log }) {
  const stateFile = path_join(cfg.statePath, 'konica-state.json');
  let state = loadState(stateFile, {
    baseline: null,
    lastSeen: null,
    lastChangeAt: null,
    lastPrints: null,
  });

  async function tick() {
    let current;
    try {
      current = await getCounters(cfg.konica);
    } catch (e) {
      log(`[konica] error leyendo SNMP: ${e.message}`);
      return;
    }

    // primera corrida: solo establece la línea base, no genera captura
    // (no sabemos si hubo un trabajo justo antes de arrancar el agente)
    if (!state.baseline) {
      state.baseline = current;
      state.lastSeen = current;
      state.lastChangeAt = null;
      state.lastPrints = { printsBW: current.printsBW, printsColor: current.printsColor };
      saveState(stateFile, state);
      log(`[konica] línea base establecida: BN=${current.copiesBW} Color=${current.copiesColor}`);
      return;
    }

    const changed =
      !state.lastSeen ||
      current.copiesBW !== state.lastSeen.copiesBW ||
      current.copiesColor !== state.lastSeen.copiesColor;
    if (changed) state.lastChangeAt = Date.now();
    state.lastSeen = current;

    const grewBW = current.copiesBW - state.baseline.copiesBW;
    const grewColor = current.copiesColor - state.baseline.copiesColor;
    const stableFor = state.lastChangeAt ? Date.now() - state.lastChangeAt : Infinity;

    if ((grewBW > 0 || grewColor > 0) && stableFor >= cfg.konica.stabilizeMs) {
      const ts = new Date(state.lastChangeAt).toISOString();
      if (grewBW > 0) {
        await onCapture({
          fuente: 'konica-copia',
          impresora: 'Konica Minolta bizhub C558',
          timestamp: ts,
          hojas: grewBW,
          color: false,
        });
        log(`[konica] copia B/N registrada: ${grewBW} hojas`);
      }
      if (grewColor > 0) {
        await onCapture({
          fuente: 'konica-copia',
          impresora: 'Konica Minolta bizhub C558',
          timestamp: ts,
          hojas: grewColor,
          color: true,
        });
        log(`[konica] copia color registrada: ${grewColor} hojas`);
      }
      state.baseline = current;
      state.lastChangeAt = null;
    }

    // cross-check informativo: compara contra el contador de IMPRESIÓN del
    // propio Konica (no de copia). Solo se registra en el log, nunca crea
    // una captura -- las impresiones PC vienen únicamente de PaperCut.
    if (state.lastPrints) {
      const dBW = current.printsBW - state.lastPrints.printsBW;
      const dColor = current.printsColor - state.lastPrints.printsColor;
      if (dBW > 0 || dColor > 0) {
        log(`[konica] cross-check: contador de impresión avanzó BN+${dBW} Color+${dColor} (comparar con PaperCut)`);
      }
    }
    state.lastPrints = { printsBW: current.printsBW, printsColor: current.printsColor };

    saveState(stateFile, state);
  }

  return { tick };
}

function path_join(...parts) {
  return require('path').join(...parts);
}

module.exports = { createPoller };
