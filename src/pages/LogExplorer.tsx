import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SlidersHorizontal, Download, Upload, Save, Files, ArrowDown, ArrowUp } from 'lucide-react'
import { useLiveQuery } from '../hooks/useLiveQuery'
import { db } from '../db/database'
import { queryLogs, getTagsForLogs } from '../services/logService'
import { hasExcludedFiles } from '../services/fileService'
import { exportCsv, exportJson, exportTxt } from '../services/exportService'
import type { FilterGroup, LogEvent, Tag } from '../types'
import { LogTable } from '../components/logs/LogTable'
import { ImportDialog } from '../components/logs/ImportDialog'
import { LogFilesPanel } from '../components/logs/LogFilesPanel'
import { TimeRangeFilter, EMPTY_TIME_RANGE, type TimeRange } from '../components/logs/TimeRangeFilter'
import { ColumnSelector } from '../components/logs/ColumnSelector'
import { loadVisibleColumns, saveVisibleColumns } from '../components/logs/columns'
import { FilterBuilder, emptyFilterGroup, newCondition } from '../components/filters/FilterBuilder'
import { countConditions, normalizeFilterGroup } from '../services/filterEngine'
import { LogDetailDrawer } from '../components/logs/LogDetailDrawer'
import { BulkActionToolbar } from '../components/logs/BulkActionToolbar'
import { Button } from '../components/ui/Button'

const QUICK_FILTERS: { key: any; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'HIGH', label: 'High' },
  { key: 'MEDIUM', label: 'Medium' },
  { key: 'LOW', label: 'Low' },
  { key: 'marked', label: 'Marked' },
  { key: 'unmarked', label: 'Unmarked' },
  { key: 'suspicious', label: 'Suspicious' },
]

const PAGE_SIZE_OPTIONS = [100, 200, 300, 500]
const DEFAULT_PAGE_SIZE = 100

export function LogExplorer() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [quickFilter, setQuickFilter] = useState<any>('all')
  const [showFilterBuilder, setShowFilterBuilder] = useState(false)
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(emptyFilterGroup())
  const [appliedFilterGroup, setAppliedFilterGroup] = useState<FilterGroup>(emptyFilterGroup())
  const [page, setPage] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [timeRange, setTimeRange] = useState<TimeRange>(EMPTY_TIME_RANGE)
  const [rows, setRows] = useState<LogEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [detailLog, setDetailLog] = useState<LogEvent | null>(null)
  const [showImport, setShowImport] = useState(params.get('import') === '1')
  const [showFilesPanel, setShowFilesPanel] = useState(false)
  const [excludedNotice, setExcludedNotice] = useState(false)
  const [showSaveFilterName, setShowSaveFilterName] = useState(false)
  const [saveFilterName, setSaveFilterName] = useState('')
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => loadVisibleColumns())
  const [tagsByLogId, setTagsByLogId] = useState<Map<number, Tag[]>>(new Map())

  const handleColumnsChange = (keys: string[]) => {
    setVisibleColumns(keys)
    saveVisibleColumns(keys)
  }

  const fileCount = useLiveQuery(() => db.logFiles.count(), [], 0)

  useEffect(() => {
    hasExcludedFiles().then(setExcludedNotice)
  }, [fileCount])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const runQuery = useCallback(async () => {
    setLoading(true)
    const result = await queryLogs({
      search: debouncedSearch || undefined,
      quickFilter,
      filterGroup: appliedFilterGroup,
      timeRange,
      page,
      pageSize,
      sortField: 'timestamp',
      sortDir,
    })
    setRows(result.rows)
    setTotal(result.total)
    setLoading(false)
    // Fetch tags only for the "Tags" column when it's actually visible, to
    // avoid an extra query on every page load for users who don't use it.
    if (visibleColumns.includes('tags')) {
      const ids = result.rows.map((r) => r.id!).filter(Boolean)
      getTagsForLogs(ids).then(setTagsByLogId)
    } else {
      setTagsByLogId(new Map())
    }
  }, [debouncedSearch, quickFilter, appliedFilterGroup, timeRange, page, pageSize, sortDir, visibleColumns])

  useEffect(() => {
    runQuery()
  }, [runQuery, fileCount])

  useEffect(() => {
    setPage(0)
  }, [debouncedSearch, quickFilter, appliedFilterGroup, timeRange, pageSize, sortDir])

  useEffect(() => {
    setPageInput(String(page + 1))
  }, [page])

  useEffect(() => {
    if (debouncedSearch) setParams({ search: debouncedSearch }, { replace: true })
  }, [debouncedSearch])

  // Pick up a filter handed off from the Saved Filters page.
  useEffect(() => {
    if (params.get('applyFilter') === '1') {
      const pending = sessionStorage.getItem('log-analyzer:pending-filter')
      if (pending) {
        const group = normalizeFilterGroup(JSON.parse(pending))
        setFilterGroup(group)
        setAppliedFilterGroup(group)
        sessionStorage.removeItem('log-analyzer:pending-filter')
      }
      setParams({}, { replace: true })
    }
  }, [])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const allSelected = rows.length > 0 && rows.every((r) => prev.has(r.id!))
      if (allSelected) return new Set()
      return new Set(rows.map((r) => r.id!))
    })
  }

  const handleOpenFilterBuilder = () => {
    if (filterGroup.rules.length === 0) {
      setFilterGroup({ ...filterGroup, rules: [newCondition()] })
    }
    setShowFilterBuilder(true)
  }

  const handleApplyFilter = () => {
    setAppliedFilterGroup(filterGroup)
    setShowFilterBuilder(false)
  }

  const handleSaveFilter = async () => {
    setShowSaveFilterName(true)
  }

  const confirmSaveFilter = async () => {
    if (!saveFilterName.trim()) return
    await db.savedFilters.add({ name: saveFilterName.trim(), group: filterGroup, createdAt: Date.now() })
    setShowSaveFilterName(false)
    setSaveFilterName('')
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const goToPage = (input: string) => {
    const n = parseInt(input, 10)
    if (isNaN(n)) {
      setPageInput(String(page + 1))
      return
    }
    const clamped = Math.min(Math.max(n, 1), totalPages)
    setPage(clamped - 1)
    setPageInput(String(clamped))
  }

  const exportScope = useMemo(() => (selected.size > 0 ? rows.filter((r) => selected.has(r.id!)) : rows), [rows, selected])

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Log Explorer</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowFilesPanel(true)}>
            <Files size={14} /> Log Files {fileCount > 0 && `(${fileCount})`}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
            <Upload size={14} /> Import Log
          </Button>
          <ExportMenu scope={exportScope} hasSelection={selected.size > 0} />
        </div>
      </div>

      {excludedNotice && (
        <div className="flex items-center justify-between rounded-md border border-[color:var(--color-medium)]/30 bg-[color:var(--color-medium)]/8 px-3 py-2 text-xs text-[color:var(--color-medium)]">
          <span>Some log files are excluded from analysis and hidden from results below.</span>
          <button onClick={() => setShowFilesPanel(true)} className="underline shrink-0 ml-3">Manage files</button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-text-faint)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="w-full rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={handleOpenFilterBuilder}>
          <SlidersHorizontal size={14} /> Filter
        </Button>
        {countConditions(appliedFilterGroup) > 0 && (
          <span className="text-xs text-[color:var(--color-accent-strong)]">{countConditions(appliedFilterGroup)} active</span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          title="Toggle timestamp sort order"
        >
          {sortDir === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
          {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
        </Button>
        <TimeRangeFilter value={timeRange} onChange={setTimeRange} />
        <div className="ml-auto">
          <ColumnSelector visible={visibleColumns} onChange={handleColumnsChange} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map((qf) => (
          <button
            key={qf.key}
            onClick={() => setQuickFilter(qf.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              quickFilter === qf.key
                ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/12 text-[color:var(--color-accent-strong)]'
                : 'border-[color:var(--color-border-strong)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-surface-hover)]'
            }`}
          >
            {qf.label}
          </button>
        ))}
      </div>

      {showFilterBuilder && (
        <FilterBuilder
          group={filterGroup}
          onChange={setFilterGroup}
          onClose={() => setShowFilterBuilder(false)}
          onApply={handleApplyFilter}
          onSave={handleSaveFilter}
        />
      )}

      {showSaveFilterName && (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-raised)] p-3">
          <input
            value={saveFilterName}
            onChange={(e) => setSaveFilterName(e.target.value)}
            placeholder="Filter name"
            className="flex-1 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-2.5 py-1.5 text-xs"
          />
          <Button variant="primary" size="sm" onClick={confirmSaveFilter}><Save size={14} /> Save</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSaveFilterName(false)}>Cancel</Button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {rows.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-text-faint)]">
            {total === 0 && fileCount === 0 ? 'No logs imported yet. Import a file to get started.' : 'No events match your search or filter.'}
          </div>
        ) : (
          <LogTable
            rows={rows}
            selected={selected}
            visibleColumns={visibleColumns}
            tagsByLogId={tagsByLogId}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onRowClick={setDetailLog}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-[color:var(--color-text-muted)] flex-wrap gap-2">
        <span>{total.toLocaleString()} events</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-2 py-1 text-xs font-mono-tabular"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <div className="flex items-center gap-1">
              <span>Page</span>
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={(e) => goToPage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    goToPage((e.target as HTMLInputElement).value)
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                className="w-12 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-1.5 py-1 text-center text-xs font-mono-tabular"
              />
              <span>/ {totalPages}</span>
            </div>
            <Button variant="ghost" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </div>

      {showImport && (
        <ImportDialog
          onClose={() => { setShowImport(false); setParams({}, { replace: true }) }}
          onImported={() => runQuery()}
        />
      )}

      {showFilesPanel && (
        <LogFilesPanel
          onClose={() => setShowFilesPanel(false)}
          onChanged={() => { runQuery(); hasExcludedFiles().then(setExcludedNotice) }}
        />
      )}

      {detailLog && <LogDetailDrawer log={detailLog} onClose={() => setDetailLog(null)} onChanged={() => runQuery()} />}

      {selected.size > 0 && (
        <BulkActionToolbar selectedIds={[...selected]} onClear={() => { setSelected(new Set()); runQuery() }} />
      )}
    </div>
  )
}

function ExportMenu({ scope, hasSelection }: { scope: LogEvent[]; hasSelection: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        <Download size={14} /> Export {hasSelection ? `(${scope.length} selected)` : ''}
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] shadow-xl z-20 overflow-hidden">
          {[
            { label: 'Export CSV', fn: () => exportCsv(scope) },
            { label: 'Export JSON', fn: () => exportJson(scope) },
            { label: 'Export TXT', fn: () => exportTxt(scope) },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => { opt.fn(); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[color:var(--color-surface-hover)]"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
