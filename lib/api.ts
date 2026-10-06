export type Measurement = {
  id: number
  packet_id: number
  device_id: string
  timestamp: string
  temperature: number | null
  humidity: number | null
  rssi: number | null
  snr: number | null
}

export type PacketDeliveryStats = {
  device_id: string
  received: number
  expected: number
  lost: number
  pdr_percent: number
}

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim()

export const apiBaseUrl = configuredApiUrl?.replace(/\/+$/, '') ?? ''
export const isApiConfigured = apiBaseUrl.length > 0

export async function fetchApi<T>(path: string): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error('Set NEXT_PUBLIC_API_URL to connect this dashboard to your FastAPI service.')
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    throw new Error('The API could not be reached. Check the backend URL and network connection.')
  }

  if (!response.ok) {
    let message = `The API returned an error (${response.status}).`
    try {
      const body = (await response.json()) as { detail?: unknown; message?: unknown }
      if (typeof body.detail === 'string') message = body.detail
      else if (typeof body.message === 'string') message = body.message
    } catch {
      // Keep the HTTP status message when the API response is not JSON.
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

export async function fetchMeasurements(): Promise<Measurement[]> {
  const result = await fetchApi<unknown>('/measurements')
  if (!Array.isArray(result)) {
    throw new Error('The measurements endpoint returned an unexpected response.')
  }

  return (result as Measurement[]).slice().sort((left, right) => {
    return Date.parse(right.timestamp) - Date.parse(left.timestamp)
  })
}

export function formatTimestamp(value: string, includeSeconds = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: includeSeconds ? 'medium' : 'short',
  }).format(date)
}

export function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value)
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong while loading telemetry.'
}

export function getMeasurementsPath(deviceId: string) {
  return `/measurements/pdr/${encodeURIComponent(deviceId)}`
}

export function getLatestMeasurement(records: Measurement[]) {
  return records.reduce<Measurement | undefined>((latest, record) => {
    if (!Number.isFinite(Date.parse(record.timestamp))) return latest
    if (!latest || Date.parse(record.timestamp) > Date.parse(latest.timestamp)) return record
    return latest
  }, undefined)
}

export function filterMeasurementsByRange(records: Measurement[], range: string, now = Date.now()) {
  if (range === 'all') return records
  const durationByRange: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  const duration = durationByRange[range]
  if (!duration) return records
  const cutoff = now - duration
  return records.filter((record) => {
    const timestamp = Date.parse(record.timestamp)
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now
  })
}

export function sampleMeasurements(records: Measurement[], key: keyof Pick<Measurement, 'temperature' | 'humidity' | 'rssi' | 'snr'>) {
  const data = records
    .filter((record) => record[key] !== null && Number.isFinite(record[key]))
    .slice()
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))

  const maxBuckets = 350
  if (data.length <= maxBuckets * 4) return data

  const bucketSize = Math.ceil(data.length / maxBuckets)
  const selected = new Set<number>([0, data.length - 1])
  for (let start = 0; start < data.length; start += bucketSize) {
    const end = Math.min(start + bucketSize, data.length)
    let minIndex = start
    let maxIndex = start
    for (let index = start + 1; index < end; index += 1) {
      if ((data[index][key] as number) < (data[minIndex][key] as number)) minIndex = index
      if ((data[index][key] as number) > (data[maxIndex][key] as number)) maxIndex = index
    }
    selected.add(start)
    selected.add(end - 1)
    selected.add(minIndex)
    selected.add(maxIndex)
  }

  return [...selected].sort((left, right) => left - right).map((index) => data[index])
}

export function hasMetricValue(records: Measurement[], key: keyof Pick<Measurement, 'temperature' | 'humidity' | 'rssi' | 'snr'>) {
  return records.some((record) => record[key] !== null && Number.isFinite(record[key]))
}

export const rangeOptions = [
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: 'all', label: 'All' },
] as const

export const chartMetrics = [
  { key: 'temperature', title: 'Temperature', unit: '°C', color: 'var(--chart-1)' },
  { key: 'humidity', title: 'Humidity', unit: '%', color: 'var(--chart-2)' },
  { key: 'rssi', title: 'Signal strength', unit: 'dBm', color: 'var(--chart-3)' },
  { key: 'snr', title: 'Signal-to-noise ratio', unit: 'dB', color: 'var(--chart-4)' },
] as const

export type ChartMetricKey = (typeof chartMetrics)[number]['key']

export function getMetricLabel(key: ChartMetricKey) {
  return chartMetrics.find((metric) => metric.key === key)?.title ?? key
}

export function getMetricUnit(key: ChartMetricKey) {
  return chartMetrics.find((metric) => metric.key === key)?.unit ?? ''
}

export function getMetricColor(key: ChartMetricKey) {
  return chartMetrics.find((metric) => metric.key === key)?.color ?? 'var(--chart-1)'
}

export function getMetricAxisLabel(key: ChartMetricKey) {
  const unit = getMetricUnit(key)
  return unit ? `${getMetricLabel(key)} (${unit})` : getMetricLabel(key)
}

export function getDeviceMeasurements(records: Measurement[], deviceId: string) {
  return records.filter((record) => record.device_id === deviceId)
}

export function getMetricValue(record: Measurement | undefined, key: ChartMetricKey) {
  return record ? record[key] : null
}

export function getApiEndpoint(path: string) {
  return `${apiBaseUrl}${path}`
}

export function isMeasurementRecord(value: unknown): value is Measurement {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<Measurement>
  return typeof record.device_id === 'string' && typeof record.timestamp === 'string'
}

export function toMeasurements(value: unknown): Measurement[] {
  if (!Array.isArray(value)) throw new Error('The measurements endpoint returned an unexpected response.')
  const records = value.filter(isMeasurementRecord)
  if (records.length !== value.length) throw new Error('The measurements endpoint returned malformed records.')
  return records.slice().sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
}

export function getApiConfigurationError() {
  return isApiConfigured ? null : 'Add NEXT_PUBLIC_API_URL to the project environment to connect the FastAPI backend.'
}

export function getPdrPath(deviceId: string) {
  return getMeasurementsPath(deviceId)
}

export function getMeasurementsEndpoint() {
  return getApiEndpoint('/measurements')
}

export function getPdrEndpoint(deviceId: string) {
  return getApiEndpoint(getPdrPath(deviceId))
}

export function isValidPdr(value: unknown): value is PacketDeliveryStats {
  if (!value || typeof value !== 'object') return false
  const stats = value as Partial<PacketDeliveryStats>
  return typeof stats.device_id === 'string'
    && typeof stats.received === 'number'
    && typeof stats.expected === 'number'
    && typeof stats.lost === 'number'
    && typeof stats.pdr_percent === 'number'
}

export function validatePdr(value: unknown): PacketDeliveryStats {
  if (!isValidPdr(value)) throw new Error('The packet delivery endpoint returned an unexpected response.')
  return value
}

export function latestMetric(records: Measurement[], key: ChartMetricKey) {
  const latest = getLatestMeasurement(records)
  return getMetricValue(latest, key)
}

export function getTimeRangeLabel(range: string) {
  return rangeOptions.find((option) => option.value === range)?.label ?? 'All'
}

export function getRecordCountLabel(count: number) {
  return `${new Intl.NumberFormat().format(count)} measurement${count === 1 ? '' : 's'}`
}

export function getMissingMetricLabel(key: ChartMetricKey) {
  return `${getMetricLabel(key)} unavailable`
}

export function sortMeasurements(records: Measurement[], key: keyof Measurement, direction: 'asc' | 'desc') {
  return records.slice().sort((left, right) => {
    const a = left[key]
    const b = right[key]
    const comparison = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true })
    return direction === 'asc' ? comparison : -comparison
  })
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatWithUnit(value: number | null | undefined, unit: string, digits = 1) {
  const formatted = formatNumber(value, digits)
  return formatted === 'Unavailable' ? formatted : `${formatted} ${unit}`
}

export function formatAxisTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

export function getChartValue(record: Measurement, key: ChartMetricKey) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function describeApiConfiguration() {
  return 'The dashboard reads from your FastAPI backend. Configure NEXT_PUBLIC_API_URL with its base URL to load live data.'
}

export function createMeasurementsKey() {
  return isApiConfigured ? getMeasurementsEndpoint() : null
}

export function createPdrKey(deviceId: string) {
  return isApiConfigured && deviceId ? getPdrEndpoint(deviceId) : null
}

export async function apiJsonFetcher<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  } catch {
    throw new Error('The API could not be reached. Check the backend URL and network connection.')
  }
  if (!response.ok) {
    let message = `The API returned an error (${response.status}).`
    try {
      const body = (await response.json()) as { detail?: unknown; message?: unknown }
      if (typeof body.detail === 'string') message = body.detail
      else if (typeof body.message === 'string') message = body.message
    } catch {
      // Use the status message for non-JSON error responses.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export async function measurementsFetcher(url: string) {
  return toMeasurements(await apiJsonFetcher<unknown>(url))
}

export async function pdrFetcher(url: string) {
  return validatePdr(await apiJsonFetcher<unknown>(url))
}

export function getPdrPercent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value, 1)}%` : 'Unavailable'
}

export function safeDateSort(a: Measurement, b: Measurement) {
  return Date.parse(a.timestamp) - Date.parse(b.timestamp)
}

export function metricHasValue(record: Measurement | undefined, key: ChartMetricKey) {
  return typeof getMetricValue(record, key) === 'number' && Number.isFinite(getMetricValue(record, key))
}

export function getStatsSummary(stats: PacketDeliveryStats) {
  return [
    { label: 'Received', value: formatNumber(stats.received, 0) },
    { label: 'Expected', value: formatNumber(stats.expected, 0) },
    { label: 'Lost', value: formatNumber(stats.lost, 0) },
  ]
}

export function getTelemetryHealthLabel(records: Measurement[]) {
  return records.length ? 'Live telemetry' : 'No readings'
}

export function getPdrStatusLabel(stats: PacketDeliveryStats) {
  return `${formatNumber(stats.pdr_percent, 1)}% packet delivery`
}

export function getApiBaseUrl() {
  return apiBaseUrl
}

export function getRangeCutoff(range: string, now = Date.now()) {
  if (range === 'all') return null
  const duration = rangeOptions.find((option) => option.value === range)
  if (!duration) return null
  const durationByValue: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  return now - (durationByValue[range] ?? 0)
}

export function chartDataForRange(records: Measurement[], range: string, key: ChartMetricKey) {
  return sampleMeasurements(filterMeasurementsByRange(records, range), key)
}

export function formatPdrCount(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function getMeasurementSummary(records: Measurement[]) {
  const latest = getLatestMeasurement(records)
  return { latest, count: records.length, updatedAt: latest?.timestamp ?? null }
}

export function isValidMeasurementValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getDeviceHeading(deviceId: string) {
  return deviceId ? `Device ${deviceId}` : 'No device selected'
}

export function buildDevicePath(deviceId: string) {
  return `/devices/${encodeURIComponent(deviceId)}`
}

export function normalizeDeviceId(value: string) {
  return value.trim()
}

export function pdrEndpointLabel(deviceId: string) {
  return `/measurements/pdr/${deviceId}`
}

export function getChartDescription(key: ChartMetricKey) {
  return `${getMetricLabel(key)} over time from recorded measurements.`
}

export function isFiniteTimestamp(value: string) {
  return Number.isFinite(Date.parse(value))
}

export function rangeFilterDescription(range: string) {
  return range === 'all' ? 'Showing all recorded measurements.' : `Showing recorded measurements from the last ${getTimeRangeLabel(range).toLowerCase()}.`
}

export function getNoValueLabel(key: ChartMetricKey) {
  return `No ${getMetricLabel(key).toLowerCase()} values are available for this device.`
}

export function formatPdrStats(stats: PacketDeliveryStats) {
  return {
    pdr: getPdrPercent(stats.pdr_percent),
    received: formatPdrCount(stats.received),
    expected: formatPdrCount(stats.expected),
    lost: formatPdrCount(stats.lost),
  }
}

export function chartHasValues(records: Measurement[], key: ChartMetricKey) {
  return hasMetricValue(records, key)
}

export function getAxisDomain(key: ChartMetricKey): [string, string] {
  return key === 'rssi' ? ['auto', 'auto'] : ['auto', 'auto']
}

export function getTooltipTimestamp(value: string) {
  return formatTimestamp(value, true)
}

export function getMetricCardCaption(key: ChartMetricKey) {
  if (key === 'temperature') return 'Latest recorded temperature'
  if (key === 'humidity') return 'Latest recorded humidity'
  if (key === 'rssi') return 'Latest received signal strength'
  return 'Latest signal-to-noise ratio'
}

export function getStatusDescription(error?: unknown) {
  return error ? getErrorMessage(error) : 'Connected to the FastAPI service'
}

export function isMeasurementForDevice(record: Measurement, deviceId: string) {
  return record.device_id === deviceId
}

export function getPageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function getVisiblePage<T>(records: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize
  return records.slice(start, start + pageSize)
}

export function getPaginationLabel(page: number, pageSize: number, count: number) {
  if (!count) return 'No measurements'
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, count)
  return `Showing ${start}–${end} of ${new Intl.NumberFormat().format(count)}`
}

export function getMeasurementFieldLabel(key: keyof Measurement) {
  const labels: Record<keyof Measurement, string> = {
    id: 'ID', packet_id: 'Packet ID', device_id: 'Device ID', timestamp: 'Timestamp',
    temperature: 'Temperature', humidity: 'Humidity', rssi: 'RSSI', snr: 'SNR',
  }
  return labels[key]
}

export function getMeasurementFieldUnit(key: keyof Measurement) {
  if (key === 'temperature') return '°C'
  if (key === 'humidity') return '%'
  if (key === 'rssi') return 'dBm'
  if (key === 'snr') return 'dB'
  return ''
}

export function formatMeasurementValue(key: keyof Measurement, value: Measurement[keyof Measurement]) {
  if (key === 'timestamp' && typeof value === 'string') return formatTimestamp(value)
  if (typeof value === 'number') {
    const unit = getMeasurementFieldUnit(key)
    return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value, 0)
  }
  return value === null || value === undefined ? '—' : String(value)
}

export function getMeasurementError(error: unknown) {
  return `Unable to load measurements: ${getErrorMessage(error)}`
}

export function getPdrError(error: unknown) {
  return `Packet delivery statistics are unavailable: ${getErrorMessage(error)}`
}

export function getRangeValues(records: Measurement[], range: string) {
  return filterMeasurementsByRange(records, range)
}

export function getLatestTimestamp(records: Measurement[]) {
  return getLatestMeasurement(records)?.timestamp
}

export function pdrForDevice(stats: PacketDeliveryStats | undefined, deviceId: string) {
  return stats?.device_id === deviceId ? stats : undefined
}

export function getMeasurementKeys(): (keyof Measurement)[] {
  return ['timestamp', 'packet_id', 'device_id', 'temperature', 'humidity', 'rssi', 'snr']
}

export function orderMeasurementsByTime(records: Measurement[]) {
  return records.slice().sort(safeDateSort)
}

export function isPresent(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

export function getMetricTooltipValue(value: unknown, unit: string) {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value)} ${unit}` : 'Unavailable'
}

export function errorToString(error: unknown) {
  return getErrorMessage(error)
}

export function getLatestMetricTimestamp(records: Measurement[]) {
  return getLatestMeasurement(records)?.timestamp ?? null
}

export function getDeviceIdPlaceholder() {
  return 'sensor-01'
}

export function isDeviceIdValid(value: string) {
  return value.trim().length > 0
}

export function getDeviceLabel(deviceId: string) {
  return deviceId || 'No device selected'
}

export function isApiError(error: unknown) {
  return error instanceof Error
}

export function getMeasurementsByDevice(records: Measurement[], deviceId: string) {
  return getDeviceMeasurements(records, deviceId)
}

export function getRangeLabel(range: string) {
  return getTimeRangeLabel(range)
}

export function getTemperatureUnit() {
  return '°C'
}

export function getHumidityUnit() {
  return '%'
}

export function getRssiUnit() {
  return 'dBm'
}

export function getSnrUnit() {
  return 'dB'
}

export function getPdrUnit() {
  return '%'
}

export function getApiHostLabel() {
  try {
    return apiBaseUrl ? new URL(apiBaseUrl).host : 'API not configured'
  } catch {
    return 'API URL is invalid'
  }
}

export function getTelemetryUpdatedLabel(value?: string) {
  return value ? `Latest reading ${formatTimestamp(value)}` : 'No readings yet'
}

export function getMetricCardValue(record: Measurement | undefined, key: ChartMetricKey) {
  return formatNumber(getMetricValue(record, key))
}

export function hasSNR(records: Measurement[]) {
  return hasMetricValue(records, 'snr')
}

export function cleanDeviceId(value: string) {
  return value.trim().slice(0, 120)
}

export function getNoDeviceDescription() {
  return 'Enter a device ID above to load its real telemetry and packet delivery statistics.'
}

export function getNoMeasurementDescription() {
  return 'This device has no recorded telemetry yet.'
}

export function getRangeEmptyDescription(range: string) {
  return `No measurements were recorded in the selected ${getTimeRangeLabel(range).toLowerCase()} range.`
}

export function getSNRDescription(records: Measurement[]) {
  return hasSNR(records) ? 'Signal-to-noise ratio from recorded packets.' : 'SNR will appear when the API returns values for this device.'
}

export function isMeasurementList(value: unknown): value is Measurement[] {
  return Array.isArray(value) && value.every(isMeasurementRecord)
}

export function getMeasurementRecordCount(records: Measurement[]) {
  return new Intl.NumberFormat().format(records.length)
}

export function getPdrRequestKey(deviceId: string) {
  return createPdrKey(deviceId)
}

export function getMeasurementsRequestKey() {
  return createMeasurementsKey()
}

export function getApiDescription() {
  return apiBaseUrl ? `API · ${getApiHostLabel()}` : 'FastAPI · awaiting configuration'
}

export function getFilteredMeasurements(records: Measurement[], deviceId: string) {
  return records.filter((record) => isMeasurementForDevice(record, deviceId))
}

export function getChartRecords(records: Measurement[], range: string) {
  return filterMeasurementsByRange(orderMeasurementsByTime(records), range)
}

export function chartValueCount(records: Measurement[], key: ChartMetricKey) {
  return records.reduce((count, record) => count + (metricHasValue(record, key) ? 1 : 0), 0)
}

export function measurementValueOrNull(value: unknown) {
  return isValidMeasurementValue(value) ? value : null
}

export function sortKeyForMeasurement(key: string): keyof Measurement {
  const keys = getMeasurementKeys() as string[]
  return keys.includes(key) ? key as keyof Measurement : 'timestamp'
}

export function getPdrSummaryDescription(stats: PacketDeliveryStats) {
  return `${formatPdrCount(stats.received)} of ${formatPdrCount(stats.expected)} expected packets received`
}

export function toDisplayMetric(value: number | null | undefined, unit: string, digits = 1) {
  const formatted = formatNumber(value, digits)
  return formatted === 'Unavailable' ? formatted : `${formatted} ${unit}`
}

export function getChartTickFormatter(value: string) {
  return formatAxisTimestamp(value)
}

export function getMeasurementTimestamp(record: Measurement) {
  return formatTimestamp(record.timestamp)
}

export function getDeviceStatsError(error: unknown) {
  return getPdrError(error)
}

export function getMeasurementApiError(error: unknown) {
  return getMeasurementError(error)
}

export function getMetricValueText(record: Measurement | undefined, key: ChartMetricKey) {
  const value = getMetricValue(record, key)
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable'
  return `${formatNumber(value)} ${getMetricUnit(key)}`
}

export function getRangeMeasurementCount(records: Measurement[], range: string) {
  return filterMeasurementsByRange(records, range).length
}

export function getPdrStatsKey(deviceId: string) {
  return `pdr:${deviceId}`
}

export function getSNRKey() {
  return 'snr'
}

export function getErrorTitle() {
  return 'Unable to load telemetry'
}

export function getPdrErrorTitle() {
  return 'Packet delivery unavailable'
}

export function getChartEmptyLabel(key: ChartMetricKey) {
  return `No ${getMetricLabel(key).toLowerCase()} data in this range`
}

export function makeApiConfigMessage() {
  return `Configure NEXT_PUBLIC_API_URL to load real measurements from your FastAPI backend.`
}

export function getRecordValue(record: Measurement, key: keyof Measurement) {
  return record[key]
}

export function rangeIsAll(range: string) {
  return range === 'all'
}

export function getSensorKey(key: ChartMetricKey) {
  return key
}

export function hasUsableTimestamp(record: Measurement) {
  return isFiniteTimestamp(record.timestamp)
}

export function currentTimestamp() {
  return Date.now()
}

export function hasDeviceId(value: string) {
  return value.trim().length > 0
}

export function apiBaseIsConfigured() {
  return isApiConfigured
}

export function isValidMeasurementArray(value: unknown) {
  return Array.isArray(value) && value.every(isMeasurementRecord)
}

export function getVisibleMeasurements(records: Measurement[], page: number, pageSize: number) {
  return getVisiblePage(records, page, pageSize)
}

export function getTotalPages(count: number, pageSize: number) {
  return getPageCount(count, pageSize)
}

export function getSortDirection(direction: 'asc' | 'desc') {
  return direction === 'asc' ? 'Ascending' : 'Descending'
}

export function getPdrNumbers(stats: PacketDeliveryStats) {
  return { received: stats.received, expected: stats.expected, lost: stats.lost, pdrPercent: stats.pdr_percent }
}

export function getCardUnit(key: ChartMetricKey) {
  return getMetricUnit(key)
}

export function getUnavailableText() {
  return 'Unavailable'
}

export function getEmptyDashboardState() {
  return { title: 'No device selected', description: getNoDeviceDescription() }
}

export function getEmptyMeasurementsState() {
  return { title: 'No measurements found', description: getNoMeasurementDescription() }
}

export function getDeviceIdFromRoute(value: string | undefined) {
  return normalizeDeviceId(value ?? '')
}

export function getMetricCardTitle(key: ChartMetricKey) {
  return key === 'rssi' ? 'Latest RSSI' : key === 'snr' ? 'Latest SNR' : `Latest ${getMetricLabel(key)}`
}

export function getPdrCardTitle() {
  return 'Packet delivery ratio'
}

export function getPdrUnitLabel() {
  return 'PDR'
}

export function getTableCaption(count: number) {
  return `${new Intl.NumberFormat().format(count)} records for the selected device`
}

export function getPaginationPreviousLabel() {
  return 'Previous measurements'
}

export function getPaginationNextLabel() {
  return 'Next measurements'
}

export function getRetryLabel() {
  return 'Retry loading measurements'
}

export function getRefreshLabel() {
  return 'Refresh telemetry'
}

export function getLoadDeviceLabel() {
  return 'Load device telemetry'
}

export function formatDateTime(value: string) {
  return formatTimestamp(value, true)
}

export function getVisibleRowsLabel(page: number, pageSize: number, total: number) {
  return getPaginationLabel(page, pageSize, total)
}

export function emptyMetricText() {
  return '—'
}

export function getDeviceMeasurementError() {
  return 'No measurements found for this device.'
}

export function chartRangeSummary(range: string, count: number) {
  return `${getTimeRangeLabel(range)} · ${getRecordCountLabel(count)}`
}

export function getPdrMetricLabel() {
  return 'Packet delivery ratio'
}

export function getApiName() {
  return 'FastAPI telemetry service'
}

export function getMetricDisplay(record: Measurement | undefined, key: ChartMetricKey) {
  return getMetricValueText(record, key)
}

export function getMeasurementErrorDescription(error: unknown) {
  return getErrorMessage(error)
}

export function getRangeButtonLabel(range: string) {
  return getTimeRangeLabel(range)
}

export function sortMeasurementsBy(records: Measurement[], key: keyof Measurement, direction: 'asc' | 'desc') {
  return sortMeasurements(records, key, direction)
}

export function getMeasurementTimestampValue(record: Measurement) {
  return Date.parse(record.timestamp)
}

export function defaultSortDirection(): 'asc' | 'desc' {
  return 'desc'
}

export function getLiveIndicatorLabel(isLoading: boolean, hasError: boolean) {
  if (isLoading) return 'Connecting'
  if (hasError) return 'Connection issue'
  return 'Connected'
}

export function getMeasurementDisplayValue(key: keyof Measurement, value: Measurement[keyof Measurement]) {
  return formatMeasurementValue(key, value)
}

export function sortForChart(records: Measurement[]) {
  return records.slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
}

export function getDevicePdrUrl(deviceId: string) {
  return getPdrEndpoint(deviceId)
}

export function getMeasurementsUrl() {
  return getMeasurementsEndpoint()
}

export function getMetricCardUnit(key: ChartMetricKey) {
  return getMetricUnit(key)
}

export function getTooltipDate(value: string) {
  return formatTimestamp(value, true)
}

export function getDeviceDisplayName(deviceId: string) {
  return deviceId
}

export function getMeasurementCount(records: Measurement[]) {
  return records.length
}

export function getPdrCountStats(stats: PacketDeliveryStats) {
  return [stats.received, stats.expected, stats.lost]
}

export function safeNumber(value: unknown) {
  return isValidMeasurementValue(value) ? value : null
}

export function chartColor(key: ChartMetricKey) {
  return getMetricColor(key)
}

export function chartAxisLabel(key: ChartMetricKey) {
  return getMetricAxisLabel(key)
}

export function getChartTooltipLabel(value: string) {
  return getTooltipTimestamp(value)
}

export function getPageRows<T>(items: T[], page: number, pageSize: number) {
  const offset = Math.max(0, page - 1) * pageSize
  return items.slice(offset, offset + pageSize)
}

export function formatPdrValue(stats: PacketDeliveryStats) {
  return `${formatNumber(stats.pdr_percent, 1)}%`
}

export function getPageButtonDisabled(page: number, totalPages: number, direction: 'previous' | 'next') {
  return direction === 'previous' ? page <= 1 : page >= totalPages
}

export function timestampToEpoch(value: string) {
  return Date.parse(value)
}

export function apiResponseError(status: number) {
  return new Error(`The API returned an error (${status}).`)
}

export function latestRecord(records: Measurement[]) {
  return getLatestMeasurement(records)
}

export function hasData(records: Measurement[]) {
  return records.length > 0
}

export function hasValidValue(record: Measurement, key: ChartMetricKey) {
  return isValidMeasurementValue(record[key])
}

export function getMetricsForDevice(records: Measurement[], deviceId: string) {
  return records.filter((record) => record.device_id === deviceId)
}

export function getChartData(records: Measurement[], range: string, key: ChartMetricKey) {
  return chartDataForRange(records, range, key)
}

export function getMeasurementsForPage(records: Measurement[], page: number, pageSize: number) {
  return records.slice((page - 1) * pageSize, page * pageSize)
}

export function updateDirection(direction: 'asc' | 'desc') {
  return direction === 'asc' ? 'desc' : 'asc'
}

export function parseMeasurementResponse(value: unknown) {
  return toMeasurements(value)
}

export function parsePdrResponse(value: unknown) {
  return validatePdr(value)
}

export function getSensorMetricKeys(records: Measurement[]): ChartMetricKey[] {
  return chartMetrics.map((metric) => metric.key).filter((key) => hasMetricValue(records, key))
}

export function getDashboardEmptyText() {
  return 'Enter a device ID above to load telemetry data.'
}

export function formatTemperature(value: number | null | undefined) {
  return formatWithUnit(value, '°C')
}

export function formatHumidity(value: number | null | undefined) {
  return formatWithUnit(value, '%')
}

export function formatRssi(value: number | null | undefined) {
  return formatWithUnit(value, 'dBm')
}

export function formatSnr(value: number | null | undefined) {
  return formatWithUnit(value, 'dB')
}

export function getUnitForKey(key: ChartMetricKey) {
  return getMetricUnit(key)
}

export function getTelemetryStatus(records: Measurement[]) {
  return records.length > 0 ? 'Device reporting' : 'No telemetry'
}

export function getApiPathForDevice(deviceId: string) {
  return getPdrPath(deviceId)
}

export function isTimestampWithinRange(timestamp: string, range: string, now = Date.now()) {
  const cutoff = getRangeCutoff(range, now)
  const parsed = Date.parse(timestamp)
  return cutoff === null || (Number.isFinite(parsed) && parsed >= cutoff && parsed <= now)
}

export function rangeFilter(records: Measurement[], range: string) {
  return filterMeasurementsByRange(records, range)
}

export function metricSortValue(record: Measurement, key: keyof Measurement) {
  return record[key]
}

export function tableColumnKeys() {
  return getMeasurementKeys()
}

export function getAPIStatus() {
  return getApiDescription()
}

export function displayDevice(deviceId: string) {
  return deviceId.trim() || 'No device selected'
}

export function getDataTimestamp(records: Measurement[]) {
  return getLatestTimestamp(records)
}

export function timeRangeOptions() {
  return rangeOptions
}

export function getRecordsForRange(records: Measurement[], range: string) {
  return filterMeasurementsByRange(records, range)
}

export function getSortedRecords(records: Measurement[], key: keyof Measurement, direction: 'asc' | 'desc') {
  return sortMeasurements(records, key, direction)
}

export function getRangeControlAriaLabel() {
  return 'Filter charts by time range'
}

export function getMetricCardAriaLabel(key: ChartMetricKey) {
  return getMetricCardTitle(key)
}

export function getExpectedCountLabel() {
  return 'Expected packets'
}

export function getReceivedCountLabel() {
  return 'Received packets'
}

export function getLostCountLabel() {
  return 'Lost packets'
}

export function getTableLoadingLabel() {
  return 'Loading measurements'
}

export function getChartLoadingLabel(key: ChartMetricKey) {
  return `Loading ${getMetricLabel(key).toLowerCase()} chart`
}

export function getMeasurementRowLabel(record: Measurement) {
  return `Packet ${record.packet_id} at ${formatTimestamp(record.timestamp)}`
}

export function hasAvailableSnr(records: Measurement[]) {
  return hasMetricValue(records, 'snr')
}

export function getApiConfigurationLabel() {
  return 'API configuration required'
}

export function getRetryActionLabel() {
  return 'Retry'
}

export function getRefreshActionLabel() {
  return 'Refresh'
}

export function getSelectedDeviceLabel(deviceId: string) {
  return deviceId ? `Device: ${deviceId}` : 'Device not selected'
}

export function latestMeasurementTimestamp(records: Measurement[]) {
  const value = getLatestTimestamp(records)
  return value ? formatTimestamp(value) : null
}

export function measurementCountSummary(records: Measurement[]) {
  return `${getMeasurementRecordCount(records)} total records`
}

export function getTooltipValueLabel(value: number, key: ChartMetricKey) {
  return `${formatNumber(value)} ${getMetricUnit(key)}`
}

export function sortRecordsByTimestamp(records: Measurement[], direction: 'asc' | 'desc') {
  return records.slice().sort((left, right) => {
    const diff = Date.parse(left.timestamp) - Date.parse(right.timestamp)
    return direction === 'asc' ? diff : -diff
  })
}

export function metricHasData(records: Measurement[], key: ChartMetricKey) {
  return records.some((record) => typeof record[key] === 'number' && Number.isFinite(record[key]))
}

export function recordValue(record: Measurement, key: ChartMetricKey) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function apiIsConfigured() {
  return Boolean(apiBaseUrl)
}

export function errorMessage(error: unknown) {
  return getErrorMessage(error)
}

export function toDevicePath(deviceId: string) {
  return buildDevicePath(deviceId)
}

export function formatCount(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function getTablePageCount(records: Measurement[], pageSize: number) {
  return Math.max(1, Math.ceil(records.length / pageSize))
}

export function getTablePage(records: Measurement[], page: number, pageSize: number) {
  return records.slice((page - 1) * pageSize, page * pageSize)
}

export function getAxisDomainForMetric(_key: ChartMetricKey): ['auto', 'auto'] {
  return ['auto', 'auto']
}

export function formatChartAxisTimestamp(value: string) {
  return formatAxisTimestamp(value)
}

export function getChartMetricCaption(key: ChartMetricKey) {
  return getChartDescription(key)
}

export function getDeviceCountSummary(records: Measurement[]) {
  return `${records.length} ${records.length === 1 ? 'measurement' : 'measurements'}`
}

export function getPdrErrorMessage(error: unknown) {
  return `PDR data could not be loaded. ${getErrorMessage(error)}`
}

export function getMetricLatest(records: Measurement[], key: ChartMetricKey) {
  const latest = getLatestMeasurement(records)
  return latest ? latest[key] : null
}

export function getSafeMetricValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatTimestampShort(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

export function getChartDataPoints(records: Measurement[], range: string, key: ChartMetricKey) {
  return chartDataForRange(records, range, key)
}

export function sortRecords(records: Measurement[], key: keyof Measurement, direction: 'asc' | 'desc') {
  return sortMeasurements(records, key, direction)
}

export function getMetricFormat(key: ChartMetricKey, value: number) {
  return `${formatNumber(value)} ${getMetricUnit(key)}`
}

export function getDeviceStatusText(deviceId: string) {
  return deviceId ? 'Selected device' : 'No device selected'
}

export function getUserFacingApiError(error: unknown) {
  return getErrorMessage(error)
}

export function toMetricValue(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

export function countMetricValues(records: Measurement[], key: ChartMetricKey) {
  return records.filter((record) => metricHasValue(record, key)).length
}

export function apiPath(path: string) {
  return `${apiBaseUrl}${path}`
}

export function getDevicesBasePath() {
  return '/devices/'
}

export function displayTimestamp(value: string) {
  return formatTimestamp(value)
}

export function getMetricsCount(records: Measurement[]) {
  return chartMetrics.filter((metric) => hasMetricValue(records, metric.key)).length
}

export function getSensorPdrEndpoint(deviceId: string) {
  return `/measurements/pdr/${encodeURIComponent(deviceId)}`
}

export function isPdrConfigured(deviceId: string) {
  return isApiConfigured && Boolean(deviceId)
}

export function getLatestValue(records: Measurement[], key: ChartMetricKey) {
  return latestMetric(records, key)
}

export function getWindowStart(range: string) {
  return getRangeCutoff(range)
}

export function getMetricReading(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return `${formatNumber(value)} ${unit}`
}

export function availableMetricKeys(records: Measurement[]) {
  return getSensorMetricKeys(records)
}

export function getChartDataByKey(records: Measurement[], range: string, key: ChartMetricKey) {
  return getChartDataPoints(records, range, key)
}

export function measurementKeysForTable() {
  return ['timestamp', 'packet_id', 'device_id', 'temperature', 'humidity', 'rssi', 'snr'] as const
}

export function getMetricChartColor(key: ChartMetricKey) {
  return chartColor(key)
}

export function getTooltipFormat(value: number, key: ChartMetricKey) {
  return getTooltipValueLabel(value, key)
}

export function formatAxisValue(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

export function getDeviceIdError() {
  return 'Enter a device ID to continue.'
}

export function getNoRecordsMessage() {
  return 'This device has no recorded telemetry yet.'
}

export function getTimeRangeNoRecordsMessage(range: string) {
  return `No records in the selected ${getTimeRangeLabel(range).toLowerCase()} range.`
}

export function getPdrPercentValue(value: number) {
  return `${formatNumber(value, 1)}%`
}

export function isFiniteMetric(record: Measurement, key: ChartMetricKey) {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
}

export function sortByTimeAscending(records: Measurement[]) {
  return records.slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
}

export function rangeFilteredCount(records: Measurement[], range: string) {
  return filterMeasurementsByRange(records, range).length
}

export function getDevicePagePath(deviceId: string) {
  return `/devices/${encodeURIComponent(deviceId)}`
}

export function getTablePageLabel(page: number, totalPages: number) {
  return `Page ${page} of ${totalPages}`
}

export function getDateTimeLabel(value: string) {
  return formatTimestamp(value, true)
}

export function chartTooltipDate(value: string) {
  return getTooltipTimestamp(value)
}

export function formatTableMetric(key: keyof Measurement, value: Measurement[keyof Measurement]) {
  return formatMeasurementValue(key, value)
}

export function deviceHasNoMeasurements(records: Measurement[]) {
  return records.length === 0
}

export function chartNoDataForRange(records: Measurement[], range: string) {
  return filterMeasurementsByRange(records, range).length === 0
}

export function apiConfiguredMessage() {
  return 'FastAPI backend URL is configured.'
}

export function getTelemetryPageTitle() {
  return 'Temperature Monitor'
}

export function getMeasurementTimeRange(records: Measurement[]) {
  if (!records.length) return null
  return {
    earliest: records.reduce((min, record) => Date.parse(record.timestamp) < Date.parse(min.timestamp) ? record : min).timestamp,
    latest: records.reduce((max, record) => Date.parse(record.timestamp) > Date.parse(max.timestamp) ? record : max).timestamp,
  }
}

export function getMetricDataKey(key: ChartMetricKey) {
  return key
}

export function chartHasSNR(records: Measurement[]) {
  return hasMetricValue(records, 'snr')
}

export function getPdrApiPath(deviceId: string) {
  return `/measurements/pdr/${encodeURIComponent(deviceId)}`
}

export function getEmptyDeviceLabel() {
  return 'No device selected'
}

export function getConnectedApiMessage() {
  return 'Connected to FastAPI'
}

export function getLatestMetricValue(records: Measurement[], key: ChartMetricKey) {
  return latestMetric(records, key)
}

export function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages))
}

export function getPdrPercentDisplay(stats: PacketDeliveryStats) {
  return getPdrPercent(stats.pdr_percent)
}

export function getMeasurementTime(record: Measurement) {
  return formatTimestamp(record.timestamp)
}

export function getDataKey(key: ChartMetricKey) {
  return key
}

export function getChartColorToken(key: ChartMetricKey) {
  return getMetricColor(key)
}

export function getRangeTimestampLabel(range: string) {
  return range === 'all' ? 'All recorded data' : `Last ${getTimeRangeLabel(range)}`
}

export function getPdrCount(stats: PacketDeliveryStats, field: 'received' | 'expected' | 'lost') {
  return formatPdrCount(stats[field])
}

export function getMetricUnitText(key: ChartMetricKey) {
  return getMetricUnit(key)
}

export function getTooltipLabel(value: string) {
  return formatTimestamp(value, true)
}

export function getMetricMissingState(key: ChartMetricKey) {
  return `${getMetricLabel(key)} data unavailable`
}

export function getPageRangeText(start: number, end: number, count: number) {
  return `Showing ${start}–${end} of ${formatCount(count)}`
}

export function getTableSortLabel(key: keyof Measurement, direction: 'asc' | 'desc') {
  return `Sort by ${getMeasurementFieldLabel(key)} ${getSortDirection(direction).toLowerCase()}`
}

export function getDevicePdrStatsUrl(deviceId: string) {
  return getPdrEndpoint(deviceId)
}

export function getChartAccessibleName(key: ChartMetricKey) {
  return `${getMetricLabel(key)} over time chart`
}

export function getDeviceCardLabel(deviceId: string) {
  return `Selected device ${deviceId}`
}

export function getMetricStatValue(record: Measurement | undefined, key: ChartMetricKey) {
  return getMetricDisplay(record, key)
}

export function getPlotData(records: Measurement[], key: ChartMetricKey, range: string) {
  return sampleMeasurements(filterMeasurementsByRange(records, range), key)
}

export function getPdrValue(stats: PacketDeliveryStats) {
  return stats.pdr_percent
}

export function getTimeRangeControlLabel() {
  return 'Chart time range'
}

export function getTableRecordCount(records: Measurement[]) {
  return `${formatCount(records.length)} measurement records`
}

export function getPdrMetricCaption(stats: PacketDeliveryStats) {
  return `${formatCount(stats.received)} received / ${formatCount(stats.expected)} expected`
}

export function getDeviceTelemetryTitle(deviceId: string) {
  return `Telemetry for ${deviceId}`
}

export function getNoMetricValue() {
  return 'No value reported'
}

export function getRefreshTimestampLabel(value: string) {
  return `Updated ${formatTimestamp(value)}`
}

export function getLastMeasurementLabel(value: string) {
  return `Last reading at ${formatTimestamp(value)}`
}

export type ChartConfig = Record<string, { label: string; color: string }>

export function telemetryChartConfig(key: ChartMetricKey) {
  return { [key]: { label: getMetricLabel(key), color: getMetricColor(key) } } satisfies ChartConfig
}

export function getMetricFromKey(key: ChartMetricKey) {
  return chartMetrics.find((metric) => metric.key === key)
}

export function getRecordsForDeviceAndRange(records: Measurement[], deviceId: string, range: string) {
  return filterMeasurementsByRange(getDeviceMeasurements(records, deviceId), range)
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getPdrStatDisplay(stats: PacketDeliveryStats, key: 'received' | 'expected' | 'lost') {
  return formatPdrCount(stats[key])
}

export function pageCount(recordCount: number, pageSize: number) {
  return Math.max(1, Math.ceil(recordCount / pageSize))
}

export function pageRows(records: Measurement[], page: number, pageSize: number) {
  return records.slice((page - 1) * pageSize, page * pageSize)
}
