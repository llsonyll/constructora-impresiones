// Formato local "YYYY-MM-DD HH:mm:ss" (mismo que usa el CSV de PaperCut),
// para que todos los trabajos del agente tengan la misma convención.
function toLocalString(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = { toLocalString };
