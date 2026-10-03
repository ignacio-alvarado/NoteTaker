import { useEffect } from 'react'
import { EntryView } from './components/EntryView'
import { Home } from './components/Home'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { useApp } from './lib/context'
import { AppProvider } from './lib/store'

function Layout(): React.JSX.Element {
  const { settings, selectedId } = useApp()

  if (!settings) return <div className="h-full" />

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-11 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedId ? <EntryView key={selectedId} entryId={selectedId} /> : <Home />}
        </div>
      </main>
      <SettingsDialog />
      <Toasts />
    </div>
  )
}

export default function App(): React.JSX.Element {
  // Evita que soltar un archivo fuera de la zona de carga haga navegar la ventana.
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <AppProvider>
      <Layout />
    </AppProvider>
  )
}
