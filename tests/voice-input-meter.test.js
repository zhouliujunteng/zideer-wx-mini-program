// 按住说话时那排电平条：真机上一收到录音帧就改用实测电平画。
// 2026-10-03 前分频（bands）从没实现过，页面却按「有分频」去画：开发者工具里收不到录音帧、一直是合成动效，
// 真机上第一帧一到，42 根条全部趴平——「按下去有动效，一说话反而不动了」。这里用合成的 PCM 把这件事钉住。
const test = require('node:test')
const assert = require('node:assert/strict')

const { analyzePcm16LeFrame } = require('../utils/ai-voice-visualizer')
const { createPcmLevelMeter, createVoiceBars } = require('../utils/voice-input')

const SAMPLE_RATE = 16000
const FRAME = 1024 // frameSize: 2（KB）= 1024 个 16 位采样

// 合成一帧：speech = 220Hz 基频带谐波和共振峰；noise = 白噪声。按目标 RMS 缩放成 PCM16LE。
function pcmFrame(kind, rms, offset = 0, seed = 1) {
  let random = seed
  const next = () => { random = (random * 16807) % 2147483647; return random / 2147483647 * 2 - 1 }
  const samples = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i += 1) {
    const t = (offset + i) / SAMPLE_RATE
    let value = 0
    if (kind === 'speech') {
      for (let h = 1; h <= 16; h += 1) {
        const f = 220 * h
        const formant = Math.exp(-Math.pow((f - 600) / 300, 2)) + 0.6 * Math.exp(-Math.pow((f - 1700) / 400, 2))
        value += formant / Math.sqrt(h) * Math.sin(2 * Math.PI * f * t + h)
      }
      value += 0.03 * next()
    } else {
      value = next()
    }
    samples[i] = value
  }
  const current = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / FRAME)
  const buffer = new ArrayBuffer(FRAME * 2)
  const view = new DataView(buffer)
  samples.forEach((value, i) => view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(value / current * rms * 32768))), true))
  return buffer
}

function feed(meter, kind, rms, frames) {
  for (let i = 0; i < frames; i += 1) meter.process(pcmFrame(kind, rms, i * FRAME, i + 7), 1000 + i * 64)
  return createVoiceBars(meter.getSnapshot(1000 + frames * 64).barLevels).map((bar) => bar.height)
}

const tallest = (heights) => Math.max(...heights)

test('a PCM frame comes back with its spectrum shape when bands are asked for', () => {
  const analysis = analyzePcm16LeFrame(pcmFrame('speech', 0.03), { bandCount: 21, sampleRate: SAMPLE_RATE })
  assert.equal(analysis.valid, true)
  assert.equal(analysis.bands.length, 21, '页面按 bands 画条：没有它条就全趴平')
  assert.ok(analysis.bands.every((value) => value >= 0 && value <= 1))
  assert.equal(Math.max(...analysis.bands), 1, '按本帧最强的一段归一')
  // 没要分频时不白算
  assert.equal(analyzePcm16LeFrame(pcmFrame('speech', 0.03)).bands, undefined)
  // 整帧全零：形状全 0，不出 NaN
  assert.deepEqual(analyzePcm16LeFrame(new ArrayBuffer(FRAME * 2), { bandCount: 4 }).bands, [0, 0, 0, 0])
})

test('speaking makes the bars rise, and louder speech makes them taller', () => {
  const normal = feed(createPcmLevelMeter(), 'speech', 0.01, 12)
  const loud = feed(createPcmLevelMeter(), 'speech', 0.1, 12)
  assert.equal(normal.length, 42)
  assert.ok(tallest(normal) >= 20, `正常说话中间应明显升起，实际最高 ${tallest(normal)}`)
  assert.ok(tallest(loud) > tallest(normal), '大声说话更高')
  assert.ok(tallest(loud) <= 54, '不超过设计上限')
  // 中间高、两边低，像一道声波
  assert.ok(normal[20] > normal[0] && normal[21] > normal[41])
})

test('a quiet room keeps the bars down', () => {
  assert.ok(tallest(feed(createPcmLevelMeter(), 'noise', 0.001, 12)) <= 5, '约 -60 dBFS 的安静房间，条趴着不动')
  assert.ok(tallest(feed(createPcmLevelMeter(), 'noise', 0.003, 12)) < tallest(feed(createPcmLevelMeter(), 'speech', 0.01, 12)), '底噪明显低于说话')
})

test('the bars follow each word instead of hanging after it', () => {
  const meter = createPcmLevelMeter()
  const speaking = tallest(feed(meter, 'speech', 0.03, 4))
  const paused = tallest(feed(meter, 'noise', 0.001, 4))
  assert.ok(paused < speaking / 2, `一个字说完约 0.25 秒内应明显落下（说话 ${speaking}，停顿 ${paused}）`)
})

test('the meter reports every frame to the page that asked (the diagnosis room tracks the microphone with it)', () => {
  const seen = []
  const meter = createPcmLevelMeter((snapshot) => seen.push(snapshot))
  assert.equal(meter.process(pcmFrame('speech', 0.03), 500), true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].lastFrameAt, 500)
  assert.equal(seen[0].barLevels.length, 42)
  assert.equal(meter.process(new ArrayBuffer(3)), false, '不是完整 PCM 的帧不算')
})
