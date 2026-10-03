import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatClock } from '@shared/format'
import { api } from '../lib/api'
import { useApp } from '../lib/context'
import { MicIcon, StopIcon } from './icons'

type State = 'idle' | 'recording' | 'saving'

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

export function Recorder(): React.JSX.Element {
  const { t } = useTranslation()
  const { startRecording, notify } = useApp()
  const [state, setState] = useState<State>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const discardRef = useRef(false)
  const cleanupRef = useRef<() => void>(() => {})

  useEffect(() => () => cleanupRef.current(), [])

  async function start(): Promise<void> {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      notify('error', t('recorder.unsupported'))
      return
    }
    try {
      const allowed = await api.requestMicAccess()
      if (!allowed) throw new Error('denied')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      })
      streamRef.current = stream

      // Medidor de nivel con un AnalyserNode.
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      let raf = 0
      const tick = (): void => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 64))
        raf = requestAnimationFrame(tick)
      }
      tick()

      const startedAt = Date.now()
      const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250)

      cleanupRef.current = () => {
        cancelAnimationFrame(raf)
        clearInterval(timer)
        void ctx.close()
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      discardRef.current = false
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        cleanupRef.current()
        if (discardRef.current) {
          setState('idle')
          return
        }
        setState('saving')
        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        await startRecording(await blob.arrayBuffer(), type)
        setState('idle')
      }
      recorder.start(1000)
      recorderRef.current = recorder
      setElapsed(0)
      setState('recording')
    } catch {
      cleanupRef.current()
      notify('error', t('recorder.micDenied'))
    }
  }

  function stop(discard: boolean): void {
    discardRef.current = discard
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  return (
    <section className="card flex items-center gap-4 p-4">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          state === 'recording'
            ? 'bg-red-500 text-white'
            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
        }`}
      >
        <MicIcon size={20} />
      </div>

      {state === 'recording' ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {t('recorder.recording')}
              <span className="tabular-nums text-zinc-500">{formatClock(elapsed)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-red-500 transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          <button className="btn-ghost" onClick={() => stop(true)}>
            {t('recorder.discard')}
          </button>
          <button className="btn-primary" onClick={() => stop(false)}>
            <StopIcon size={14} />
            {t('recorder.stop')}
          </button>
        </>
      ) : (
        <>
          <div className="flex-1 text-sm font-medium">{t('recorder.title')}</div>
          <button
            className="btn-secondary"
            disabled={state === 'saving'}
            onClick={() => void start()}
          >
            {t('recorder.start')}
          </button>
        </>
      )}
    </section>
  )
}
