const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = (file) => readFileSync(path.join(__dirname, '..', file), 'utf8')

// 2026-10-10 用户要求：课程安排卡只放标题和一两句概括，小纲细节不打出来
test('the course plan card keeps a one- or two-sentence summary and lesson titles only', () => {
  const { buildCoursePlanCard, coursePlanRecordText, briefSummary } = require('../utils/course-plan-card')
  const findings = '摸底结果：比大小、13的组成都能答对，8+7 也答对。但 9+3 是数出来的，没有凑十法。判断：概念层基本站得住，真正的缺口在方法层。所以按导图补习顺序排 6 节。'
  const card = buildCoursePlanCard({ seriesTitle: '20以内进位加法', findings, lessons: [{ lesson: 1, title: '9加几', knowledgePoint: '凑十法', outline: '第1页……第2页……', prerequisites: ['10的分与合'] }] })
  assert.ok(Array.from(card.summary).length <= 60)
  assert.ok(card.summary.startsWith('摸底结果：比大小'))
  assert.equal(briefSummary(''), '')
  // 会议记录里（老师端存档）仍有完整小纲
  assert.match(coursePlanRecordText(card), /第1页/)
  for (const file of ['pages/diagnosis-room/index.wxml', 'teacher/live-room/index.wxml']) {
    const wxml = read(file)
    assert.doesNotMatch(wxml, /lesson\.outline|lesson\.prerequisitesText|lesson\.point/, file)
    assert.match(wxml, /item\.summary/, file)
  }
  assert.match(read('utils/live-session-brief.js'), /findings：\*\*一两句话、60 个字以内\*\*/)
})

// 「朗读」：老师每句话下面都有，点了读、再点停；同一句话存在本地，下次不再请求
test('teacher messages in the diagnosis room can be read aloud', async () => {
  const wxml = read('pages/diagnosis-room/index.wxml')
  assert.match(wxml, /catchtap="handleSpeak"/)
  const files = {}
  let requests = 0
  const audio = { handlers: {}, src: '', play() { this.playing = true }, stop() { this.playing = false; this.handlers.stop && this.handlers.stop() } }
  ;['onEnded', 'onStop', 'onError'].forEach((name) => { audio[name] = (fn) => { audio.handlers[name.slice(2).toLowerCase()] = fn } })
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    setInnerAudioOption() {},
    createInnerAudioContext: () => audio,
    showToast() {},
    getFileSystemManager: () => ({
      accessSync(p) { if (!files[p]) throw new Error('missing') },
      writeFileSync(p, data) { files[p] = data }
    })
  }
  const identityPath = require.resolve('../services/identity')
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: { loadSpeechAudio: async () => { requests += 1; return new ArrayBuffer(8) } } }
  const speechPath = require.resolve('../services/learn-speech')
  delete require.cache[speechPath]
  const { toggleSpeech } = require('../services/learn-speech')
  const states = []
  const onChange = (key, status) => states.push(`${key}:${status}`)
  await toggleSpeech('m1', '你好，我们开始吧', onChange)
  assert.equal(audio.playing, true)
  assert.match(audio.src, /^wxfile:\/\/usr\/speech-.+\.mp3$/)
  await toggleSpeech('m1', '你好，我们开始吧', onChange)
  assert.equal(audio.playing, false)
  await toggleSpeech('m1', '你好，我们开始吧', onChange)
  assert.equal(requests, 1, '同一句话第二次直接用本地文件')
  assert.deepEqual(states.slice(0, 3), ['m1:loading', 'm1:playing', 'm1:'])
  delete require.cache[identityPath]
  delete require.cache[speechPath]
})
