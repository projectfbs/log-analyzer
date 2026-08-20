import { useEffect, useState } from 'react'
import { db } from '../db/database'
import { analyzeIp, type IpAnalysis } from '../services/logService'
import { getActiveFileIdSet, hasExcludedFiles } from '../services/fileService'
import { formatNumber, formatTimestamp } from '../utils/format'
import { useTimezone } from '../hooks/useTimezone'
import { ChartColumn, X } from 'lucide-react'

interface TopStat { key: string; count: number }

export function Analysis() {
  const [loading, setLoading] = useState(true)
  const [topIps, setTopIps] = useState<TopStat[]>([])
  const [topDstIps, setTopDstIps] = useState<TopStat[]>([])
  const [topUsers, setTopUsers] = useState<TopStat[]>([])
  const [topEvents, setTopEvents] = useState<TopStat[]>([])
  const [failedAuth, setFailedAuth] = useState(0)
  const [suspicious, setSuspicious] = useState(0)
  const [selectedIp, setSelectedIp] = useState<string | null>(null)
  const [ipAnalysis, setIpAnalysis] = useState<IpAnalysis | null>(null)
  const { offsetMinutes } = useTimezone()

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const excludeInactive = await hasExcludedFiles()
      const activeFileIds = excludeInactive ? await getActiveFileIdSet() : null

      const srcIpCounts = new Map<string, number>()
      const dstIpCounts = new Map<string, number>()
      const userCounts = new Map<string, number>()
      const eventCounts = new Map<string, number>()
      let failed = 0
      let sus = 0

      await db.logs.each((log) => {
        if (activeFileIds && !activeFileIds.has(log.fileId)) return
        if (log.srcIp) srcIpCounts.set(log.srcIp, (srcIpCounts.get(log.srcIp) ?? 0) + 1)
        if (log.dstIp) dstIpCounts.set(log.dstIp, (dstIpCounts.get(log.dstIp) ?? 0) + 1)
        if (log.username) userCounts.set(log.username, (userCounts.get(log.username) ?? 0) + 1)
        if (log.eventType) eventCounts.set(log.eventType, (eventCounts.get(log.eventType) ?? 0) + 1)
        if (log.eventType?.includes('LOGIN_FAILED') || log.status === 'FAILED') failed++
        if (log.severity === 'HIGH' || log.severity === 'CRITICAL') sus++
      })

      const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count }))

      setTopIps(top(srcIpCounts))
      setTopDstIps(top(dstIpCounts))
      setTopUsers(top(userCounts))
      setTopEvents(top(eventCounts))
      setFailedAuth(failed)
      setSuspicious(sus)
      setLoading(false)
    }
    run()
  }, [])

  useEffect(() => {
    if (!selectedIp) return
    analyzeIp(selectedIp).then(setIpAnalysis)
  }, [selectedIp])

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-bold flex items-center gap-2">
        <ChartColumn size={18} className="text-[color:var(--color-accent)]" /> Analysis
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Failed Authentication" value={failedAuth} />
        <MiniStat label="Suspicious Events" value={suspicious} color="var(--color-high)" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RankedPanel title="Top Source IP" data={topIps} loading={loading} onSelect={setSelectedIp} clickable />
        <RankedPanel title="Top Destination IP" data={topDstIps} loading={loading} />
        <RankedPanel title="Top Username" data={topUsers} loading={loading} />
        <RankedPanel title="Top Event Type" data={topEvents} loading={loading} />
      </div>

      {selectedIp && ipAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--color-border)]">
              <h2 className="text-sm font-semibold font-mono-tabular">IP Analysis — {selectedIp}</h2>
              <button onClick={() => setSelectedIp(null)} className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4 text-sm">
              <Detail label="Total Events" value={formatNumber(ipAnalysis.totalEvents)} />
              <Detail label="First Seen" value={formatTimestamp(ipAnalysis.firstSeen, offsetMinutes)} />
              <Detail label="Last Seen" value={formatTimestamp(ipAnalysis.lastSeen, offsetMinutes)} />
              <Detail label="Failed Login" value={formatNumber(ipAnalysis.failedLogin)} />
              <Detail label="Successful Login" value={formatNumber(ipAnalysis.successfulLogin)} />
              <Detail label="Unique Destination" value={formatNumber(ipAnalysis.uniqueDestinations)} />
              <Detail label="Unique Ports" value={formatNumber(ipAnalysis.uniquePorts)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-4">
      <p className="text-xs text-[color:var(--color-text-muted)] mb-1">{label}</p>
      <p className="text-xl font-bold font-mono-tabular" style={color ? { color } : undefined}>{formatNumber(value)}</p>
    </div>
  )
}

function RankedPanel({ title, data, loading, onSelect, clickable }: { title: string; data: TopStat[]; loading: boolean; onSelect?: (v: string) => void; clickable?: boolean }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-4">
      <h2 className="text-sm font-semibold mb-3 text-[color:var(--color-text-muted)]">{title}</h2>
      {loading ? (
        <p className="text-xs text-[color:var(--color-text-faint)]">Computing…</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-faint)]">No data yet.</p>
      ) : (
        <div className="space-y-1.5">
          {data.map((d) => (
            <div
              key={d.key}
              onClick={() => clickable && onSelect?.(d.key)}
              className={`flex items-center gap-3 ${clickable ? 'cursor-pointer group' : ''}`}
            >
              <span className={`w-32 truncate text-xs font-mono-tabular ${clickable ? 'group-hover:text-[color:var(--color-accent)]' : ''}`}>{d.key}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[color:var(--color-surface)] overflow-hidden">
                <div className="h-full bg-[color:var(--color-accent)]/70" style={{ width: `${(d.count / data[0].count) * 100}%` }} />
              </div>
              <span className="w-12 text-right text-xs font-mono-tabular text-[color:var(--color-text-muted)]">{formatNumber(d.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-faint)]">{label}</p>
      <p className="font-mono-tabular text-[color:var(--color-text)]">{value}</p>
    </div>
  )
}
