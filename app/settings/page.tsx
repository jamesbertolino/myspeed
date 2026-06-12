'use client'

import { useEffect, useState } from 'react'
import { Settings, Plus, Trash2, RotateCcw, Save, Check } from 'lucide-react'
import { AppSettings, PingTarget, loadSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import clsx from 'clsx'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newHost, setNewHost] = useState('')
  const [hostError, setHostError] = useState('')

  useEffect(() => { setSettings(loadSettings()) }, [])

  function save() {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function reset() {
    setSettings(DEFAULT_SETTINGS)
  }

  function addTarget() {
    const host = newHost.trim()
    const label = newLabel.trim() || host
    if (!host) { setHostError('Informe um IP ou hostname'); return }
    setHostError('')
    setSettings(s => ({ ...s, pingTargets: [...s.pingTargets, { label, host }] }))
    setNewLabel('')
    setNewHost('')
  }

  function removeTarget(i: number) {
    setSettings(s => ({ ...s, pingTargets: s.pingTargets.filter((_, j) => j !== i) }))
  }

  function updateTarget(i: number, field: keyof PingTarget, value: string) {
    setSettings(s => ({
      ...s,
      pingTargets: s.pingTargets.map((t, j) => j === i ? { ...t, [field]: value } : t),
    }))
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Settings className="w-6 h-6 text-[#00d4ff]" />
            <h1 className="text-2xl font-bold text-white">Configurações</h1>
          </div>
          <p className="text-sm text-gray-500">Preferências salvas localmente no navegador</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-all border border-[#1a2744]">
            <RotateCcw className="w-3.5 h-3.5" /> Redefinir
          </button>
          <button onClick={save} className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all', saved ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'btn-cyan')}>
            {saved ? <><Check className="w-3.5 h-3.5" /> Salvo!</> : <><Save className="w-3.5 h-3.5" /> Salvar</>}
          </button>
        </div>
      </div>

      {/* Ping / Latência */}
      <section className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Monitor de Latência</h2>
        <p className="text-xs text-gray-500 mb-4">Alvos disponíveis no seletor do Dashboard</p>

        <div className="space-y-2 mb-4">
          {settings.pingTargets.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input-field flex-1 min-w-0"
                placeholder="Nome"
                value={t.label}
                onChange={e => updateTarget(i, 'label', e.target.value)}
              />
              <input
                className="input-field flex-1 min-w-0 mono text-sm"
                placeholder="IP ou hostname (ou 'self')"
                value={t.host}
                onChange={e => updateTarget(i, 'host', e.target.value)}
              />
              <button
                onClick={() => removeTarget(i)}
                className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 pt-3 border-t border-[#1a2744]">
          <input
            className="input-field flex-1"
            placeholder="Nome (ex: Gateway)"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTarget()}
          />
          <div className="flex-1">
            <input
              className={clsx('input-field w-full mono text-sm', hostError && 'border-red-500/50')}
              placeholder="IP ou hostname"
              value={newHost}
              onChange={e => { setNewHost(e.target.value); setHostError('') }}
              onKeyDown={e => e.key === 'Enter' && addTarget()}
            />
            {hostError && <p className="text-xs text-red-400 mt-1">{hostError}</p>}
          </div>
          <button onClick={addTarget} className="btn-cyan p-2 rounded-lg shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4">
          <label className="text-xs text-gray-500 block mb-2">Intervalo de ping</label>
          <div className="flex gap-2">
            {[500, 1000, 2000].map(ms => (
              <button
                key={ms}
                onClick={() => setSettings(s => ({ ...s, pingInterval: ms }))}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                  settings.pingInterval === ms
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-[#00d4ff]'
                    : 'border-[#1a2744] text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                {ms === 500 ? '500ms' : ms === 1000 ? '1s' : '2s'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Gráfico */}
      <section className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Gráfico de Latência</h2>
        <p className="text-xs text-gray-500 mb-4">Janela de tempo exibida no Dashboard</p>
        <div className="flex gap-2">
          {[30, 60, 120].map(sec => (
            <button
              key={sec}
              onClick={() => setSettings(s => ({ ...s, latencyChartSeconds: sec }))}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                settings.latencyChartSeconds === sec
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-[#00d4ff]'
                  : 'border-[#1a2744] text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              {sec}s
            </button>
          ))}
        </div>
      </section>

      {/* Servidor padrão */}
      <section className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-1">Servidor Padrão de Velocidade</h2>
        <p className="text-xs text-gray-500 mb-4">Usado ao abrir a página de Teste de Velocidade</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { id: 'auto', label: 'Auto (menor ping)' },
            { id: 'cloudflare', label: 'Cloudflare' },
            { id: 'vultr-saopaulo', label: 'Vultr São Paulo' },
            { id: 'ovh-rbx', label: 'OVH Roubaix' },
            { id: 'hetzner-fsn', label: 'Hetzner Nuremberg' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setSettings(s => ({ ...s, defaultServerId: id }))}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                settings.defaultServerId === id
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-[#00d4ff]'
                  : 'border-[#1a2744] text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <p className="text-xs text-gray-600 text-center mt-6">
        As configurações são salvas no localStorage deste navegador.
      </p>
    </div>
  )
}
