import type { ReactNode } from 'react'

/** Bottom sheet with backdrop, used for add/detail modals. */
export default function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-slide-up relative z-10 max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white px-5 pb-safe pt-3 shadow-2xl dark:bg-slate-900">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        {title != null && <h2 className="mb-4 text-lg font-bold">{title}</h2>}
        <div className="pb-6">{children}</div>
      </div>
    </div>
  )
}
