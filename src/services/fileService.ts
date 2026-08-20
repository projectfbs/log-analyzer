import { db } from '../db/database'
import type { LogFile } from '../types'

export async function listLogFiles(): Promise<LogFile[]> {
  return db.logFiles.orderBy('importedAt').reverse().toArray()
}

/** File IDs currently included in analysis (dashboard stats, analysis page, detection rules, IP lookups). */
export async function getActiveFileIdSet(): Promise<Set<number>> {
  const all = await db.logFiles.toArray()
  return new Set(all.filter((f) => f.active).map((f) => f.id!))
}

export async function hasExcludedFiles(): Promise<boolean> {
  const total = await db.logFiles.count()
  if (total === 0) return false
  const activeIds = await getActiveFileIdSet()
  return activeIds.size < total
}

export async function setFileActive(fileId: number, active: boolean) {
  await db.logFiles.update(fileId, { active })
}

export async function deleteLogFile(fileId: number) {
  await db.transaction('rw', [db.logFiles, db.logs, db.logTags, db.notes, db.investigationLogs], async () => {
    const logIds = await db.logs.where('fileId').equals(fileId).primaryKeys()
    if (logIds.length > 0) {
      await db.logTags.where('logId').anyOf(logIds).delete()
      await db.notes.where('logId').anyOf(logIds).delete()
      await db.investigationLogs.where('logId').anyOf(logIds).delete()
      await db.logs.where('fileId').equals(fileId).delete()
    }
    await db.logFiles.delete(fileId)
  })
}
