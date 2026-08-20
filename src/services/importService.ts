import { db } from '../db/database'
import type { LogFile, ParserName } from '../types'
import type { ParseChunk, ParseDone, ParseProgress } from '../workers/logParser.worker'

export interface ImportProgress {
  fileName: string
  phase: 'reading' | 'parsing' | 'saving' | 'done'
  percent: number
  events: number
}

const MAX_ORIGINAL_STORE_BYTES = 2 * 1024 * 1024 // 2MB — beyond this, original text isn't auto-stored

export function importFile(
  file: File,
  onProgress: (p: ImportProgress) => void,
): Promise<{ fileId: number; parser: ParserName; totalEvents: number; processingTimeMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/logParser.worker.ts', import.meta.url), { type: 'module' })

    let fileId: number
    let savedCount = 0

    const setup = async () => {
      onProgress({ fileName: file.name, phase: 'reading', percent: 0, events: 0 })
      const text = await file.text()
      onProgress({ fileName: file.name, phase: 'reading', percent: 100, events: 0 })

      const record: LogFile = {
        name: file.name,
        size: file.size,
        importedAt: Date.now(),
        eventCount: 0,
        parser: 'generic',
        processingTimeMs: 0,
        storeOriginal: file.size <= MAX_ORIGINAL_STORE_BYTES,
        originalContent: file.size <= MAX_ORIGINAL_STORE_BYTES ? text : undefined,
        active: true,
      }
      fileId = await db.logFiles.add(record)

      worker.postMessage({ type: 'parse', fileId, fileName: file.name, text })
    }

    worker.onmessage = async (e: MessageEvent<ParseProgress | ParseChunk | ParseDone>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress({ fileName: file.name, phase: msg.phase, percent: msg.percent, events: msg.eventsSoFar })
      } else if (msg.type === 'chunk') {
        const rows = msg.events.map((ev) => ({ ...ev, fileId: msg.fileId, parser: msg.parser, mark: null }))
        await db.logs.bulkAdd(rows as any)
        savedCount += rows.length
        onProgress({ fileName: file.name, phase: 'saving', percent: 100, events: savedCount })
      } else if (msg.type === 'done') {
        await db.logFiles.update(msg.fileId, {
          eventCount: msg.totalEvents,
          parser: msg.parser,
          processingTimeMs: msg.processingTimeMs,
        })
        onProgress({ fileName: file.name, phase: 'done', percent: 100, events: msg.totalEvents })
        worker.terminate()
        resolve({ fileId: msg.fileId, parser: msg.parser, totalEvents: msg.totalEvents, processingTimeMs: msg.processingTimeMs })
      }
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(err)
    }

    setup().catch(reject)
  })
}

export async function importFiles(files: File[], onProgress: (fileName: string, p: ImportProgress) => void) {
  const results = []
  for (const file of files) {
    const result = await importFile(file, (p) => onProgress(file.name, p))
    results.push(result)
  }
  return results
}
