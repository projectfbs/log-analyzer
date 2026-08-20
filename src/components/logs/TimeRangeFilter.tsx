import { useState, useRef, useEffect } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { msToDatetimeLocal, datetimeLocalToMs } from '../../utils/format'
import { useTimezone } from '../../hooks/useTimezone'

export interface TimeRange {
  start: number | null
  end: number | null
}

export const EMPTY_TIME_RANGE: TimeRange = { start: null, end: null }

export function TimeRangeFilter({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  const { offsetMinutes, label } = useTimezone()
  const [open, setOpen] = useState(false)
  const [startInput, setStartInput] = useState(value.start !== null ? msToDatetimeLocal(value.start, offsetMinutes) : '')
  const [endInput, setEndInput] = useState(value.end !== null ? msToDatetimeLocal(value.end, offsetMinutes) : '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setStartInput(value.start !== null ? msToDatetimeLocal(value.start, offsetMinutes) : '')
    setEndInput(value.end !== null ? msToDatetimeLocal(value.end, offsetMinutes) : '')
    // Re-render the picker fields in the newly selected timezone whenever it changes,
    // so the displayed wall-clock values keep matching the Timestamp column.
  }, [value.start, value.end, offsetMinutes])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const apply = () => {
    onChange({
      start: startInput ? datetimeLocalToMs(startInput, offsetMinutes) : null,
      end: endInput ? datetimeLocalToMs(endInput, offsetMinutes) : null,
    })
    setOpen(false)
  }

  const clear = () => {
    setStartInput('')
    setEndInput('')
    onChange(EMPTY_TIME_RANGE)
    setOpen(false)
  }

  const active = value.start !== null || value.end !== null

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        <CalendarClock size={14} /> {active ? 'Time Range: Active' : 'Time Range'}
      </Button>

      {open && (
        <div className="absolute left-0 mt-1 w-80 rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] shadow-xl z-30 p-3 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-faint)] block mb-1">From</label>
            <input
              type="datetime-local"
              step="0.001"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              className="w-full rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] px-2 py-1.5 text-xs font-mono-tabular"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-faint)] block mb-1">To</label>
            <input
              type="datetime-local"
              step="0.001"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              className="w-full rounded-md border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg)] px-2 py-1.5 text-xs font-mono-tabular"
            />
          </div>
          <p className="text-[10px] text-[color:var(--color-text-faint)]">
            Times are in <span className="text-[color:var(--color-text-muted)] font-medium">{label}</span>, matching the Timestamp column — change the display timezone in Settings. Leave either field blank for an open-ended range.
          </p>
          <div className="flex justify-between gap-2 pt-1 border-t border-[color:var(--color-border)]">
            <Button variant="ghost" size="sm" onClick={clear}>
              <X size={12} /> Clear
            </Button>
            <Button variant="primary" size="sm" onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  )
}
