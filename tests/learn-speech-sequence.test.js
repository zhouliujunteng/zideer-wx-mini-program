const test = require('node:test')
const assert = require('node:assert/strict')

// 当小老师（2026-11-17）：同学们一次说好几句，每句一个声音，services/learn-speech.js playSequence 按顺序读；
// 读不出来的跳过接着读、不弹提示；能中途停。诊断室点一句读一句（toggleSpeech）照旧。

function setup({ failVoices = [] } = {}) {
  const files = {}
  const requests = []
  const toasts = []
  const audio = {
    handlers: {},
    src: '',
    playing: false,
    play() { this.playing = true },
    stop() { this.playing = false; if (this.handlers.stop) this.handlers.stop() },
    end() { this.playing = false; this.handlers.ended() },
    fail() { this.playing = false; this.handlers.error() }
  }
  ;['onEnded', 'onStop', 'onError'].forEach((name) => { audio[name] = (fn) => { audio.handlers[name.slice(2).toLowerCase()] = fn } })
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    setInnerAudioOption() {},
    createInnerAudioContext: () => audio,
    showToast: (options) => toasts.push(options.title),
    getFileSystemManager: () => ({
      accessSync(p) { if (!files[p]) throw new Error('missing') },
      writeFileSync(p, data) { files[p] = data }
    })
  }
  const identityPath = require.resolve('../services/identity')
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      loadSpeechAudio: async (text, voice) => {
        requests.push(voice === undefined ? [text] : [text, voice])
        if (failVoices.includes(voice)) throw new Error('今天朗读的次数用完了')
        return new ArrayBuffer(8)
      }
    }
  }
  const speechPath = require.resolve('../services/learn-speech')
  delete require.cache[speechPath]
  const speech = require('../services/learn-speech')
  const cleanup = () => {
    delete require.cache[identityPath]
    delete require.cache[speechPath]
  }
  return { speech, audio, requests, toasts, cleanup }
}

const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

test('a sequence is read in order, one voice per line, telling the page when each line starts and ends', async () => {
  const { speech, audio, requests, toasts, cleanup } = setup()
  const events = []
  speech.playSequence([{ text: '小老师好', voice: 'xiaoman' }, { text: '今天讲什么', voice: 'doudou' }], {
    onStart: (index) => events.push(`start${index}`),
    onEnd: (index) => events.push(`end${index}`),
    onDone: ({ stopped }) => events.push(stopped ? 'stopped' : 'done')
  })
  await flush()
  assert.deepEqual(events, ['start0'])
  assert.equal(audio.playing, true)
  assert.match(audio.src, /^wxfile:\/\/usr\/speech-.+\.mp3$/)
  assert.deepEqual(requests.map((request) => request[1]), ['xiaoman', 'doudou'], '读第一句时顺手把下一句取上')
  audio.end()
  await flush()
  assert.deepEqual(events, ['start0', 'end0', 'start1'])
  audio.end()
  await flush()
  assert.deepEqual(events, ['start0', 'end0', 'start1', 'end1', 'done'])
  assert.deepEqual(toasts, [])
  cleanup()
})

test('the same words in another voice are a different local file, and plain lines keep their old cache name', () => {
  const { speech, cleanup } = setup()
  const plain = speech.filePathFor('你好')
  assert.notEqual(speech.filePathFor('你好', 'xiaoman'), plain)
  assert.notEqual(speech.filePathFor('你好', 'xiaoman'), speech.filePathFor('你好', 'doudou'))
  assert.equal(plain, `wxfile://usr/speech-${speech.hashText('你好')}.mp3`)
  cleanup()
})

test('a line that cannot be read is skipped quietly after a short pause, and a playback error moves on too', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { speech, audio, toasts, cleanup } = setup({ failVoices: ['ale'] })
  const events = []
  speech.playSequence([{ text: '讲慢一点哦', voice: 'ale' }, { text: '我学会了', voice: 'xiaoman' }, { text: '为什么', voice: 'doudou' }], {
    onStart: (index) => events.push(`start${index}`),
    onEnd: (index) => events.push(`end${index}`),
    onDone: () => events.push('done')
  })
  await flush()
  assert.deepEqual(events, ['start0'], '读不出来也亮出气泡')
  assert.equal(audio.playing, false)
  t.mock.timers.tick(4000)
  await flush()
  assert.deepEqual(events, ['start0', 'end0', 'start1'])
  audio.fail()
  await flush()
  assert.deepEqual(events, ['start0', 'end0', 'start1', 'end1', 'start2'])
  audio.end()
  await flush()
  assert.equal(events[events.length - 1], 'done')
  assert.deepEqual(toasts, [], '按顺序读时出错不弹提示')
  cleanup()
})

test('stopping (the teacher starts talking, the page closes) halts the sequence and reports it', async () => {
  const { speech, audio, cleanup } = setup()
  const events = []
  const handle = speech.playSequence([{ text: '一', voice: 'xiaoman' }, { text: '二', voice: 'doudou' }], {
    onStart: (index) => events.push(`start${index}`),
    onDone: ({ stopped }) => events.push(stopped ? 'stopped' : 'done')
  })
  await flush()
  handle.stop()
  await flush()
  assert.equal(audio.playing, false)
  assert.deepEqual(events, ['start0', 'stopped'])
  handle.stop()
  assert.deepEqual(events, ['start0', 'stopped'], '停两次不重复报')
  // stopSpeech 也停得住
  speech.playSequence([{ text: '三', voice: 'ale' }], { onDone: ({ stopped }) => events.push(stopped ? 'stopped' : 'done') })
  await flush()
  speech.stopSpeech()
  assert.equal(events[events.length - 1], 'stopped')
  cleanup()
})

test('tapping one line in the diagnosis room still toggles and still warns when playback fails', async () => {
  const { speech, audio, toasts, cleanup } = setup()
  const states = []
  const onChange = (key, status) => states.push(`${key}:${status}`)
  await speech.toggleSpeech('m1', '你好', onChange)
  assert.equal(audio.playing, true)
  audio.fail()
  assert.deepEqual(states, ['m1:loading', 'm1:playing', 'm1:'])
  assert.deepEqual(toasts, ['朗读播放失败，请再点一次'])
  cleanup()
})
