import { db } from '../db/database'
import type { FilterGroup, LogEvent, MarkType, Severity, Tag } from '../types'
import { evalGroup } from './filterEngine'
import { getActiveFileIdSet, hasExcludedFiles } from './fileService'

export interface QueryOptions {
  search?: string
  quickFilter?: 'all' | Severity | 'marked' | 'unmarked' | 'suspicious'
  filterGroup?: FilterGroup | null
  /** Inclusive epoch-ms bounds on the `timestamp` field. Either side may be null for an open end. */
  timeRange?: { start: number | null; end: number | null } | null
  page: number
  pageSize: number
  sortField?: keyof LogEvent
  sortDir?: 'asc' | 'desc'
}

export interface QueryResult {
  rows: LogEvent[]
  total: number
}

function matchesSearch(log: LogEvent, term: string): boolean {
  const t = term.toLowerCase()
  return (
    (log.srcIp?.toLowerCase().includes(t) ?? false) ||
    (log.dstIp?.toLowerCase().includes(t) ?? false) ||
    (log.username?.toLowerCase().includes(t) ?? false) ||
    (log.hostname?.toLowerCase().includes(t) ?? false) ||
    (log.eventType?.toLowerCase().includes(t) ?? false) ||
    (log.message?.toLowerCase().includes(t) ?? false) ||
    (log.url?.toLowerCase().includes(t) ?? false) ||
    (log.userAgent?.toLowerCase().includes(t) ?? false) ||
    (log.referer?.toLowerCase().includes(t) ?? false) ||
    (log.requestBody?.toLowerCase().includes(t) ?? false) ||
    log.rawLog.toLowerCase().includes(t)
  )
}

function matchesQuickFilter(log: LogEvent, qf: QueryOptions['quickFilter']): boolean {
  if (!qf || qf === 'all') return true
  if (qf === 'marked') return log.mark !== null
  if (qf === 'unmarked') return log.mark === null
  if (qf === 'suspicious') return log.mark === 'SUSPICIOUS' || log.severity === 'HIGH' || log.severity === 'CRITICAL'
  return log.severity === qf
}

// IndexedDB range bounds — effectively -Infinity/+Infinity for a numeric key,
// used when only one side of a time range is set (open-ended).
const MIN_TIMESTAMP = -8640000000000000
const MAX_TIMESTAMP = 8640000000000000

/**
 * Queries logs with search/filter/sort/pagination.
 * Uses a cursor-based scan via Dexie so we never materialize the entire table,
 * keeping this safe for 1M+ row datasets. A time range, when provided, is
 * applied as an indexed range query on `timestamp` rather than a full scan.
 */
export async function queryLogs(opts: QueryOptions): Promise<QueryResult> {
  const { search, quickFilter, filterGroup, timeRange, page, pageSize, sortField = 'timestamp', sortDir = 'desc' } = opts

  const excludeInactive = await hasExcludedFiles()
  const activeFileIds = excludeInactive ? await getActiveFileIdSet() : null

  const hasTimeRange = Boolean(timeRange && (timeRange.start !== null || timeRange.end !== null))

  // When a time range is set, start from an indexed range query on `timestamp`
  // (fast, doesn't scan rows outside the range) instead of the full ordered index.
  let collection
  if (hasTimeRange) {
    const lo = timeRange!.start ?? MIN_TIMESTAMP
    const hi = timeRange!.end ?? MAX_TIMESTAMP
    collection = db.logs.where('timestamp').between(lo, hi, true, true)
    if (sortDir === 'desc') collection = collection.reverse()
  } else {
    collection = sortDir === 'desc' ? db.logs.orderBy(sortField as string).reverse() : db.logs.orderBy(sortField as string)
  }

  const needsPredicateScan =
    Boolean(search) ||
    Boolean(filterGroup && filterGroup.rules.length > 0) ||
    Boolean(quickFilter && quickFilter !== 'all') ||
    excludeInactive

  if (!needsPredicateScan) {
    const total = hasTimeRange ? await collection.count() : await db.logs.count()
    const rows = await collection.offset(page * pageSize).limit(pageSize).toArray()
    return { rows, total }
  }

  // Full predicate scan — Dexie's cursor yields to the event loop between chunks
  // so the UI doesn't freeze even for large tables.
  const matched: LogEvent[] = []
  let total = 0
  await collection.each((log) => {
    let ok = true
    if (activeFileIds) ok = ok && activeFileIds.has(log.fileId)
    if (ok && search) ok = ok && matchesSearch(log, search)
    if (ok && quickFilter) ok = ok && matchesQuickFilter(log, quickFilter)
    if (ok && filterGroup && filterGroup.rules.length > 0) ok = ok && evalGroup(log, filterGroup)
    if (ok) {
      total++
      if (total > page * pageSize && matched.length < pageSize) {
        matched.push(log)
      }
    }
  })

  return { rows: matched, total }
}

export async function getLogById(id: number) {
  return db.logs.get(id)
}

export async function setMark(logId: number, mark: MarkType) {
  await db.logs.update(logId, { mark })
}

export async function bulkSetMark(logIds: number[], mark: MarkType) {
  await db.transaction('rw', db.logs, async () => {
    for (const id of logIds) {
      await db.logs.update(id, { mark })
    }
  })
}

export async function addTagToLog(logId: number, tagId: number) {
  const existing = await db.logTags.where('[logId+tagId]').equals([logId, tagId]).first()
  if (!existing) {
    await db.logTags.add({ logId, tagId })
  }
}

export async function removeTagFromLog(logId: number, tagId: number) {
  await db.logTags.where('[logId+tagId]').equals([logId, tagId]).delete()
}

export async function getTagsForLog(logId: number) {
  const links = await db.logTags.where('logId').equals(logId).toArray()
  const tagIds = links.map((l) => l.tagId)
  if (tagIds.length === 0) return []
  return db.tags.where('id').anyOf(tagIds).toArray()
}

/** Batch-fetches tags for many logs at once (e.g. a table page), keyed by logId. */
export async function getTagsForLogs(logIds: number[]): Promise<Map<number, Tag[]>> {
  const result = new Map<number, Tag[]>()
  if (logIds.length === 0) return result
  const links = await db.logTags.where('logId').anyOf(logIds).toArray()
  if (links.length === 0) return result
  const tagIds = [...new Set(links.map((l) => l.tagId))]
  const tags = await db.tags.where('id').anyOf(tagIds).toArray()
  const tagById = new Map(tags.map((t) => [t.id!, t]))
  for (const link of links) {
    const tag = tagById.get(link.tagId)
    if (!tag) continue
    const arr = result.get(link.logId) ?? []
    arr.push(tag)
    result.set(link.logId, arr)
  }
  return result
}

export interface DashboardStats {
  totalEvents: number
  critical: number
  high: number
  medium: number
  low: number
  marked: number
  topSourceIps: { key: string; count: number }[]
  timeline: { bucket: number; count: number }[]
}

/** Streams the whole logs table once via cursor to build aggregate stats. */
export async function computeDashboardStats(bucketMs = 60 * 60 * 1000): Promise<DashboardStats> {
  const excludeInactive = await hasExcludedFiles()
  const activeFileIds = excludeInactive ? await getActiveFileIdSet() : null

  let totalEvents = 0
  let critical = 0
  let high = 0
  let medium = 0
  let low = 0
  let marked = 0
  const ipCounts = new Map<string, number>()
  const buckets = new Map<number, number>()

  await db.logs.each((log) => {
    if (activeFileIds && !activeFileIds.has(log.fileId)) return
    totalEvents++
    if (log.severity === 'CRITICAL') critical++
    else if (log.severity === 'HIGH') high++
    else if (log.severity === 'MEDIUM') medium++
    else if (log.severity === 'LOW') low++
    if (log.mark) marked++
    if (log.srcIp) ipCounts.set(log.srcIp, (ipCounts.get(log.srcIp) ?? 0) + 1)
    if (log.timestamp) {
      const bucket = Math.floor(log.timestamp / bucketMs) * bucketMs
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    }
  })

  const topSourceIps = [...ipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }))

  const timeline = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({ bucket, count }))

  return { totalEvents, critical, high, medium, low, marked, topSourceIps, timeline }
}

export interface IpAnalysis {
  ip: string
  totalEvents: number
  firstSeen: number | null
  lastSeen: number | null
  failedLogin: number
  successfulLogin: number
  uniqueDestinations: number
  uniquePorts: number
}

export async function analyzeIp(ip: string): Promise<IpAnalysis> {
  const excludeInactive = await hasExcludedFiles()
  const activeFileIds = excludeInactive ? await getActiveFileIdSet() : null

  const allEvents = await db.logs.where('srcIp').equals(ip).toArray()
  const events = activeFileIds ? allEvents.filter((e) => activeFileIds.has(e.fileId)) : allEvents
  let firstSeen: number | null = null
  let lastSeen: number | null = null
  let failedLogin = 0
  let successfulLogin = 0
  const destinations = new Set<string>()
  const ports = new Set<number>()

  for (const e of events) {
    if (e.timestamp) {
      if (firstSeen === null || e.timestamp < firstSeen) firstSeen = e.timestamp
      if (lastSeen === null || e.timestamp > lastSeen) lastSeen = e.timestamp
    }
    if (e.eventType?.includes('LOGIN_FAILED') || e.status === 'FAILED') failedLogin++
    if (e.eventType?.includes('LOGIN_SUCCESS') || e.status === 'SUCCESS') successfulLogin++
    if (e.dstIp) destinations.add(e.dstIp)
    if (e.dstPort) ports.add(e.dstPort)
  }

  return {
    ip,
    totalEvents: events.length,
    firstSeen,
    lastSeen,
    failedLogin,
    successfulLogin,
    uniqueDestinations: destinations.size,
    uniquePorts: ports.size,
  }
}
