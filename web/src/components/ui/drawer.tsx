import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'

// shadcn/ui Drawer (Vaul): hoja inferior que se cierra arrastrando hacia abajo.

function Drawer(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn('text-lg font-semibold', className)} {...props} />
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description data-slot="drawer-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay data-slot="drawer-overlay" className="fixed inset-0 z-40 bg-black/40" />
      <DrawerPrimitive.Content data-slot="drawer-content"
        className={cn('fixed inset-x-0 bottom-0 z-40 flex max-h-[92dvh] flex-col rounded-t-2xl bg-background outline-none', className)}
        {...props}>
        <div aria-hidden className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  )
}

export { Drawer, DrawerContent, DrawerDescription, DrawerTitle }
