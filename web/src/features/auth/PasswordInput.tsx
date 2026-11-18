import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Campo de contraseña con botón para mostrarla u ocultarla mientras se escribe. */
export default function PasswordInput({ className = '', ...props }: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
             className={`min-h-12 w-full rounded-lg border pl-3 pr-12 text-base ${className}`} />
      <button type="button" onClick={() => setVisible(v => !v)}
              aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible}
              title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-stone-500 hover:text-stone-800">
        {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  )
}
