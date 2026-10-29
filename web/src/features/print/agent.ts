// Cliente del agente local (collector-agent en http://localhost:4000), sin UI.
// Guarda los trabajos pendientes y los ya vistos en localStorage para que sobrevivan a recargas;
// la UI se entera de los cambios por callbacks (ver usePrintAgent).
import type { Job } from './core'

export const AGENT_URL = 'http://localhost:4000'
const VISTOS_KEY = 'ferreteria_agente_vistos'
const PENDIENTES_KEY = 'ferreteria_agente_pendientes'

function load<T>(key: string, def: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) || def } catch { return def }
}
function save(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* sin espacio o bloqueado */ }
}

export type EstadoAgente = 'nunca' | 'conectando' | 'conectado' | 'perdido'

interface Opciones {
  url?: string
  intervalMs?: number
  onCambio?: (pendientes: Job[]) => void
  onNuevos?: (nuevos: Job[]) => void
  onEstado?: (estado: EstadoAgente) => void
}

export function createAgentClient({ url = AGENT_URL, intervalMs = 6000, onCambio, onNuevos, onEstado }: Opciones = {}) {
  const vistos = new Set<string>(load<string[]>(VISTOS_KEY, []))
  let pendientes = load<Job[]>(PENDIENTES_KEY, [])
  let estado: EstadoAgente = 'nunca'
  let timer: ReturnType<typeof setInterval> | null = null

  function guardar() {
    save(PENDIENTES_KEY, pendientes)
    save(VISTOS_KEY, Array.from(vistos).slice(-1000))
    onCambio?.(pendientes)
  }
  function setEstado(e: EstadoAgente) { estado = e; onEstado?.(e) }

  /** Devuelve cuántos trabajos nuevos llegaron. */
  async function traerJobs() {
    const res = await fetch(url + '/jobs')
    if (!res.ok) throw new Error('bad status')
    const jobs = (await res.json()) as Job[]
    const nuevos = jobs.filter(j => !vistos.has(j.id))
    nuevos.forEach(j => { vistos.add(j.id); pendientes.push(j) })
    if (nuevos.length) { guardar(); onNuevos?.(nuevos) }
    return nuevos.length
  }

  function detener() { if (timer) clearInterval(timer); timer = null }

  async function poll() {
    try { await traerJobs() } catch { setEstado('perdido'); detener() }
  }

  /** Un intento (al cargar o con el botón "Conectar"); si responde, queda consultando cada `intervalMs`. */
  async function conectar(): Promise<number | null> {
    const antes = estado
    if (antes !== 'conectado') setEstado('conectando')
    try {
      const nuevos = await traerJobs()
      if (estado !== 'conectado') setEstado('conectado')
      if (!timer) timer = setInterval(poll, intervalMs)
      return nuevos
    } catch {
      detener()
      setEstado(antes === 'conectado' || antes === 'perdido' ? 'perdido' : 'nunca')
      return null
    }
  }

  /**
   * Botón "Actualizar": pide al agente revisar PaperCut y el Konica ya (sin esperar su intervalo ni que la
   * copiadora quede quieta) y trae lo nuevo. Devuelve cuántos trabajos nuevos llegaron, o null si no respondió.
   */
  async function revisar() {
    // Un agente sin /scan (versión anterior) responde 404: igual se leen los trabajos que ya tenga.
    try { await fetch(url + '/scan', { method: 'POST' }) } catch { /* conectar() reporta el estado */ }
    return conectar()
  }

  const alVolver = () => { if (document.visibilityState === 'visible' && estado === 'conectado') void poll() }
  document.addEventListener('visibilitychange', alVolver)

  return {
    get pendientes() { return pendientes },
    get estado() { return estado },
    conectar,
    revisar,
    /** Quita un trabajo (asignado completo o ignorado). */
    quitar(id: string) { pendientes = pendientes.filter(j => j.id !== id); guardar() },
    /** Deja pendientes solo las hojas que faltan asignar. */
    dejarHojas(id: string, hojas: number) {
      pendientes = hojas > 0 ? pendientes.map(j => j.id === id ? { ...j, hojas } : j) : pendientes.filter(j => j.id !== id)
      guardar()
    },
    destruir() {
      detener()
      document.removeEventListener('visibilitychange', alVolver)
    },
  }
}
