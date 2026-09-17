/**
 * 增量 UTF-8 解码 + SSE 帧解析，供 wx.request enableChunked 的 onChunkReceived 使用。
 *
 * 小程序基础库没有保证可用的 TextDecoder，所以手写增量解码：分块可能把
 * 一个多字节字符或一帧 SSE 拆开，未完成的字节/文本必须跨 chunk 保留。
 * 纯 Node 可运行，便于 node --test 单测。
 */

/**
 * 解码一段完整或前缀的 UTF-8 字节序列。
 * 返回 {text, remainder}：remainder 是尾部不完整序列的原始字节，
 * 调用方将其与下一批 chunk 拼接后再次调用。
 */
function utf8Decode(input) {
  let out = ''
  let i = 0
  const n = input.length
  while (i < n) {
    const b = input[i]
    let codePoint
    let size
    if (b < 0x80) {
      codePoint = b
      size = 1
    } else if (b >= 0xc2 && b < 0xe0) {
      codePoint = b & 0x1f
      size = 2
    } else if (b >= 0xe0 && b < 0xf0) {
      codePoint = b & 0x0f
      size = 3
    } else if (b >= 0xf0 && b < 0xf5) {
      codePoint = b & 0x07
      size = 4
    } else {
      // 无效前导字节按 U+FFFD 顶替，保证前进不死循环。
      out += '\uFFFD'
      i += 1
      continue
    }
    if (i + size > n) break
    let valid = true
    for (let j = 1; j < size; j += 1) {
      const cont = input[i + j]
      if ((cont & 0xc0) !== 0x80) {
        valid = false
        break
      }
      codePoint = (codePoint << 6) | (cont & 0x3f)
    }
    if (!valid) {
      out += '\uFFFD'
      i += 1
      continue
    }
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      out += '\uFFFD'
    } else if (codePoint <= 0xffff) {
      out += String.fromCharCode(codePoint)
    } else {
      const adjusted = codePoint - 0x10000
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff))
    }
    i += size
  }
  return { text: out, remainder: input.slice(i) }
}

/**
 * 解析文本缓冲里的完整 SSE 帧，返回 {frames, rest}。
 * 帧以空行分隔；忽略冒号开头的注释/心跳行；多行 data 按 SSE 规范以 \n 拼接。
 */
function parseSseBuffer(buffer) {
  const frames = []
  let rest = buffer.replace(/\r\n/g, '\n')
  for (;;) {
    const boundary = rest.indexOf('\n\n')
    if (boundary < 0) break
    const block = rest.slice(0, boundary)
    rest = rest.slice(boundary + 2)
    const frame = parseSseBlock(block)
    if (frame) frames.push(frame)
  }
  return { frames, rest }
}

function parseSseBlock(block) {
  let id = ''
  let event = ''
  const dataLines = []
  for (const rawLine of block.split('\n')) {
    if (!rawLine || rawLine.charAt(0) === ':') continue
    const colon = rawLine.indexOf(':')
    const field = colon < 0 ? rawLine : rawLine.slice(0, colon)
    let value = colon < 0 ? '' : rawLine.slice(colon + 1)
    if (value.charAt(0) === ' ') value = value.slice(1)
    if (field === 'id') id = value
    else if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length && !event) return null
  const data = dataLines.join('\n')
  let parsed = data
  if (dataLines.length === 1 && data) {
    try {
      parsed = JSON.parse(data)
    } catch {
      parsed = data
    }
  }
  return { id, event, data: parsed }
}

/**
 * 组合解码与解析：feed(arrayBuffer) 返回本次落地的完整帧数组，
 * 调用方自行分发（不回调，方便单测断言）。finish() 收尾冲刷。
 */
function createAgentSseStream() {
  let pendingBytes = []
  let buffer = ''

  function feed(arrayBuffer) {
    const incoming = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)
    const merged = pendingBytes.concat(Array.from(incoming))
    const decoded = utf8Decode(merged)
    pendingBytes = Array.from(decoded.remainder)
    buffer += decoded.text
    const { frames, rest } = parseSseBuffer(buffer)
    buffer = rest
    return frames
  }

  function finish() {
    const decoded = utf8Decode(pendingBytes)
    pendingBytes = []
    buffer += decoded.text
    const { frames } = parseSseBuffer(`${buffer}\n\n`)
    buffer = ''
    return frames
  }

  return { feed, finish }
}

module.exports = { utf8Decode, parseSseBuffer, createAgentSseStream }
