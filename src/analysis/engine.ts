import type { DetectionFinding, DetectionRule, LogEvent } from '../types'

/**
 * Runs a threshold-over-time-window detection rule against a set of events.
 * All computation happens in memory in the browser — no external calls.
 *
 * Groups events by rule.groupByField, and within each group, uses a sliding
 * window to find any window of `windowSeconds` containing >= thresholdCount
 * matching events.
 */
export function runRule(rule: DetectionRule, events: LogEvent[]): DetectionFinding[] {
  const matching = events.filter((e) => {
    if (rule.conditionEventType && e.eventType !== rule.conditionEventType) return false
    if (e.timestamp === null) return false
    return true
  })

  const groups = new Map<string, LogEvent[]>()
  for (const e of matching) {
    const key = (e[rule.groupByField] as string | null) ?? '(unknown)'
    if (key === '(unknown)') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  const findings: DetectionFinding[] = []
  const windowMs = rule.windowSeconds * 1000

  for (const [groupValue, groupEvents] of groups) {
    const sorted = [...groupEvents].sort((a, b) => (a.timestamp! - b.timestamp!))
    let left = 0
    for (let right = 0; right < sorted.length; right++) {
      while (sorted[right].timestamp! - sorted[left].timestamp! > windowMs) {
        left++
      }
      const count = right - left + 1
      if (count >= rule.thresholdCount) {
        findings.push({
          ruleName: rule.name,
          groupValue,
          count,
          windowStart: sorted[left].timestamp!,
          windowEnd: sorted[right].timestamp!,
          logIds: sorted.slice(left, right + 1).map((e) => e.id!),
          description: `${rule.name}: ${count} matching events from ${groupValue} within ${rule.windowSeconds}s`,
        })
        // avoid re-triggering on every subsequent point in the same burst
        left = right + 1
      }
    }
  }

  return findings
}

export function runAllRules(rules: DetectionRule[], events: LogEvent[]): DetectionFinding[] {
  const enabled = rules.filter((r) => r.enabled)
  return enabled.flatMap((r) => runRule(r, events))
}
