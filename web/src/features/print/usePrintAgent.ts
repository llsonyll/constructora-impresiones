import { useEffect, useRef, useState } from 'react'
import { createAgentClient, type EstadoAgente } from './agent'
import type { Job } from './core'

/**
 * Conecta con el agente local (localhost:4000) al montar y lo consulta mientras responda.
 * Los pendientes se guardan en localStorage del navegador, así sobreviven a recargas.
 */
export function usePrintAgent() {
  const [pendientes, setPendientes] = useState<Job[]>([])
  const [estado, setEstado] = useState<EstadoAgente>('nunca')
  const [ultimoNuevo, setUltimoNuevo] = useState<Job | null>(null)
  const ref = useRef<ReturnType<typeof createAgentClient> | null>(null)

  useEffect(() => {
    const client = createAgentClient({
      onCambio: p => setPendientes([...p]),
      onNuevos: nuevos => setUltimoNuevo(nuevos[nuevos.length - 1]),
      onEstado: setEstado,
    })
    ref.current = client
    setPendientes([...client.pendientes])
    void client.conectar()
    return () => { client.destruir(); ref.current = null }
  }, [])

  return {
    pendientes, estado, ultimoNuevo,
    descartarAviso: () => setUltimoNuevo(null),
    conectar: () => ref.current?.conectar(),
    quitar: (id: string) => ref.current?.quitar(id),
    dejarHojas: (id: string, hojas: number) => ref.current?.dejarHojas(id, hojas),
  }
}

export type PrintAgent = ReturnType<typeof usePrintAgent>
