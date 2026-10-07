// Cliente del agente local (collector-agent en http://localhost:4000), sin DOM ni backend.
// Guarda los trabajos pendientes y los ya vistos en un `store` (localStorage por defecto)
// para que sobrevivan a recargas; la UI se entera de los cambios por callbacks.

export const AGENT_URL = 'http://localhost:4000'
const VISTOS_KEY = 'ferreteria_agente_vistos'
const PENDIENTES_KEY = 'ferreteria_agente_pendientes'

export const localStore = {
  load(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def } catch { return def } },
  save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* sin espacio o bloqueado */ } },
}

/** @typedef {'nunca' | 'conectando' | 'conectado' | 'perdido'} EstadoAgente */

/**
 * @param {{
 *   url?: string, store?: typeof localStore, intervalMs?: number,
 *   onCambio?: (pendientes: import('./core.js').Job[]) => void,
 *   onNuevos?: (nuevos: import('./core.js').Job[]) => void,
 *   onEstado?: (estado: EstadoAgente) => void,
 * }} [opts]
 */
export function createAgentClient({ url = AGENT_URL, store = localStore, intervalMs = 6000, onCambio, onNuevos, onEstado } = {}) {
  const vistos = new Set(store.load(VISTOS_KEY, []))
  /** @type {import('./core.js').Job[]} */
  let pendientes = store.load(PENDIENTES_KEY, [])
  /** @type {EstadoAgente} */
  let estado = 'nunca'
  let timer = null

  function guardar() {
    store.save(PENDIENTES_KEY, pendientes)
    store.save(VISTOS_KEY, Array.from(vistos).slice(-1000))
    onCambio?.(pendientes)
  }
  function setEstado(e) { estado = e; onEstado?.(e) }

  async function traerJobs() {
    const res = await fetch(url + '/jobs')
    if (!res.ok) throw new Error('bad status')
    const jobs = await res.json()
    const nuevos = jobs.filter(j => !vistos.has(j.id))
    nuevos.forEach(j => { vistos.add(j.id); pendientes.push(j) })
    if (nuevos.length) { guardar(); onNuevos?.(nuevos) }
  }

  function detener() { clearInterval(timer); timer = null }

  async function poll() {
    try { await traerJobs() } catch { setEstado('perdido'); detener() }
  }

  /** Un intento (al cargar o con el botón "Conectar"); si responde, queda consultando cada `intervalMs`. */
  async function conectar() {
    const antes = estado
    if (antes !== 'conectado') setEstado('conectando')
    try {
      await traerJobs()
      if (estado !== 'conectado') setEstado('conectado')
      if (!timer) timer = setInterval(poll, intervalMs)
    } catch {
      detener()
      setEstado(antes === 'conectado' || antes === 'perdido' ? 'perdido' : 'nunca')
    }
  }

  const alVolver = () => { if (document.visibilityState === 'visible' && estado === 'conectado') poll() }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alVolver)

  return {
    get pendientes() { return pendientes },
    get estado() { return estado },
    conectar,
    /** Quita un trabajo (asignado completo o ignorado). */
    quitar(id) { pendientes = pendientes.filter(j => j.id !== id); guardar() },
    /** Deja pendientes solo las hojas que faltan asignar. */
    dejarHojas(id, hojas) {
      pendientes = hojas > 0 ? pendientes.map(j => j.id === id ? { ...j, hojas } : j) : pendientes.filter(j => j.id !== id)
      guardar()
    },
    destruir() {
      detener()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alVolver)
    },
  }
}
