'use client'

import { useEffect, useRef, useCallback } from 'react'
import { loadSettings } from '@/lib/settings'
import { runAutoSpeedtest } from '@/lib/speedtest-runner'
import { checkAlerts } from '@/lib/alerts'

const LAST_RUN_KEY = 'myspeed_auto_speedtest_last'

function getLastRun(): number {
  try { return Number(localStorage.getItem(LAST_RUN_KEY) ?? 0) } catch { return 0 }
}
function setLastRun(ts: number) {
  try { localStorage.setItem(LAST_RUN_KEY, String(ts)) } catch {}
}

export default function AutoSpeedtest() {
  const abortRef  = useRef<AbortController | null>(null)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async () => {
    const s = loadSettings()
    if (!s.autoSpeedtest) return

    abortRef.current = new AbortController()
    try {
      const result = await runAutoSpeedtest(abortRef.current.signal)
      setLastRun(Date.now())

      // salva no histórico
      await fetch('/api/history/speedtest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...result, auto: true }),
      })

      // verifica alertas
      checkAlerts(s.alerts, { pingMs: result.ping, downloadMbps: result.download, uploadMbps: result.upload })

      // notificação de conclusão
      if (typeof window !== 'undefined' && Notification.permission === 'granted') {
        new Notification('MySpeed — Teste automático concluído', {
          body: `↓ ${result.download.toFixed(1)} Mbps  ↑ ${result.upload.toFixed(1)} Mbps  Ping ${result.ping}ms`,
          icon: '/favicon.ico',
          tag:  'auto-speedtest',
        })
      }
    } catch {
      // abortado ou erro de rede — ignora silenciosamente
    }
  }, [])

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const s        = loadSettings()
    const interval = s.autoSpeedtest * 3_600_000 // horas → ms
    if (!interval) return

    const last    = getLastRun()
    const elapsed = Date.now() - last
    const delay   = elapsed >= interval ? 0 : interval - elapsed

    timerRef.current = setTimeout(async () => {
      await run()
      schedule() // reagenda para o próximo ciclo
    }, delay)
  }, [run])

  useEffect(() => {
    schedule()

    const onSettingsChanged = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      schedule()
    }
    window.addEventListener('myspeed-settings-changed', onSettingsChanged)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
      window.removeEventListener('myspeed-settings-changed', onSettingsChanged)
    }
  }, [schedule])

  return null
}
