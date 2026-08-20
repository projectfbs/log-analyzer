/// <reference lib="webworker" />
import { detectParser, jsonParser } from '../parsers'
import { setCsvHeader, resetCsvHeader, splitCsvLine } from '../parsers/csv'
import type { ParsedFields } from '../parsers/types'
import type { ParserName } from '../types'

export interface ParseRequest {
  type: 'parse'
  fileId: number
  fileName: string
  text: string
}

export interface ParseProgress {
  type: 'progress'
  phase: 'reading' | 'parsing' | 'saving'
  percent: number
  eventsSoFar: number
}

export interface ParseChunk {
  type: 'chunk'
  fileId: number
  events: (ParsedFields & { rawLog: string; lineNumber: number })[]
  parser: ParserName
}

export interface ParseDone {
  type: 'done'
  fileId: number
  parser: ParserName
  totalEvents: number
  processingTimeMs: number
}

const CHUNK_SIZE = 5000

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { type, fileId, fileName, text } = e.data
  if (type !== 'parse') return

  const startTime = performance.now()
  post({ type: 'progress', phase: 'reading', percent: 100, eventsSoFar: 0 } satisfies ParseProgress)

  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const totalLines = lines.length

  // ---- JSON array file special-case: whole document is one JSON array ----
  const trimmedStart = text.trimStart().slice(0, 1)
  if (fileName.toLowerCase().endsWith('.json') && trimmedStart === '[') {
    try {
      const arr = JSON.parse(text)
      if (Array.isArray(arr)) {
        let count = 0
        for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
          const slice = arr.slice(i, i + CHUNK_SIZE)
          const events = slice
            .map((obj: unknown, idx: number) => {
              const line = JSON.stringify(obj)
              const parsed = jsonParser.parseLine(line)
              if (!parsed) return null
              return { ...parsed, rawLog: line, lineNumber: i + idx + 1 }
            })
            .filter(Boolean) as any[]
          count += events.length
          post({ type: 'chunk', fileId, events, parser: 'json' } satisfies ParseChunk)
          post({
            type: 'progress',
            phase: 'parsing',
            percent: Math.round(((i + slice.length) / arr.length) * 100),
            eventsSoFar: count,
          } satisfies ParseProgress)
        }
        post({
          type: 'done',
          fileId,
          parser: 'json',
          totalEvents: count,
          processingTimeMs: performance.now() - startTime,
        } satisfies ParseDone)
        return
      }
    } catch {
      // fall through to line-based parsing
    }
  }

  // ---- Auto-detect parser using a sample ----
  const sample = lines.slice(0, Math.min(200, lines.length))
  const parser = detectParser(sample, fileName)

  if (parser.name === 'csv' && lines.length > 0) {
    setCsvHeader(splitCsvLine(lines[0]))
  } else {
    resetCsvHeader()
  }

  const startIdx = parser.name === 'csv' ? 1 : 0
  let eventsSoFar = 0
  let chunkBuffer: (ParsedFields & { rawLog: string; lineNumber: number })[] = []

  for (let i = startIdx; i < totalLines; i++) {
    const line = lines[i]
    const parsed = parser.parseLine(line)
    if (parsed) {
      chunkBuffer.push({ ...parsed, rawLog: line, lineNumber: i + 1 })
      eventsSoFar++
    }

    if (chunkBuffer.length >= CHUNK_SIZE) {
      post({ type: 'chunk', fileId, events: chunkBuffer, parser: parser.name } satisfies ParseChunk)
      chunkBuffer = []
      post({
        type: 'progress',
        phase: 'parsing',
        percent: Math.round((i / totalLines) * 100),
        eventsSoFar,
      } satisfies ParseProgress)
    }
  }

  if (chunkBuffer.length > 0) {
    post({ type: 'chunk', fileId, events: chunkBuffer, parser: parser.name } satisfies ParseChunk)
  }

  post({
    type: 'done',
    fileId,
    parser: parser.name,
    totalEvents: eventsSoFar,
    processingTimeMs: performance.now() - startTime,
  } satisfies ParseDone)
}

function post(msg: ParseProgress | ParseChunk | ParseDone) {
  ;(self as unknown as Worker).postMessage(msg)
}
