const assert = require('node:assert/strict')
const test = require('node:test')

const { utf8Decode, parseSseBuffer, createAgentSseStream } = require('../utils/agent-sse')

function bytesOf(text) {
  return Array.from(Buffer.from(text, 'utf8'))
}

test('utf8Decode decodes complete ASCII and multibyte sequences', () => {
  const decoded = utf8Decode(bytesOf('分数加减 abc'))
  assert.equal(decoded.text, '分数加减 abc')
  assert.equal(decoded.remainder.length, 0)
})

test('utf8Decode keeps an incomplete multibyte tail as remainder', () => {
  const full = bytesOf('「通分」')
  const cut = full.slice(0, full.length - 1)
  const decoded = utf8Decode(cut)
  assert.equal(decoded.text, '「通分')
  assert.equal(decoded.remainder.length, 2)
  const healed = utf8Decode(decoded.remainder.concat(full.slice(full.length - 1)))
  assert.equal(healed.text, '」')
})

test('utf8Decode replaces invalid lead bytes instead of looping', () => {
  const decoded = utf8Decode([0xff, 0x41])
  assert.equal(decoded.text, '\uFFFDA')
})

test('parseSseBuffer splits frames on blank lines and parses JSON data', () => {
  const wire = [
    'id: 7',
    'event: tool_execution_start',
    'data: {"type":"tool_execution_start","data":{"toolName":"web_search"}}',
    '',
    ': heartbeat comment',
    '',
    'id: 8',
    'event: caught_up',
    'data: {"type":"caught_up","replayed":2}',
    '',
  ].join('\n') + '\n'
  const { frames, rest } = parseSseBuffer(wire)
  assert.equal(frames.length, 2)
  assert.equal(frames[0].id, '7')
  assert.equal(frames[0].event, 'tool_execution_start')
  assert.deepEqual(frames[0].data.data, { toolName: 'web_search' })
  assert.equal(frames[1].event, 'caught_up')
  assert.equal(frames[1].data.replayed, 2)
  assert.equal(rest, '')
})

test('parseSseBuffer keeps a trailing partial frame as rest', () => {
  const wire = 'id: 1\nevent: trace\ndata: {"a":1}\n\nevent: mess'
  const { frames, rest } = parseSseBuffer(wire)
  assert.equal(frames.length, 1)
  assert.equal(rest, 'event: mess')
})

test('parseSseBuffer joins multi-line data and tolerates CRLF', () => {
  const wire = 'event: notice\r\ndata: line1\r\ndata: line2\r\n\r\n'
  const { frames } = parseSseBuffer(wire)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].event, 'notice')
  // 多行 data 且无法整体 JSON.parse 时保留原始拼接文本
  assert.equal(frames[0].data, 'line1\nline2')
})

test('createAgentSseStream reassembles frames split across chunk boundaries', () => {
  const stream = createAgentSseStream()
  const wire = 'id: 3\nevent: user_message\ndata: {"data":{"text":"帮我做一节数学课"}}\n\n'
  const bytes = bytesOf(wire)
  // 逐字节喂入：最极端的切分方式
  const collected = []
  for (const byte of bytes) {
    collected.push(...stream.feed(new Uint8Array([byte])))
  }
  collected.push(...stream.finish())
  assert.equal(collected.length, 1)
  assert.equal(collected[0].event, 'user_message')
  assert.equal(collected[0].data.data.text, '帮我做一节数学课')
})

test('createAgentSseStream survives multibyte characters split across chunks', () => {
  const stream = createAgentSseStream()
  const payload = JSON.stringify({ data: { text: '正在生成「通分三步法」页面' } })
  const wire = `event: user_message\ndata: ${payload}\n\n`
  const bytes = bytesOf(wire)
  const mid = Math.floor(bytes.length / 2)
  const first = stream.feed(new Uint8Array(bytes.slice(0, mid)))
  const second = stream.feed(new Uint8Array(bytes.slice(mid)))
  const frames = first.concat(second)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].data.data.text, '正在生成「通分三步法」页面')
})

test('createAgentSseStream emits several frames from one chunk and keeps partial tail', () => {
  const stream = createAgentSseStream()
  const wire =
    'id: 1\nevent: session_start\ndata: {}\n\nid: 2\nevent: session_end\ndata: {"status":"succeeded"}\n\nid: 3\nevent: tra'
  const frames = stream.feed(new Uint8Array(bytesOf(wire)))
  assert.equal(frames.length, 2)
  assert.equal(frames[0].event, 'session_start')
  assert.equal(frames[1].data.status, 'succeeded')
  const tail = stream.feed(new Uint8Array(bytesOf('ce\ndata: {"message":"ok"}\n\n')))
  assert.equal(tail.length, 1)
  assert.equal(tail[0].event, 'trace')
  assert.equal(tail[0].data.message, 'ok')
})
