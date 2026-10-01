import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

// shadcn/ui Dialog (Radix). Centrado con flex en vez de translate, para que hijos `fixed`
// (p. ej. el escáner) no queden atrapados dentro del panel.

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold', className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay"
        className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4">
        <DialogPrimitive.Content data-slot="dialog-content"
          className={cn('pointer-events-auto max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-background p-4 shadow-lg outline-none',
                        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
                        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95', className)}
          {...props}>
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  )
}

export { Dialog, DialogContent, DialogDescription, DialogTitle }
