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

export type MeasurementMetric = 'temperature' | 'humidity' | 'rssi' | 'snr'
export type TimeRange = '1h' | '6h' | '12h' | '24h' | '7d' | 'all'
export type SortField = keyof Pick<Measurement, 'timestamp' | 'packet_id' | 'device_id' | 'temperature' | 'humidity' | 'rssi' | 'snr'>
export type SortDirection = 'asc' | 'desc'

export const TIME_RANGES: { label: string; value: TimeRange; milliseconds?: number }[] = [
  { label: '1 hour', value: '1h', milliseconds: 60 * 60 * 1000 },
  { label: '6 hours', value: '6h', milliseconds: 6 * 60 * 60 * 1000 },
  { label: '12 hours', value: '12h', milliseconds: 12 * 60 * 60 * 1000 },
  { label: '24 hours', value: '24h', milliseconds: 24 * 60 * 60 * 1000 },
  { label: '7 days', value: '7d', milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: 'All', value: 'all' },
]
