import { describe, it, expect } from 'vitest'
import { runRule } from '../engine'
import { detectInjection } from '../injection'
import type { DetectionRule, LogEvent } from '../../types'

function makeEvent(overrides: Partial<LogEvent>): LogEvent {
  return {
    id: overrides.id,
    fileId: 1,
    timestamp: Date.now(),
    timestampRaw: null,
    hostname: null,
    logSource: null,
    eventType: 'SSH_LOGIN_FAILED',
    severity: 'MEDIUM',
    srcIp: '192.168.1.20',
    srcPort: null,
    dstIp: null,
    dstPort: null,
    protocol: null,
    username: null,
    process: null,
    action: null,
    status: null,
    message: null,
    rawLog: 'raw',
    parser: 'generic',
    mark: null,
    lineNumber: 0,
    url: null,
    httpVersion: null,
    userAgent: null,
    referer: null,
    requestBody: null,
    ...overrides,
  }
}

const bruteForceRule: DetectionRule = {
  name: 'SSH Brute Force',
  description: '',
  enabled: true,
  builtin: true,
  conditionEventType: 'SSH_LOGIN_FAILED',
  groupByField: 'srcIp',
  thresholdCount: 5,
  windowSeconds: 60,
  resultSeverity: 'HIGH',
  resultTag: 'BRUTE_FORCE',
  createdAt: Date.now(),
}

describe('runRule (threshold/window detection)', () => {
  it('flags a burst of failed logins from the same IP within the window', () => {
    // The engine fires as soon as the threshold is reached within the window,
    // then resets — this avoids emitting overlapping/duplicate alerts for the
    // same ongoing burst. With threshold=5, the finding triggers at the 5th event.
    const base = Date.now()
    const events = Array.from({ length: 6 }, (_, i) =>
      makeEvent({ id: i + 1, timestamp: base + i * 1000 }),
    )
    const findings = runRule(bruteForceRule, events)
    expect(findings.length).toBe(1)
    expect(findings[0].count).toBe(5)
    expect(findings[0].groupValue).toBe('192.168.1.20')
  })

  it('does not flag events spread out beyond the window', () => {
    const base = Date.now()
    const events = Array.from({ length: 6 }, (_, i) =>
      makeEvent({ id: i + 1, timestamp: base + i * 30_000 }), // 30s apart, window is 60s but threshold 5 within 60s window only covers ~2 events at a time
    )
    const findings = runRule(bruteForceRule, events)
    expect(findings.length).toBe(0)
  })

  it('does not flag events below the threshold', () => {
    const base = Date.now()
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ id: i + 1, timestamp: base + i * 1000 }),
    )
    const findings = runRule(bruteForceRule, events)
    expect(findings.length).toBe(0)
  })

  it('separates findings by distinct group values (source IPs)', () => {
    const base = Date.now()
    const eventsA = Array.from({ length: 5 }, (_, i) => makeEvent({ id: i + 1, timestamp: base + i * 1000, srcIp: '10.0.0.1' }))
    const eventsB = Array.from({ length: 5 }, (_, i) => makeEvent({ id: i + 10, timestamp: base + i * 1000, srcIp: '10.0.0.2' }))
    const findings = runRule(bruteForceRule, [...eventsA, ...eventsB])
    expect(findings.length).toBe(2)
  })
})

describe('detectInjection', () => {
  it('flags SQL injection patterns', () => {
    const matches = detectInjection("' OR 1=1 --")
    expect(matches.some((m) => m.tag === 'SQL_INJECTION')).toBe(true)
  })

  it('flags command injection patterns', () => {
    const matches = detectInjection('cat /etc/passwd')
    expect(matches.some((m) => m.tag === 'COMMAND_INJECTION')).toBe(true)
  })

  it('flags XSS patterns', () => {
    const matches = detectInjection('<script>alert(1)</script>')
    expect(matches.some((m) => m.tag === 'XSS')).toBe(true)
  })

  it('returns no matches for benign text', () => {
    const matches = detectInjection('user logged in successfully')
    expect(matches.length).toBe(0)
  })
})
