import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /**
   * UI a mostrar cuando hay un error. Recibe el error y una función para limpiar el estado.
   * Si no se pasa, se muestra una pantalla completa con botón para recargar.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 p-6 text-center">
        <h1 className="text-lg font-semibold">Algo salió mal</h1>
        <p className="max-w-sm text-sm text-stone-500">
          Ocurrió un error inesperado. Podés recargar la página o volver al inicio.
        </p>
        {import.meta.env.DEV && (
          <pre className="max-w-full overflow-auto rounded-lg bg-stone-800 p-4 text-left text-xs text-stone-100">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3">
          <a href="#/" className="rounded-lg border px-4 py-2 text-sm">
            Ir al inicio
          </a>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white"
          >
            Recargar página
          </button>
        </div>
      </div>
    )
  }
}
