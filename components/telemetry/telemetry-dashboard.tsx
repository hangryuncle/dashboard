"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import useSWR from "swr"
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  RefreshCw,
  Search,
  Signal,
  Wifi,
} from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  PAGE_SIZE,
  apiBaseUrl,
  errorMessage,
  fetchMeasurements,
  fetchPdrForDevices,
  formatMetric,
  formatTimestamp,
  getMeasurementMetrics,
  metricLabel,
  metricUnit,
  pdrPercentage,
  rangeStart,
  type Measurement,
  type Pdr,
} from "@/lib/telemetry"

type Range = "1h" | "6h" | "12h" | "24h" | "7d" | "all"
type LoadingValueProps = { loading: boolean; children: ReactNode }
type ChartPoint = { timestamp: number; seriesKey: string; value: number }

const DEVICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "oklch(0.68 0.13 255)",
  "oklch(0.72 0.14 30)",
  "oklch(0.68 0.12 330)",
]

const DEMO_DEVICES = [
  { deviceId: "field-node-01", phase: 0, temperature: 19.2 },
  { deviceId: "greenhouse-02", phase: 1.8, temperature: 22.4 },
  { deviceId: "roof-sensor-03", phase: 3.4, temperature: 17.8 },
]

const DEMO_PDR: Pdr[] = [
  { device_id: "field-node-01", received: 982, expected: 1000, lost: 18, pdr_percent: 98.2 },
  { device_id: "greenhouse-02", received: 941, expected: 1000, lost: 59, pdr_percent: 94.1 },
  { device_id: "roof-sensor-03", received: 996, expected: 1000, lost: 4, pdr_percent: 99.6 },
]

function createDemoMeasurements(): Measurement[] {
  const now = Math.floor(Date.now() / 300_000) * 300_000
  return Array.from({ length: 49 }, (_, sampleIndex) => {
    const timestamp = new Date(now - (48 - sampleIndex) * 30 * 60_000).toISOString()
    return DEMO_DEVICES.map((device, deviceIndex) => {
      const wave = Math.sin(sampleIndex / 4 + device.phase)
      const quickWave = Math.sin(sampleIndex / 1.7 + device.phase)
      return {
        id: sampleIndex * DEMO_DEVICES.length + deviceIndex + 1,
        packet_id: `DEMO-${String(sampleIndex * DEMO_DEVICES.length + deviceIndex + 1).padStart(4, "0")}`,
        device_id: device.deviceId,
        timestamp,
        temperature: Number((device.temperature + wave * 2.1 + quickWave * 0.35).toFixed(1)),
        humidity: Number((52 + deviceIndex * 6 - wave * 8 + quickWave * 1.5).toFixed(1)),
        rssi: Number((-77 + deviceIndex * 3 + wave * 5 + quickWave * 1.2).toFixed(1)),
        snr: Number((8 + deviceIndex * 1.5 + wave * 2.4 + quickWave * 0.6).toFixed(1)),
      }
    })
  }).flat()
}

function LoadingValue({ loading, children }: LoadingValueProps) {
  return loading ? <Skeleton className="h-8 w-24" /> : children
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  loading = false,
}: {
  icon: typeof Activity
  label: string
  value: ReactNode
  detail: ReactNode
  loading?: boolean
}) {
  return (
    <Card className="border-border/70 bg-card shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden="true" /></span>
        </div>
        <div className="mt-4 min-h-9 text-2xl font-semibold tracking-tight tabular-nums text-foreground sm:text-[1.7rem]">
          <LoadingValue loading={loading}>{value}</LoadingValue>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  )
}

function MetricChart({
  measurements,
  devices,
  metric,
  range,
  loading,
}: {
  measurements: Measurement[]
  devices: string[]
  metric: string
  range: Range
  loading: boolean
}) {
  const series = useMemo(() => devices.map((deviceId, index) => ({
    deviceId,
    key: `series_${index}`,
    color: DEVICE_COLORS[index % DEVICE_COLORS.length],
  })), [devices])
  const seriesByDevice = useMemo(() => new Map(series.map((item) => [item.deviceId, item])), [series])
  const points = useMemo(() => {
    const start = rangeStart(range)
    return measurements.flatMap((measurement) => {
      const timestamp = Date.parse(measurement.timestamp)
      const value = measurement[metric]
      const deviceSeries = seriesByDevice.get(measurement.device_id)
      return timestamp >= start && typeof value === "number" && Number.isFinite(value) && deviceSeries
        ? [{ timestamp, seriesKey: deviceSeries.key, value }]
        : []
    })
  }, [measurements, metric, range, seriesByDevice])
  const timeTicks = useMemo(() => {
    const timestamps = [...new Set(points.map((point) => point.timestamp))]
    if (timestamps.length <= 6) return timestamps
    return Array.from({ length: 6 }, (_, index) => timestamps[Math.round(index * (timestamps.length - 1) / 5)])
  }, [points])
  const plottedPoints = useMemo(() => {
    if (points.length <= 800) return points
    const bucketSize = Math.ceil(points.length / 400)
    const keep = new Set<number>()
    for (let start = 0; start < points.length; start += bucketSize) {
      const extrema = new Map<string, { min: number; max: number }>()
      const end = Math.min(start + bucketSize, points.length)
      for (let index = start; index < end; index += 1) {
        const point = points[index]
        const current = extrema.get(point.seriesKey)
        if (!current) extrema.set(point.seriesKey, { min: index, max: index })
        else {
          if (point.value < points[current.min].value) current.min = index
          if (point.value > points[current.max].value) current.max = index
        }
      }
      for (const value of extrema.values()) {
        keep.add(value.min)
        keep.add(value.max)
      }
    }
    return [...keep].sort((a, b) => a - b).map((index) => points[index])
  }, [points])
  const { min, max } = points.reduce((extent, point) => ({
    min: Math.min(extent.min, point.value),
    max: Math.max(extent.max, point.value),
  }), { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY })
  const safeMin = points.length ? min : 0
  const safeMax = points.length ? max : 0
  const pad = safeMax === safeMin ? Math.max(Math.abs(safeMax) * 0.08, 1) : (safeMax - safeMin) * 0.14
  const domain: [number, number] = [safeMin - pad, safeMax + pad]
  const chartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.deviceId, color: item.color }]))
  const formatChartDate = (value: unknown) => {
    const numericValue = typeof value === "number" ? value : Number(value)
    const date = new Date(numericValue)
    if (!Number.isFinite(numericValue) || Number.isNaN(date.getTime())) return "—"
    return formatTimestamp(date.toISOString())
  }
  const tickFormatter = (timestamp: number) => {
    const numericTimestamp = Number(timestamp)
    const date = new Date(numericTimestamp)
    if (!Number.isFinite(numericTimestamp) || Number.isNaN(date.getTime())) return "—"
    return range === "1h" || range === "6h" || range === "12h"
      ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit" }).format(date)
  }

  if (loading) return <div className="flex h-[300px] flex-col justify-end gap-3 pb-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-60 w-full" /></div>
  if (!points.length) {
    return <div className="flex h-[300px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 text-center">
      <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">No readings in this range</p>
      <p className="max-w-xs text-xs text-muted-foreground">No API readings for {metricLabel(metric).toLowerCase()} were found in the selected time window.</p>
    </div>
  }

  return <ChartContainer config={chartConfig} className="h-[300px] min-h-[300px] min-w-0 w-full">
    <LineChart width={800} height={300} data={plottedPoints} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
      <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={timeTicks} interval={0} allowDuplicatedCategory={false} tickFormatter={tickFormatter} minTickGap={48} tickLine={false} axisLine={false} tickMargin={10} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
      <YAxis domain={domain} tickLine={false} axisLine={false} width={52} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} />
      <ChartTooltip cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }} content={<ChartTooltipContent labelFormatter={(label) => formatChartDate(label)} formatter={(value, name) => [`${formatMetric(Number(value))}${metricUnit(metric) ? ` ${metricUnit(metric)}` : ""}`, series.find((item) => item.key === String(name))?.deviceId ?? String(name)]} />} />
      <Legend verticalAlign="top" align="left" height={32} formatter={(value) => series.find((item) => item.key === String(value))?.deviceId ?? String(value)} />
      {series.map((item) => <Line key={item.key} dataKey={(point: ChartPoint) => point.seriesKey === item.key ? point.value : undefined} name={item.key} type="monotone" stroke={item.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} connectNulls />)}
      {series.map((item) => {
        const latestValue = [...points].reverse().find((point) => point.seriesKey === item.key)?.value
        return latestValue === undefined ? null : <ReferenceLine key={`${item.key}-latest`} y={latestValue} stroke={item.color} strokeDasharray="3 5" strokeOpacity={0.2} />
      })}
    </LineChart>
  </ChartContainer>
}

export function TelemetryDashboard() {
  const [range, setRange] = useState<Range>("24h")
  const [page, setPage] = useState(1)
  const [tableQuery, setTableQuery] = useState("")
  const [newestFirst, setNewestFirst] = useState(true)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const demoMeasurements = useMemo(() => mounted ? createDemoMeasurements() : [], [mounted])
  const base = apiBaseUrl()
  const demoMode = !base
  const { data: measurements, error: measurementsError, isLoading: measurementsLoading, mutate: reloadMeasurements } = useSWR(
    base ? ["measurements", base] as const : null,
    () => fetchMeasurements(),
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
  const dashboardMeasurements = measurements ?? (demoMode ? demoMeasurements : [])
  const devices = useMemo(() => [...new Set(dashboardMeasurements.map((measurement) => measurement.device_id))].sort((a, b) => a.localeCompare(b)), [dashboardMeasurements])
  const { data: pdrResult, isLoading: pdrLoading, mutate: reloadPdr } = useSWR(
    base && devices.length ? ["pdr-all", devices] as const : null,
    ([, deviceIds]) => fetchPdrForDevices(deviceIds),
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
  const loading = measurementsLoading && !measurements
  const pdrRecords = pdrResult?.records ?? (demoMode && demoMeasurements.length ? DEMO_PDR : [])
  const pdrTotals = useMemo(() => pdrRecords.reduce((total, item) => ({
    received: total.received + item.received,
    expected: total.expected + item.expected,
    lost: total.lost + item.lost,
  }), { received: 0, expected: 0, lost: 0 }), [pdrRecords])
  const pdrValue = pdrRecords.length
    ? pdrTotals.expected > 0
      ? (pdrTotals.received / pdrTotals.expected) * 100
      : pdrRecords.reduce((sum, item) => sum + (pdrPercentage(item) ?? 0), 0) / pdrRecords.length
    : null
  const metrics = useMemo(() => getMeasurementMetrics(dashboardMeasurements), [dashboardMeasurements])
  const latestForMetric = (metric: string) => [...dashboardMeasurements].reverse().find((reading) => typeof reading[metric] === "number" && Number.isFinite(reading[metric]))
  const validReadings = useMemo(() => dashboardMeasurements.filter((reading) => {
    const query = tableQuery.trim().toLowerCase()
    return !query || Object.entries(reading).some(([key, value]) => `${key} ${value ?? ""}`.toLowerCase().includes(query))
  }), [dashboardMeasurements, tableQuery])
  const sortedReadings = useMemo(() => [...validReadings].sort((a, b) => (newestFirst ? -1 : 1) * (Date.parse(a.timestamp) - Date.parse(b.timestamp))), [validReadings, newestFirst])
  const pageCount = Math.max(1, Math.ceil(validReadings.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = sortedReadings.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const pdrHealthy = pdrValue !== null && pdrValue >= 95

  const downloadCsv = () => {
    if (!dashboardMeasurements.length) return
    const columns = Object.keys(dashboardMeasurements[0])
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
    const csv = [columns.map(escape).join(","), ...dashboardMeasurements.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\r\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = demoMode ? "demo-device-measurements.csv" : "all-device-measurements.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const refresh = () => {
    void reloadMeasurements()
    void reloadPdr()
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-indigo-100 bg-white text-slate-900 shadow-sm">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Activity className="size-5" aria-hidden="true" /></div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Temperature Monitor</p>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Device telemetry</h1>
              <p className="text-xs text-slate-300">All devices · {dashboardMeasurements.length.toLocaleString()} measurements</p>
            </div>
            <Badge variant="outline" className="ml-1 hidden gap-1.5 border-border bg-background text-muted-foreground sm:inline-flex"><span className={`size-1.5 rounded-full ${base ? "bg-primary" : "bg-amber-600"}`} />{base ? "Live API data" : "Simulated demo data"}</Badge>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={!base} aria-label="Refresh dashboard" title="Refresh dashboard"><RefreshCw className={`size-4 ${measurementsLoading || pdrLoading ? "animate-spin" : ""}`} aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-6 sm:px-6 lg:gap-6 lg:px-8 lg:py-8">
        {!base && <Alert className="border-amber-700/25 bg-amber-500/5">
          <AlertTriangle className="size-4 text-amber-400" aria-hidden="true" />
          <AlertTitle>Demo mode · these readings are simulated</AlertTitle>
          <AlertDescription>Charts and packet statistics below use illustrative values for three example devices, not live sensor data. Set <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">NEXT_PUBLIC_API_URL</code> to connect your FastAPI service.</AlertDescription>
        </Alert>}

        {measurementsError && base && <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Could not load measurements</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">{errorMessage(measurementsError)}<Button type="button" variant="outline" size="sm" onClick={() => void reloadMeasurements()}><RefreshCw data-icon="inline-start" />Retry request</Button></AlertDescription>
        </Alert>}

        <section aria-label="Latest telemetry and packet delivery" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(["temperature", "humidity", "rssi", "snr"] as const).map((key) => {
            const latest = latestForMetric(key)
            const unit = metricUnit(key)
            return <StatCard key={key} icon={key === "rssi" || key === "snr" ? Signal : Activity} label={`Latest ${metricLabel(key)}`} value={formatMetric(latest?.[key], unit ? ` ${unit}` : "")} detail={latest ? `${demoMode ? "Sample" : latest.device_id} · ${formatTimestamp(latest.timestamp)}` : !base ? "API not configured" : "No readings returned"} loading={loading} />
          })}
          <StatCard icon={Wifi} label="Packet delivery ratio" value={pdrValue !== null ? `${formatMetric(pdrValue)}%` : "—"} detail={pdrRecords.length ? `${pdrRecords.length} of ${devices.length} devices · ${formatMetric(pdrTotals.received)} received / ${formatMetric(pdrTotals.expected)} expected` : pdrLoading ? "Loading device packet stats" : base ? "No packet stats returned" : "API not configured"} loading={pdrLoading && !pdrResult && !!devices.length} />
        </section>

        {pdrResult?.errors.length ? <Alert className="border-amber-700/25 bg-amber-500/5">
          <AlertTriangle className="size-4 text-amber-400" aria-hidden="true" />
          <AlertTitle>Some packet delivery stats could not be loaded</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{pdrResult.errors.map((item) => `${item.deviceId}: ${item.message}`).join(" · ")}</span><Button type="button" variant="outline" size="sm" onClick={() => void reloadPdr()}><RefreshCw data-icon="inline-start" />Retry PDR</Button></AlertDescription>
        </Alert> : null}

        <section aria-label="Measurement trends" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" /><p className="text-xs font-medium uppercase tracking-[0.14em]">{demoMode ? "Illustrative sample series" : "Live signal history"}</p></div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Measurement trends</h2>
              <p className="mt-1 text-sm text-muted-foreground">Each device is shown as its own color-coded series.</p>
            </div>
            <div className="flex flex-wrap rounded-lg border border-border bg-card p-1" role="group" aria-label="Chart time range">
              {(["1h", "6h", "12h", "24h", "7d", "all"] as Range[]).map((value) => <Button key={value} type="button" variant={range === value ? "secondary" : "ghost"} size="sm" className="h-8 px-2.5 text-xs" aria-pressed={range === value} onClick={() => setRange(value)}>{value === "all" ? "All" : value}</Button>)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {metrics.length ? metrics.map((item) => {
              const latest = latestForMetric(item)
              return <Card key={item} className="border-border/70 shadow-none">
                <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
                  <div><CardTitle className="text-sm font-medium">{metricLabel(item)} vs time{metricUnit(item) ? ` · ${metricUnit(item)}` : ""}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{range === "all" ? "All available readings" : `Past ${range}`}</p></div>
                  {latest && <div className="text-right"><p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Latest value</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatMetric(latest[item], metricUnit(item) ? ` ${metricUnit(item)}` : "")}</p><p className="text-xs text-muted-foreground">{latest.device_id}</p></div>}
                </CardHeader>
                <CardContent className="pt-2"><MetricChart measurements={dashboardMeasurements} devices={devices} metric={item} range={range} loading={loading} /></CardContent>
              </Card>
            }) : <Card className="border-border/70 shadow-none xl:col-span-2"><CardContent className="flex min-h-[340px] flex-col items-center justify-center gap-2 text-center">
              {loading ? <><Skeleton className="h-5 w-40" /><Skeleton className="mt-3 h-56 w-full" /></> : <><span className="flex size-10 items-center justify-center rounded-full bg-muted"><Activity className="size-5 text-muted-foreground" aria-hidden="true" /></span><p className="mt-2 text-sm font-medium">{dashboardMeasurements.length ? "No sensor metrics available" : "No telemetry yet"}</p><p className="max-w-md text-xs text-muted-foreground">{!base ? "Connect the FastAPI service to load live sensor trends." : measurements?.length ? "The API has not returned temperature, humidity, RSSI, or SNR readings." : "The API has not returned any measurement records."}</p></>}
            </CardContent></Card>}
          </div>
        </section>

        {pdrRecords.length > 0 && <section aria-label="Packet delivery by device" className="flex flex-col gap-3">
          <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Network quality</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Packet delivery by device</h2><p className="mt-1 text-sm text-muted-foreground">{demoMode ? "Example delivery rates for the three sample devices." : "Individual PDR responses from the FastAPI endpoint."}</p></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pdrRecords.map((item) => {
              const percentage = pdrPercentage(item)
              const healthy = percentage !== null && percentage >= 95
              return <Card key={item.device_id} className="border-border/70 shadow-none"><CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.device_id}</p><p className="mt-1 text-xs text-muted-foreground">{formatMetric(item.received)} received · {formatMetric(item.expected)} expected · {formatMetric(item.lost)} lost</p></div>
                <div className="shrink-0 text-right"><p className="text-xl font-semibold tabular-nums">{percentage !== null ? `${formatMetric(percentage)}%` : "—"}</p><Badge variant="outline" className={healthy ? "border-primary/25 bg-primary/10 text-primary" : "border-amber-300/30 bg-amber-300/10 text-amber-300"}>{healthy ? "Healthy" : "Needs attention"}</Badge></div>
              </CardContent></Card>
            })}
          </div>
        </section>}

        <section aria-label="Measurement records" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Data explorer</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Recent measurements</h2><p className="mt-1 text-sm text-muted-foreground">{validReadings.length ? `${validReadings.length.toLocaleString()} records across ${devices.length.toLocaleString()} devices` : "All device measurements"}</p></div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative sm:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search measurements" placeholder="Filter records" value={tableQuery} onChange={(event) => { setTableQuery(event.target.value); setPage(1) }} className="pl-9" /></div>
              <Button type="button" variant="outline" size="sm" disabled={!dashboardMeasurements.length} onClick={downloadCsv}><Download data-icon="inline-start" />Export CSV</Button>
            </div>
          </div>
          <Card className="overflow-hidden border-border/70 shadow-none">
            <div className="overflow-x-auto">
              <Table className="min-w-[920px]">
                <TableHeader className="bg-muted/40 text-muted-foreground"><TableRow>
                  <TableHead scope="col" aria-sort={newestFirst ? "descending" : "ascending"} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.13em]"><button type="button" className="inline-flex items-center gap-2" onClick={() => setNewestFirst((current) => !current)}>Timestamp<ArrowDown className={`size-3 transition-transform ${newestFirst ? "" : "rotate-180"}`} aria-hidden="true" /><span className="sr-only">Toggle timestamp sort order</span></button></TableHead>
                  <TableHead scope="col" className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.13em]">Packet ID</TableHead>
                  <TableHead scope="col" className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.13em]">Device ID</TableHead>
                  <TableHead scope="col" className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.13em]">Temperature</TableHead>
                  <TableHead scope="col" className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.13em]">Humidity</TableHead>
                  <TableHead scope="col" className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.13em]">RSSI</TableHead>
                  <TableHead scope="col" className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.13em]">SNR</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? Array.from({ length: 5 }, (_, row) => <TableRow key={row}>{Array.from({ length: 7 }, (_, column) => <TableCell key={column} className="px-4 py-4"><Skeleton className={`h-4 ${column === 0 ? "w-36" : "ml-auto w-14"}`} /></TableCell>)}</TableRow>) : pageRows.map((reading) => <TableRow key={`${reading.device_id}-${reading.id}-${reading.timestamp}`}><TableCell className="whitespace-nowrap px-4 py-3.5 text-xs text-muted-foreground">{formatTimestamp(reading.timestamp)}</TableCell><TableCell className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">{reading.packet_id ?? "—"}</TableCell><TableCell className="px-4 py-3.5 text-xs">{reading.device_id}</TableCell><TableCell className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">{formatMetric(reading.temperature, " °C")}</TableCell><TableCell className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">{formatMetric(reading.humidity, " %")}</TableCell><TableCell className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">{formatMetric(reading.rssi, " dBm")}</TableCell><TableCell className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">{formatMetric(reading.snr, " dB")}</TableCell></TableRow>)}
                  {!loading && !measurementsError && pageRows.length === 0 && <TableRow><TableCell colSpan={7} className="px-4 py-12 text-center"><div className="mx-auto flex max-w-sm flex-col items-center gap-2"><Activity className="size-5 text-muted-foreground" aria-hidden="true" /><p className="text-sm font-medium">{dashboardMeasurements.length ? "No matching records" : !base ? "API not configured" : "No measurements yet"}</p><p className="text-xs text-muted-foreground">{measurements?.length ? "Try a different filter." : !base ? "Connect the FastAPI service to load measurements." : "The API has not returned any measurement records."}</p></div></TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">{validReadings.length ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, validReadings.length)} of ${validReadings.length}` : "No rows to display"}</p>
              <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={currentPage <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft data-icon="inline-start" />Previous</Button><span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">{currentPage} / {pageCount}</span><Button type="button" variant="outline" size="sm" disabled={currentPage >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next<ChevronRight data-icon="inline-end" /></Button></div>
            </div>
          </Card>
        </section>

        <footer className="flex flex-col gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${base ? "bg-primary" : "bg-amber-600"}`} />{base ? "Connected to telemetry API" : "Showing illustrative demo data · API not connected"}</span><span className="flex items-center gap-2"><ArrowDown className="size-3" aria-hidden="true" />Newest records are listed first</span></footer>
      </div>
    </main>
  )
}

export default TelemetryDashboard
