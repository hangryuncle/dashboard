export type Measurement = {
  id: number
  packet_id?: number | string | null
  device_id: string
  timestamp: string
  temperature?: number | null
  humidity?: number | null
  pressure?: number | null
  voltage?: number | null
  current?: number | null
  [key: string]: unknown
}

export type Pdr = {
  device_id: string
  received: number
  expected: number
  lost: number
  pdr_percent: number
}

export type PdrFetchResult = {
  records: Pdr[]
  errors: { deviceId: string; message: string }[]
}

export const PAGE_SIZE = 15

export function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") ?? ""
}

export async function fetchMeasurements(signal?: AbortSignal) {
  const base = apiBaseUrl()
  if (!base) throw new Error("Set NEXT_PUBLIC_API_URL to connect your FastAPI service.")
  const response = await fetch(`${base}/measurements`, { signal, cache: "no-store" })
  if (!response.ok) throw new Error(`Measurements request failed (${response.status}).`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error("The measurements endpoint returned an unexpected response.")
  return (payload as Measurement[])
    .filter((measurement) => measurement && typeof measurement.device_id === "string" && Number.isFinite(Date.parse(measurement.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export async function fetchPdr(deviceId: string, signal?: AbortSignal): Promise<Pdr> {
  const base = apiBaseUrl()
  if (!base) throw new Error("Set NEXT_PUBLIC_API_URL to connect your FastAPI service.")
  const response = await fetch(`${base}/measurements/pdr/${encodeURIComponent(deviceId)}`, { signal, cache: "no-store" })
  if (!response.ok) throw new Error(`PDR request failed (${response.status}).`)
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== "object") throw new Error("The PDR endpoint returned an unexpected response.")
  const source = Array.isArray(payload) ? payload[0] : payload
  if (!source || typeof source !== "object") throw new Error("The PDR endpoint returned an empty response.")
  const result = source as Record<string, unknown>
  const nested = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : result
  const value = (...keys: string[]) => keys.map((key) => nested[key] ?? result[key]).find((candidate) => candidate !== undefined && candidate !== null)
  const received = Number(value("received", "delivered", "successful", "packets_received"))
  const rawLost = Number(value("lost", "dropped", "missing", "packets_lost"))
  const rawExpected = Number(value("expected", "sent", "transmitted", "packets_expected"))
  const rawRatio = Number(value("pdr_percent", "pdr", "pdr_ratio", "delivery_ratio", "packet_delivery_ratio"))
  const lost = Number.isFinite(rawLost) && rawLost >= 0 ? rawLost : 0
  const expected = Number.isFinite(rawExpected) && rawExpected > 0 ? rawExpected : received + lost
  const suppliedPercentage = Number.isFinite(rawRatio) ? rawRatio : Number.NaN
  const percentage = Number.isFinite(suppliedPercentage)
    ? suppliedPercentage <= 1 ? suppliedPercentage * 100 : suppliedPercentage
    : expected > 0 ? (received / expected) * 100 : Number.NaN
  if (![received, expected, lost, percentage].every(Number.isFinite) || received < 0 || expected <= 0 || lost < 0 || received > expected) {
    throw new Error("PDR response is missing valid received, expected, lost, or pdr_percent values.")
  }
  return {
    device_id: typeof result.device_id === "string" ? result.device_id : deviceId,
    received,
    expected,
    lost,
    pdr_percent: percentage,
  }
}

export async function fetchPdrForDevices(deviceIds: string[]): Promise<PdrFetchResult> {
  const records: Pdr[] = []
  const errors: PdrFetchResult["errors"] = []
  for (let index = 0; index < deviceIds.length; index += 8) {
    const batch = deviceIds.slice(index, index + 8)
    const results = await Promise.allSettled(batch.map((deviceId) => fetchPdr(deviceId)))
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") records.push(result.value)
      else errors.push({
        deviceId: batch[resultIndex],
        message: result.reason instanceof Error ? result.reason.message : "PDR request failed.",
      })
    })
  }
  return { records, errors }
}

export function pdrPercentage(pdr: Pdr | null) {
  if (!pdr) return null
  if (Number.isFinite(pdr.pdr_percent)) return pdr.pdr_percent
  return pdr.expected > 0 ? (pdr.received / pdr.expected) * 100 : null
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected error occurred."
}

export function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

export function formatMetric(value: unknown, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`
}

export function getMeasurementMetrics(measurements: Measurement[]) {
  const seen = new Set<string>()
  return measurements.flatMap((measurement) => ["temperature", "humidity", "rssi", "snr"]
    .filter((key) => typeof measurement[key] === "number" && Number.isFinite(measurement[key]))
    .map((key) => [key, measurement[key]] as const)
    .filter(([key]) => !seen.has(key) && !!seen.add(key))
    .map(([key]) => key))
}

export function metricLabel(key: string) {
  return key.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

export function metricUnit(key: string) {
  const units: Record<string, string> = { temperature: "°C", humidity: "%", pressure: "hPa", voltage: "V", current: "A", rssi: "dBm", snr: "dB" }
  return units[key.toLowerCase()] ?? ""
}

export function rangeStart(range: "1h" | "6h" | "12h" | "24h" | "7d" | "all", now = Date.now()) {
  if (range === "all") return Number.NEGATIVE_INFINITY
  return now - ({ "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "12h": 12 * 60 * 60_000, "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000 }[range])
}

