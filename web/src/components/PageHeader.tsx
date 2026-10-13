import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

interface Props {
  title: ReactNode
  /** Ruta a la que vuelve, o función (p. ej. para preguntar antes si hay cambios sin guardar). */
  back?: string | (() => void)
  /** Nombre de la pantalla anterior, para el lector de pantalla ("Volver a Inventario"). */
  backLabel?: string
  /** Acciones a la derecha (botón principal, fecha…). */
  children?: ReactNode
}

/** Encabezado común de las pantallas: volver (si aplica), título y acciones. */
export default function PageHeader({ title, back, backLabel, children }: Props) {
  const label = backLabel ? `Volver a ${backLabel}` : 'Volver'
  const cls = '-ml-2 grid size-11 shrink-0 place-items-center rounded-lg text-amber-800 active:bg-stone-200'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {typeof back === 'string' && <Link to={back} className={cls} aria-label={label}><ChevronLeft className="size-6" /></Link>}
      {typeof back === 'function' && <button type="button" onClick={back} className={cls} aria-label={label}><ChevronLeft className="size-6" /></button>}
      <h1 className="mr-auto min-w-0 text-lg font-semibold">{title}</h1>
      {children}
    </div>
  )
}
