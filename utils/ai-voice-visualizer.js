function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

/**
 * Computes RMS from raw signed 16-bit little-endian PCM.
 *
 * Recorder frames must only be passed here after the caller has confirmed that
 * the recorder is producing PCM rather than MP3/AAC. The function intentionally
 * ignores an odd trailing byte and never retains the supplied audio buffer.
 */
function getPcm16LeView(arrayBuffer, requireCompleteSamples) {
  // Native ArrayBuffers can cross the Mini Program bridge with a different
  // JavaScript realm/prototype, so `instanceof ArrayBuffer` alone is too strict.
  const isArrayBuffer = typeof ArrayBuffer !== 'undefined' && (
    arrayBuffer instanceof ArrayBuffer ||
    Object.prototype.toString.call(arrayBuffer) === '[object ArrayBuffer]'
  )
  if (
    !isArrayBuffer ||
    arrayBuffer.byteLength < 2 ||
    (requireCompleteSamples && arrayBuffer.byteLength % 2 !== 0)
  ) return null

  try {
    return new DataView(arrayBuffer)
  } catch (error) {
    return null
  }
}

function calculateRmsFromView(view) {
  const sampleCount = Math.floor(view.byteLength / 2)
  if (!sampleCount) return 0

  let sumOfSquares = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 32768
    sumOfSquares += sample * sample
  }
  return clamp(Math.sqrt(sumOfSquares / sampleCount), 0, 1)
}

function calculatePcm16LeRms(arrayBuffer) {
  const view = getPcm16LeView(arrayBuffer, false)
  return view ? calculateRmsFromView(view) : 0
}

// 分频范围：人声的基频与主要共振峰都在这里面；更高的频段说话时也几乎没有能量，画出来只是一排矮条
const BAND_MIN_HZ = 120
const BAND_MAX_HZ = 4000
const FFT_MIN_SIZE = 64
const FFT_MAX_SIZE = 2048

// 原地基 2 FFT（re/im 长度须为 2 的幂）
function fftInPlace(re, im) {
  const size = re.length
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length
    const stepRe = Math.cos(angle)
    const stepIm = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < length / 2; k += 1) {
        const a = start + k
        const b = a + length / 2
        const tRe = re[b] * wRe - im[b] * wIm
        const tIm = re[b] * wIm + im[b] * wRe
        re[b] = re[a] - tRe; im[b] = im[a] - tIm
        re[a] += tRe; im[a] += tIm
        const nextRe = wRe * stepRe - wIm * stepIm
        wIm = wRe * stepIm + wIm * stepRe
        wRe = nextRe
      }
    }
  }
}

/**
 * 一帧 PCM 的频谱形状：取帧末尾最长 2 的幂个采样，加汉宁窗做 FFT，
 * 把 120Hz–4kHz 按对数间隔切成 bandCount 段，每段取幅度均方根，再除以本帧最强的一段 → [0, 1]。
 * 只描述「这一帧的声音长什么样」，不含响度：响度看 rms，由调用方做自动增益后再乘上去。
 * 帧太短或整帧全零时返回全 0。
 */
function spectrumBands(view, sampleCount, bandCount, sampleRate) {
  const bands = Array.from({ length: bandCount }, () => 0)
  if (sampleCount < FFT_MIN_SIZE) return bands
  let size = FFT_MIN_SIZE
  while (size * 2 <= Math.min(sampleCount, FFT_MAX_SIZE)) size *= 2
  const offset = sampleCount - size
  const re = new Array(size)
  const im = new Array(size)
  for (let index = 0; index < size; index += 1) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1))
    re[index] = view.getInt16((offset + index) * 2, true) / 32768 * hann
    im[index] = 0
  }
  fftInPlace(re, im)
  const binHz = sampleRate / size
  const lastBin = size / 2 - 1
  const ratio = BAND_MAX_HZ / BAND_MIN_HZ
  let strongest = 0
  for (let band = 0; band < bandCount; band += 1) {
    const lowHz = BAND_MIN_HZ * Math.pow(ratio, band / bandCount)
    const highHz = BAND_MIN_HZ * Math.pow(ratio, (band + 1) / bandCount)
    const lowBin = Math.min(lastBin, Math.max(1, Math.round(lowHz / binHz)))
    const highBin = Math.min(lastBin, Math.max(lowBin, Math.round(highHz / binHz) - 1))
    let power = 0
    for (let bin = lowBin; bin <= highBin; bin += 1) power += re[bin] * re[bin] + im[bin] * im[bin]
    bands[band] = Math.sqrt(power / (highBin - lowBin + 1))
    if (bands[band] > strongest) strongest = bands[band]
  }
  return strongest > 0 ? bands.map((value) => value / strongest) : bands
}

/**
 * Distinguishes an invalid recorder payload from a valid silent PCM frame.
 * options.bandCount > 0 时另给 bands（频谱形状，见 spectrumBands）；options.sampleRate 默认 16000。
 */
function analyzePcm16LeFrame(arrayBuffer, options = {}) {
  const view = getPcm16LeView(arrayBuffer, true)
  if (!view) return { valid: false, rms: 0, sampleCount: 0 }
  const sampleCount = view.byteLength / 2
  const result = {
    valid: true,
    rms: calculateRmsFromView(view),
    sampleCount
  }
  const bandCount = Math.floor(Number(options.bandCount) || 0)
  if (bandCount > 0) result.bands = spectrumBands(view, sampleCount, bandCount, Number(options.sampleRate) || 16000)
  return result
}

/** Maps raw RMS above the room noise floor onto a stable [0, 1] energy value. */
function normalizeMicrophoneLevel(rms, options = {}) {
  // Mobile microphone PCM can be much quieter than desktop test fixtures. These
  // defaults make ordinary speech around -50…-25 dBFS visible while retaining a
  // small floor for room/electrical noise. They are visual calibration values,
  // not a sound-pressure or decibel measurement.
  const noiseFloor = clamp(
    options.noiseFloor === undefined ? 0.001 : options.noiseFloor,
    0,
    0.99
  )
  const ceiling = clamp(
    options.ceiling === undefined ? 0.08 : options.ceiling,
    noiseFloor + 0.001,
    1
  )
  const linear = clamp((Number(rms) - noiseFloor) / (ceiling - noiseFloor), 0, 1)
  // A gentle square-root curve keeps normal speech visible without making room
  // noise look like speech.
  return Math.sqrt(linear)
}

/** Uses fast attack and slower release so the visualizer feels responsive. */
function smoothLevel(previous, target, attack = 0.58, release = 0.16) {
  const safePrevious = clamp(previous, 0, 1)
  const safeTarget = clamp(target, 0, 1)
  const factor = safeTarget > safePrevious
    ? clamp(attack, 0, 1)
    : clamp(release, 0, 1)
  return clamp(safePrevious + (safeTarget - safePrevious) * factor, 0, 1)
}

/**
 * Converts an RMS frame into a responsive visual envelope.
 *
 * `peak` follows louder frames and decays slowly, providing automatic gain for
 * different microphones. The returned scalar is the only derived audio value
 * the page needs to retain; raw frames remain disposable.
 */
function updateMicrophoneEnvelope(previousLevel, previousPeak, rms) {
  const safeRms = clamp(rms, 0, 1)
  const peakTarget = Math.max(0.012, safeRms * 1.65)
  const peak = smoothLevel(previousPeak, peakTarget, 0.45, 0.012)
  return {
    peak,
    level: smoothLevel(previousLevel, microphoneTargetLevel(safeRms, peak), 0.72, 0.13)
  }
}

/**
 * 这一帧的目标响度（未平滑）：固定增益与按 peak 的自适应增益取大。
 * updateMicrophoneEnvelope 在它上面做慢回落；录音电平条要跟着一个个字起伏，直接用它再自己做快一些的平滑。
 */
function microphoneTargetLevel(rms, peak) {
  const safeRms = clamp(rms, 0, 1)
  const floor = 0.0008
  const fixedGainLevel = normalizeMicrophoneLevel(safeRms)
  const adaptiveLevel = clamp((safeRms - floor) / Math.max(clamp(peak, 0, 1) - floor, 0.002), 0, 1)
  // Fixed gain keeps absolute silence quiet; adaptive gain preserves movement on
  // low-output devices. A sub-linear curve emphasizes normal speech changes.
  return Math.pow(Math.max(fixedGainLevel, adaptiveLevel * 0.86), 0.72)
}

module.exports = {
  clamp,
  calculatePcm16LeRms,
  analyzePcm16LeFrame,
  normalizeMicrophoneLevel,
  smoothLevel,
  updateMicrophoneEnvelope,
  microphoneTargetLevel
}
