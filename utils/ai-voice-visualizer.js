const SUPPORTED_VOICE_STATES = Object.freeze([
  'idle',
  'requesting-permission',
  'recording',
  'transcribing',
  'thinking',
  'speaking',
  'interrupted',
  'paused',
  'failed',
  'permission-denied'
])

const STATE_VISUAL_TARGETS = Object.freeze({
  idle: { pace: 0.34, radius: 0.88, deformation: 0.08, energy: 0.12, glow: 0.28 },
  'requesting-permission': { pace: 0.44, radius: 0.9, deformation: 0.09, energy: 0.16, glow: 0.34 },
  recording: { pace: 0.72, radius: 0.94, deformation: 0.16, energy: 0.32, glow: 0.48 },
  transcribing: { pace: 0.92, radius: 0.92, deformation: 0.14, energy: 0.28, glow: 0.45 },
  thinking: { pace: 1.14, radius: 0.9, deformation: 0.2, energy: 0.38, glow: 0.55 },
  speaking: { pace: 1.34, radius: 0.98, deformation: 0.24, energy: 0.58, glow: 0.7 },
  interrupted: { pace: 0.24, radius: 0.84, deformation: 0.07, energy: 0.08, glow: 0.22 },
  paused: { pace: 0.2, radius: 0.85, deformation: 0.06, energy: 0.06, glow: 0.2 },
  failed: { pace: 0.26, radius: 0.83, deformation: 0.08, energy: 0.08, glow: 0.2 },
  'permission-denied': { pace: 0.2, radius: 0.84, deformation: 0.06, energy: 0.05, glow: 0.18 }
})

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

/** Distinguishes an invalid recorder payload from a valid silent PCM frame. */
function analyzePcm16LeFrame(arrayBuffer) {
  const view = getPcm16LeView(arrayBuffer, true)
  if (!view) return { valid: false, rms: 0, sampleCount: 0 }
  return {
    valid: true,
    rms: calculateRmsFromView(view),
    sampleCount: view.byteLength / 2
  }
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
  const floor = 0.0008
  const peakTarget = Math.max(0.012, safeRms * 1.65)
  const peak = smoothLevel(previousPeak, peakTarget, 0.45, 0.012)
  const fixedGainLevel = normalizeMicrophoneLevel(safeRms)
  const adaptiveLevel = clamp((safeRms - floor) / Math.max(peak - floor, 0.002), 0, 1)
  // Fixed gain keeps absolute silence quiet; adaptive gain preserves movement on
  // low-output devices. A sub-linear curve emphasizes normal speech changes.
  const target = Math.pow(Math.max(fixedGainLevel, adaptiveLevel * 0.86), 0.72)
  return {
    peak,
    level: smoothLevel(previousLevel, target, 0.72, 0.13)
  }
}

const VOICE_ACTIVITY_BAR_WEIGHTS = Object.freeze([0.72, 0.9, 1, 0.9, 0.72])

/** Maps one RMS envelope to five calm, monotonic activity bars. */
function createVoiceActivityBars(level) {
  const safeLevel = clamp(level, 0, 1)
  // Keep quiet speech visible on the small five-bar indicator. The envelope is
  // still bounded by the caller's normalized PCM level, but responds sooner so
  // a real voice does not look like a nearly static status marker.
  const envelope = Math.pow(safeLevel, 0.56)
  return VOICE_ACTIVITY_BAR_WEIGHTS.map((weight, index) => ({
    id: index,
    height: Math.round(8 + envelope * 42 * weight),
    opacity: Math.round((0.3 + envelope * 0.7) * 100) / 100
  }))
}

/** Keeps microphone response visible without letting the Aura over-deform. */
function getAuraMotion(energy, stateDeformation, oscillation) {
  const safeEnergy = clamp(energy, 0, 1)
  const safeOscillation = clamp(oscillation, -1, 1)
  return {
    pulse: clamp(
      1 + safeEnergy * 0.085 + safeOscillation * (0.01 + safeEnergy * 0.014),
      0.98,
      1.11
    ),
    paceMultiplier: 1 + safeEnergy * 0.32,
    deformation: clamp(
      clamp(stateDeformation, 0, 1) * 0.62 + safeEnergy * 0.2,
      0,
      0.3
    )
  }
}

function getStateVisualTarget(state) {
  const target = STATE_VISUAL_TARGETS[state] || STATE_VISUAL_TARGETS.idle
  return { ...target }
}

function getSeedNumber(seed) {
  if (Number.isFinite(Number(seed))) return Number(seed)
  return String(seed || '').split('').reduce(
    (value, character) => ((value * 31) + character.charCodeAt(0)) % 997,
    17
  )
}

/**
 * Produces deterministic motion for the debug-only AI speaking preview.
 * This is deliberately not derived from audio and must never be presented as
 * playback or TTS output.
 */
function getDemoSpeakingLevel(elapsedMs, seed = 0) {
  const time = Math.max(0, Number(elapsedMs) || 0) / 1000
  const phase = getSeedNumber(seed) * 0.173
  const slow = (Math.sin(time * 3.7 + phase) + 1) / 2
  const medium = (Math.sin(time * 8.9 + phase * 0.61) + 1) / 2
  const quick = (Math.sin(time * 15.3 + phase * 1.37) + 1) / 2
  return clamp(0.16 + slow * 0.34 + medium * 0.25 + quick * 0.17, 0, 1)
}

module.exports = {
  SUPPORTED_VOICE_STATES,
  clamp,
  calculatePcm16LeRms,
  analyzePcm16LeFrame,
  normalizeMicrophoneLevel,
  smoothLevel,
  updateMicrophoneEnvelope,
  createVoiceActivityBars,
  getAuraMotion,
  getStateVisualTarget,
  getDemoSpeakingLevel
}
