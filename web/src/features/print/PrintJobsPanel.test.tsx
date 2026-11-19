import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import PrintJobsPanel from './PrintJobsPanel'
import type { PrintAgent } from './usePrintAgent'
import type { Job } from './core'
import { COPIA } from './core'

// Sheet es un componente de presentación; lo mockeamos para aislar el comportamiento del panel.
vi.mock('@/components/Sheet', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

function makeJob(id: string): Job {
  return { id, fuente: COPIA, hojas: 1, color: false }
}

function makeAgent(numPendientes: number, overrides: Partial<PrintAgent> = {}): PrintAgent {
  return {
    pendientes: Array.from({ length: numPendientes }, (_, i) => makeJob(`j${i}`)),
    estado: 'nunca',
    ultimoNuevo: null,
    revisando: false,
    revisar: vi.fn(),
    descartarAviso: vi.fn(),
    conectar: vi.fn(),
    quitar: vi.fn(),
    limpiarAntiguos: vi.fn(),
    dejarHojas: vi.fn(),
    ...overrides,
  }
}

const baseProps = { products: [], onAdd: vi.fn(), onClose: vi.fn() }

describe('PrintJobsPanel – botón limpiar antiguos', () => {
  it('no aparece con exactamente 50 trabajos', () => {
    render(<PrintJobsPanel agent={makeAgent(50)} {...baseProps} />)
    expect(screen.queryByRole('button', { name: /limpiar antiguos/i })).not.toBeInTheDocument()
  })

  it('aparece cuando hay más de 50 trabajos', () => {
    render(<PrintJobsPanel agent={makeAgent(51)} {...baseProps} />)
    expect(screen.getByRole('button', { name: /limpiar antiguos/i })).toBeInTheDocument()
  })

  it('muestra el conteo correcto de trabajos acumulados', () => {
    render(<PrintJobsPanel agent={makeAgent(75)} {...baseProps} />)
    expect(screen.getByText(/75 trabajos acumulados/i)).toBeInTheDocument()
  })

  it('llama a limpiarAntiguos al hacer click', async () => {
    const limpiarAntiguos = vi.fn()
    const user = userEvent.setup()
    render(<PrintJobsPanel agent={makeAgent(51, { limpiarAntiguos })} {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /limpiar antiguos/i }))
    expect(limpiarAntiguos).toHaveBeenCalledOnce()
  })
})
