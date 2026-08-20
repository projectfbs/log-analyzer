import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from '../hooks/useLiveQuery'
import { db } from '../db/database'
import { computeDashboardStats, type DashboardStats } from '../services/logService'
import { Button } from '../components/ui/Button'
import { formatNumber, formatTimestamp } from '../utils/format'
import { useTimezone } from '../hooks/useTimezone'
import { generateDemoData } from '../services/demoData'
import { Upload, Sparkles, ShieldCheck, ChartColumn } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const SEVERITY_COLORS: Record<string, string> = {
  Critical: 'var(--color-critical)',
  High: 'var(--color-high)',
  Medium: 'var(--color-medium)',
  Low: 'var(--color-low)',
}

export function Dashboard() {
  const navigate = useNavigate()
  const fileCount = useLiveQuery(() => db.logFiles.count(), [], 0)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const { offsetMinutes } = useTimezone()

  const refresh = async () => {
    setLoading(true)
    const s = await computeDashboardStats()
    setStats(s)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [fileCount])

  const handleDemoData = async () => {
    setGenerating(true)
    await generateDemoData(1000)
    await refresh()
    setGenerating(false)
  }

  if (!loading && stats && stats.totalEvents === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-8 text-center">
          <ShieldCheck className="mx-auto mb-4 text-[color:var(--color-accent)]" size={36} />
          <h1 className="text-lg font-bold mb-1">Local Log Analyzer</h1>
          <p className="text-sm text-[color:var(--color-text-muted)] mb-6">Analyze your logs locally.</p>
          <ul className="text-sm text-left space-y-1.5 mb-6 text-[color:var(--color-text-muted)]">
            {['No login', 'No cloud', 'No server', 'Browser-based', 'GitHub Pages compatible'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="text-[color:var(--color-benign)]">✓</span> {t}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={() => navigate('/logs?import=1')}>
              <Upload size={16} /> Import Log
            </Button>
            <Button variant="secondary" onClick={handleDemoData} disabled={generating}>
              <Sparkles size={16} /> {generating ? 'Generating…' : 'Load Demo Data'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const severityData = stats
    ? [
        { name: 'Critical', value: stats.critical },
        { name: 'High', value: stats.high },
        { name: 'Medium', value: stats.medium },
        { name: 'Low', value: stats.low },
      ]
    : []

  const timelineData = stats?.timeline.map((t) => ({ time: formatTimestamp(t.bucket, offsetMinutes).slice(5, 16), count: t.count })) ?? []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <ChartColumn size={18} className="text-[color:var(--color-accent)]" /> Dashboard
        </h1>
        <Button variant="primary" size="sm" onClick={() => navigate('/logs?import=1')}>
          <Upload size={14} /> Import Log
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Events" value={stats ? formatNumber(stats.totalEvents) : '—'} />
        <StatCard label="Critical" value={stats ? formatNumber(stats.critical) : '—'} color="var(--color-critical)" />
        <StatCard label="High" value={stats ? formatNumber(stats.high) : '—'} color="var(--color-high)" />
        <StatCard label="Marked" value={stats ? formatNumber(stats.marked) : '—'} color="var(--color-accent)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-4">
          <h2 className="text-sm font-semibold mb-3 text-[color:var(--color-text-muted)]">Event Timeline</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={timelineData}>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--color-text-faint)' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-faint)' }} width={40} />
              <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', fontSize: 12 }} />
              <Bar dataKey="count" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-4">
          <h2 className="text-sm font-semibold mb-3 text-[color:var(--color-text-muted)]">Severity Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={severityData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {severityData.map((d) => (
                  <Cell key={d.name} fill={SEVERITY_COLORS[d.name]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-4">
        <h2 className="text-sm font-semibold mb-3 text-[color:var(--color-text-muted)]">Top Source IP</h2>
        <div className="space-y-1.5">
          {stats?.topSourceIps.map((ip) => (
            <button
              key={ip.key}
              onClick={() => navigate(`/logs?search=${ip.key}`)}
              className="w-full flex items-center gap-3 text-left group"
            >
              <span className="w-32 font-mono-tabular text-xs text-[color:var(--color-text)] group-hover:text-[color:var(--color-accent)]">{ip.key}</span>
              <div className="flex-1 h-2 rounded-full bg-[color:var(--color-surface)] overflow-hidden">
                <div
                  className="h-full bg-[color:var(--color-accent)]/70"
                  style={{ width: `${(ip.count / (stats.topSourceIps[0]?.count || 1)) * 100}%` }}
                />
              </div>
              <span className="w-14 text-right text-xs font-mono-tabular text-[color:var(--color-text-muted)]">{formatNumber(ip.count)}</span>
            </button>
          ))}
          {stats?.topSourceIps.length === 0 && <p className="text-xs text-[color:var(--color-text-faint)]">No source IP data yet.</p>}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-4">
      <p className="text-xs text-[color:var(--color-text-muted)] mb-1">{label}</p>
      <p className="text-2xl font-bold font-mono-tabular" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  )
}
