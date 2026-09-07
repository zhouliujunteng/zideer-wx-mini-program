function now() {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.getPerformance === 'function') {
      const clock = wx.getPerformance()
      if (clock && typeof clock.now === 'function') {
        const value = clock.now()
        if (Number.isFinite(value)) return value
      }
    }
  } catch (error) {}
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      const value = performance.now()
      if (Number.isFinite(value)) return value
    }
  } catch (error) {}
  return Date.now()
}

function createFrameLatencyTracker(recordLatency) {
  let requestedAt = null

  function request(timestamp, active) {
    const value = Number(timestamp)
    requestedAt = active && Number.isFinite(value) ? value : null
    return requestedAt !== null
  }

  function finish(timestamp) {
    const value = Number(timestamp)
    if (!Number.isFinite(requestedAt) || !Number.isFinite(value)) {
      requestedAt = null
      return false
    }
    const latency = Math.max(0, value - requestedAt)
    requestedAt = null
    if (typeof recordLatency === 'function') recordLatency(latency)
    return latency
  }

  function reset() {
    requestedAt = null
  }

  return { request, finish, reset }
}

function createPerfMetrics(options) {
  const config = options || {}
  const requestedCapacity = Number(config.capacity)
  const capacity = Number.isFinite(requestedCapacity) && requestedCapacity > 0
    ? Math.floor(requestedCapacity)
    : 120
  const metrics = Object.create(null)

  function getMetric(name, create) {
    const key = String(name)
    if (!metrics[key] && create) {
      metrics[key] = { count: 0, samples: new Array(capacity), size: 0, cursor: 0 }
    }
    return metrics[key]
  }

  function record(name, duration) {
    const value = Number(duration)
    if (!Number.isFinite(value) || value < 0) return false
    const metric = getMetric(name, true)
    metric.samples[metric.cursor] = value
    metric.cursor = (metric.cursor + 1) % capacity
    metric.size = Math.min(metric.size + 1, capacity)
    metric.count += 1
    return value
  }

  function increment(name, count = 1) {
    const value = Number(count)
    if (!Number.isFinite(value)) return false
    const metric = getMetric(name, true)
    metric.count += value
    return metric.count
  }

  function count(name) {
    const metric = getMetric(name, false)
    return metric ? metric.count : 0
  }

  function percentile(sorted, ratio) {
    return sorted[Math.ceil(sorted.length * ratio) - 1]
  }

  function median(sorted) {
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }

  function summary(name) {
    const metric = getMetric(name, false)
    const total = metric ? metric.count : 0
    if (!metric || !metric.size) {
      return { count: total, min: null, median: null, p95: null, max: null, over16: 0, over33: 0 }
    }
    const samples = metric.samples.slice(0, metric.size).sort((a, b) => a - b)
    return {
      count: total,
      min: samples[0],
      median: median(samples),
      p95: percentile(samples, 0.95),
      max: samples[samples.length - 1],
      over16: samples.filter((value) => value > 16.7).length,
      over33: samples.filter((value) => value > 33.3).length
    }
  }

  function reset() {
    Object.keys(metrics).forEach((name) => delete metrics[name])
  }

  return { now, record, increment, summary, count, reset }
}

module.exports = { now, createFrameLatencyTracker, createPerfMetrics }
