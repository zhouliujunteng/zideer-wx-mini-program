const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { applyKey, splitAtCursor, keyRows, KEY_PAGES } = require('../utils/math-keyboard')
const { normalizePractice, questionScreen } = require('../utils/practice-view')
const { normalizeChallenge, challengeScreen } = require('../utils/challenge-view')

// 数学键盘（2026-11-17）：互动练习、考试挑战要写算式的题自带键盘，键位与网页端 lib/portal/math-keyboard.ts 一致。

test('按键在光标处插入、退格、挪光标', () => {
  let s = { value: '', cursor: 0 }
  for (const key of ['x', '²', '−', '1']) s = applyKey(s.value, s.cursor, key)
  assert.deepEqual(s, { value: 'x²−1', cursor: 4 })
  s = applyKey(s.value, s.cursor, 'left')
  s = applyKey(s.value, s.cursor, 'left')
  s = applyKey(s.value, s.cursor, '2')
  assert.deepEqual(s, { value: 'x²2−1', cursor: 3 })
  s = applyKey(s.value, s.cursor, 'back')
  assert.deepEqual(s, { value: 'x²−1', cursor: 2 })
  assert.deepEqual(applyKey('ab', 0, 'back'), { value: 'ab', cursor: 0 })
  assert.deepEqual(applyKey('ab', 9, 'right'), { value: 'ab', cursor: 2 })
  assert.deepEqual(applyKey('ab', 1, 'clear'), { value: '', cursor: 0 })
  assert.deepEqual(applyKey('a'.repeat(40), 40, '1'), { value: 'a'.repeat(40), cursor: 40 })
  assert.deepEqual(splitAtCursor('3×4', 1), { before: '3', after: '×4' })
})

test('两页键都是 4 行 6 列，常用数学符号都在', () => {
  for (const page of ['num', 'sym']) {
    assert.equal(KEY_PAGES[page].length, 4)
    for (const row of KEY_PAGES[page]) assert.equal(row.length, 6)
  }
  const all = [...KEY_PAGES.num, ...KEY_PAGES.sym].flat()
  for (const key of ['0', '9', '.', '+', '−', '×', '÷', '=', '/', '(', ')', '²', '√', 'π', '<', '>', '≤', '≥', '≠', '^', '%', '°', '±']) assert.ok(all.includes(key), key)
  assert.equal(keyRows('num')[2][4].label, '分数 /')
})

test('网页端的键位与小程序一致', () => {
  const web = path.join(__dirname, '../../OpenMAIC-sync/lib/portal/math-keyboard.ts')
  if (!fs.existsSync(web)) return
  const source = fs.readFileSync(web, 'utf8')
  for (const row of [...KEY_PAGES.num, ...KEY_PAGES.sym]) assert.ok(source.includes(`[${row.map((key) => `'${key}'`).join(', ')}]`), row.join(' '))
})

test('题目带 mathKeyboard 才给键盘；考试挑战要写的题默认给', () => {
  const practice = normalizePractice({
    status: 'ready',
    questions: [{ type: 'fill', prompt: '3/4 = ___', options: [], mathKeyboard: true }, { type: 'fill', prompt: '叫什么律', options: [] }],
    progress: { current: 0, remaining: 2, cleared: 0, streak: 0, bestStreak: 0, answered: 0 }
  })
  assert.equal(questionScreen(practice, '', false).mathKeyboard, true)
  practice.progress.current = 1
  assert.equal(questionScreen(practice, '', false).mathKeyboard, false)
  const challenge = normalizeChallenge({
    status: 'ready',
    questions: [{ type: 'steps', prompt: '解方程', steps: ['移项', '结果'] }, { type: 'single', prompt: '选', options: ['1', '2', '3', '4'] }],
    progress: { current: 0, tries: 0 }
  })
  assert.equal(challengeScreen(challenge, ['', ''], false).mathKeyboard, true)
})
