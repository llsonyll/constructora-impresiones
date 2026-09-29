const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { loadState, saveState } = require('./state');

// Encabezado real del CSV de PaperCut Print Logger (en español).
const HEADER = [
  'Hora', 'Usuario', 'Páginas', 'Copias', 'Impresora', 'Nombre Documento',
  'Cliente', 'Formato Papel', 'Idioma', 'Altura', 'Anchura',
  'Frente/reverso', 'Escala de grises', 'Formato',
];

// PaperCut puede mantener más de un CSV activo a la vez (ej. uno diario y
// uno mensual, ambos actualizándose). Por eso revisamos TODOS los .csv de
// la carpeta en cada chequeo, no solo "el más reciente".
function listAllCsv(folder) {
  const found = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        found.push(full);
      }
    }
  }
  walk(folder);
  return found;
}

function isIgnored(printerName, ignoredList) {
  const lower = (printerName || '').toLowerCase();
  return ignoredList.some((s) => lower.includes(s.toLowerCase()));
}

function rowKey(row) {
  return [row['Hora'], row['Impresora'], row['Nombre Documento'], row['Páginas'], row['Copias']].join('|');
}

function readRows(file, log) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (e) {
    log(`[papercut] error leyendo ${file}: ${e.message}`);
    return [];
  }
  // línea 1 = banner "PaperCut Print Logger - ...", línea 2 = encabezado
  const lines = content.split(/\r?\n/);
  const dataLines = lines.slice(2).filter((l) => l.trim().length);
  if (!dataLines.length) return [];
  try {
    return parse(dataLines.join('\n'), {
      columns: HEADER,
      relax_column_count: true,
      trim: true,
      skip_empty_lines: true,
    });
  } catch (e) {
    log(`[papercut] error parseando CSV (${path.basename(file)}): ${e.message}`);
    return [];
  }
}

function createWatcher(cfg, { onCapture, log }) {
  const stateFile = path.join(cfg.statePath, 'papercut-state.json');
  const state = loadState(stateFile, { seenKeys: [], initialized: false });
  const seen = new Set(state.seenKeys);

  async function tick() {
    const files = listAllCsv(cfg.papercut.logsFolder);
    if (!files.length) {
      log('[papercut] no se encontró ningún CSV todavía en ' + cfg.papercut.logsFolder);
      return;
    }

    let allRows = [];
    for (const file of files) {
      allRows = allRows.concat(readRows(file, log));
    }
    if (!allRows.length) return;

    // primera corrida: solo establece línea base (todo lo que ya está en
    // los CSV se marca como "visto", sin reportarlo como trabajo nuevo)
    if (!state.initialized) {
      allRows.forEach((row) => seen.add(rowKey(row)));
      state.initialized = true;
      state.seenKeys = Array.from(seen).slice(-8000);
      saveState(stateFile, state);
      log(`[papercut] línea base establecida: ${allRows.length} fila(s) existente(s) en ${files.length} archivo(s), marcadas como ya vistas.`);
      return;
    }

    let nuevos = 0;
    for (const row of allRows) {
      const key = rowKey(row);
      if (seen.has(key)) continue;

      if (isIgnored(row['Impresora'], cfg.papercut.ignoredPrinterContains)) {
        seen.add(key);
        continue;
      }

      const paginas = Number(row['Páginas']) || 0;
      const copias = Number(row['Copias']) || 0;
      const hojas = paginas * copias;
      if (hojas <= 0) {
        seen.add(key);
        continue;
      }

      await onCapture({
        fuente: 'pc-print',
        impresora: row['Impresora'],
        timestamp: row['Hora'],
        paginas,
        copias,
        hojas,
        color: row['Escala de grises'] === 'NOT GRAYSCALE',
        duplex: row['Frente/reverso'] === 'DUPLEX',
        formatoPapel: row['Formato Papel'],
        documento: row['Nombre Documento'],
        clientePC: row['Cliente'],
      });
      seen.add(key);
      nuevos++;
    }

    if (nuevos) log(`[papercut] ${nuevos} trabajo(s) nuevo(s) (revisando ${files.length} archivo(s) CSV)`);

    // evita que el set de dedupe crezca sin límite
    state.seenKeys = Array.from(seen).slice(-8000);
    saveState(stateFile, state);
  }

  return { tick };
}

module.exports = { createWatcher };
