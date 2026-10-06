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

export type TimeRange = '1h' | '6h' | '12h' | '24h' | '7d' | 'all'
export type MeasurementMetric = 'temperature' | 'humidity' | 'rssi' | 'snr'

export const TIME_RANGES: { value: TimeRange; label: string; milliseconds: number | null }[] = [
  { value: '1h', label: '1 hour', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: '6 hours', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '12h', label: '12 hours', milliseconds: 12 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { value: 'all', label: 'All time', milliseconds: null },
]

export const METRIC_DETAILS: Record<MeasurementMetric, { label: string; unit: string; color: string }> = {
  temperature: { label: 'Temperature', unit: '°C', color: 'var(--chart-1)' },
  humidity: { label: 'Humidity', unit: '%', color: 'var(--chart-2)' },
  rssi: { label: 'Signal strength', unit: 'dBm', color: 'var(--chart-3)' },
  snr: { label: 'Signal-to-noise ratio', unit: 'dB', color: 'var(--chart-4)' },
}
