const fs = require('fs');
const path = require('path');

function loadState(file, defaults) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {
    return { ...defaults };
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

module.exports = { loadState, saveState };
