import { useApp } from '../lib/context'
import { AlertIcon, CheckIcon, CloseIcon } from './icons'

export function Toasts(): React.JSX.Element {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
            toast.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
              : 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'
          }`}
        >
          {toast.kind === 'error' ? (
            <AlertIcon className="mt-0.5 shrink-0" />
          ) : (
            <CheckIcon className="mt-0.5 shrink-0 text-emerald-600" />
          )}
          <p className="selectable min-w-0 flex-1 break-words">{toast.message}</p>
          <button
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={() => dismissToast(toast.id)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
