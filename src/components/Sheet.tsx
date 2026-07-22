import { useRef, useState, type ReactNode } from 'react'

/**
 * Bottom sheet with backdrop. Dismiss by tapping the backdrop or dragging
 * the grab-handle area down past the threshold; releasing early springs back.
 */
export default function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const [dragY, setDragY] = useState(0)
  const dragging = useRef(false)
  const startY = useRef(0)
  const lastY = useRef(0)
  const lastT = useRef(0)
  const velocity = useRef(0)

  function onStart(e: React.TouchEvent) {
    dragging.current = true
    startY.current = e.touches[0].clientY
    lastY.current = e.touches[0].clientY
    lastT.current = e.timeStamp
    velocity.current = 0
  }

  function onMove(e: React.TouchEvent) {
    if (!dragging.current) return
    const y = e.touches[0].clientY
    const dt = e.timeStamp - lastT.current
    if (dt > 0) velocity.current = (y - lastY.current) / dt
    lastY.current = y
    lastT.current = e.timeStamp
    setDragY(Math.max(0, y - startY.current))
  }

  function onEnd() {
    if (!dragging.current) return
    dragging.current = false
    // Close on a decent pull or a quick flick down
    if (dragY > 110 || (dragY > 30 && velocity.current > 0.6)) onClose()
    else setDragY(0)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="animate-slide-up relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging.current ? 'none' : 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
      >
        {/* Drag zone: generous touch target around the handle + title */}
        <div
          onTouchStart={onStart}
          onTouchMove={onMove}
          onTouchEnd={onEnd}
          onTouchCancel={onEnd}
          className="shrink-0 cursor-grab touch-none px-5 pb-1 pt-3"
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
          {title != null && <h2 className="mb-2 text-lg font-bold">{title}</h2>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-safe">
          <div className="pb-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
