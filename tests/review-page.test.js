const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 间隔复习小测页（learning/review）：2026-10-08 用户要求——学生发什么不能直接就算答案，
// 没在答题、听不清、说想不起来的，先追问一句，让学生选「重新回答」或「就这样算」。

const pageSource = fs.readFileSync(path.join(__dirname, '../learning/review/index.js'), 'utf8')
const REVIEW = { stageId: 'stage-1', title: '约分', status: 'open', questions: ['什么是约分？', '什么是最简分数？'], answers: [], result: null }

function loadPage({ checks = {}, checkFails = false } = {}) {
  let definition
  const calls = { checks: [], submits: [] }
  vm.runInNewContext(pageSource, {
    Page(config) { definition = config },
    setInterval: () => 7,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    getCurrentPages: () => [{}],
    console,
    encodeURIComponent,
    Date,
    wx: {
      showToast: () => {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812, safeArea: { bottom: 778 } }),
      getSetting: (options) => options.success({ authSetting: { 'scope.record': true } })
    },
    require(name) {
      if (name.endsWith('/services/identity')) {
        return {
          loadAgentCourseReview: async () => ({ review: REVIEW }),
          checkAgentCourseReviewAnswer: async (stageId, index, answer) => {
            calls.checks.push([index, answer])
            if (checkFails) throw new Error('断网')
            return checks[answer] || { accepted: true, kind: 'answer', reply: '' }
          },
          submitAgentCourseReview: async (stageId, answers) => {
            calls.submits.push(answers)
            return { review: { ...REVIEW, status: 'done', answers, result: { passed: true, score: 1, rating: 4, ratingText: '很轻松', weakPoints: [], misconceptions: [], nextDueDay: '2026-10-24' } } }
          }
        }
      }
      if (name.endsWith('/services/learning-streak')) return { loadCheckin: async () => ({}) }
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => {} }
      if (name.endsWith('/utils/navigation')) return { getNavigationMetrics: () => ({ statusBarHeight: 44, navigationBarHeight: 40, contentTop: 84 }) }
      if (name.endsWith('/utils/voice-input')) return { ...require('../utils/voice-input'), getRecorderBridge: () => null }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
  return { page, calls }
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
const OFF = { accepted: false, kind: 'off_topic', reply: '这句好像没在回答这道题。再想想，用自己的话说说看？' }

async function started(options) {
  const loaded = loadPage(options)
  loaded.page.onLoad({ stageId: 'stage-1' })
  loaded.page.onShow()
  await flush()
  loaded.page.start()
  return loaded
}

test('a reply that is not an answer is held back with a follow-up, and re-answering replaces it', async () => {
  const { page, calls } = await started({ checks: { '哈喽你好吗': OFF } })
  await page.sendAnswer('哈喽你好吗')
  assert.deepEqual(Array.from(page.data.answers), [], '没算作答案')
  assert.equal(page.data.pending.answer, '哈喽你好吗')
  assert.deepEqual(Array.from(page.data.turns.slice(-2), (turn) => turn.content), ['哈喽你好吗', OFF.reply])
  // 直接再说一句：按新的这句来
  await page.sendAnswer('分子分母同时除以公因数')
  assert.deepEqual(Array.from(page.data.answers), ['分子分母同时除以公因数'])
  assert.equal(page.data.pending, null)
  assert.deepEqual(calls.checks.map((call) => call[0]), [0, 0], '两次都是第 1 题')
  assert.equal(page.data.turns.at(-1).content, '第 2 题：什么是最简分数？')
})

test('the learner can retry or keep the held reply, and the quiz is handed in after the last question', async () => {
  const { page, calls } = await started({ checks: { '我忘了': { accepted: false, kind: 'dont_know', reply: '一时想不起来没关系……' } } })
  await page.sendAnswer('我忘了')
  page.retryPending()
  assert.equal(page.data.pending, null)
  assert.equal(page.data.turns.at(-1).content, '第 1 题：什么是约分？', '重新回答：回到这道题')
  await page.sendAnswer('我忘了')
  page.acceptPending()
  assert.deepEqual(Array.from(page.data.answers), ['我忘了'], '就这样算：按原话记下')
  await page.sendAnswer('分子分母只有公因数 1')
  await flush()
  assert.deepEqual(calls.submits.map((answers) => Array.from(answers)), [['我忘了', '分子分母只有公因数 1']])
  assert.equal(page.data.state, 'done')
})

test('when the check cannot run the answer still counts', async () => {
  const { page } = await started({ checkFails: true })
  await page.sendAnswer('随便说一句')
  assert.deepEqual(Array.from(page.data.answers), ['随便说一句'])
})

test('the follow-up offers 重新回答 and 就这样算 buttons', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../learning/review/index.wxml'), 'utf8')
  assert.match(wxml, /bindtap="retryPending"[^>]*>重新回答</)
  assert.match(wxml, /bindtap="acceptPending"[^>]*>就这样算</)
})

// 复习页沿用原复述验收页的版式（2026-11-17 复述验收改成「当小老师」课堂，原样式搬到 learning/review/chat.wxss）：
// 和学生的诊断室同一套类名与数值，诊断室改了这些规则这里要跟着改。
test('the review page keeps the diagnosis-room look through its own copy of the former acceptance styles', () => {
  const entry = fs.readFileSync(path.join(__dirname, '../learning/review/index.wxss'), 'utf8')
  const style = fs.readFileSync(path.join(__dirname, '../learning/review/chat.wxss'), 'utf8')
  const chatStyle = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxss'), 'utf8')
  assert.match(entry, /@import "\.\/chat\.wxss";/)
  assert.doesNotMatch(entry, /agent-acceptance/, '验收页已换成当小老师的样式，复习页不能再引它')
  for (const rule of [
    '.agent-ambient { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;',
    '.agent-message-user .agent-message-bubble { padding: 16rpx 24rpx; border-radius: 28rpx 28rpx 8rpx 28rpx; background: #DCEEFF; color: #222A25; }',
    '.agent-composer-bar { display: flex; align-items: center; min-height: 104rpx; padding: 6rpx 18rpx;',
    '.agent-input { min-width: 0; flex: 1; height: 84rpx; margin: 0 14rpx; color: #2D3931; font-size: 29rpx;',
    '.agent-voice-speak-button { display: flex; flex: 1; align-items: center; justify-content: center; height: 84rpx;',
    '.agent-send-button.is-enabled, .agent-send-button.is-sending { background: #FD7C02; }'
  ]) {
    assert.ok(style.includes(rule), `样式与诊断室不一致：${rule.slice(0, 48)}`)
    assert.ok(chatStyle.includes(rule), `诊断室本身已改过这条规则，需要同步：${rule.slice(0, 48)}`)
  }
})
