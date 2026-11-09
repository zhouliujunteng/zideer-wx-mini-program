const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadService(requestCourseApi) {
  const sandbox = { module: { exports: {} }, console }
  sandbox.exports = sandbox.module.exports
  sandbox.require = (name) => {
    if (name.endsWith('/identity')) return { requestCourseApi }
    if (name.endsWith('/config/index')) return { COURSE_PORTAL_ORIGIN: 'https://course.zideer.cn' }
    throw new Error(`Unexpected import ${name}`)
  }
  vm.runInNewContext(read('services/achievement-cards.js'), sandbox)
  return sandbox.module.exports
}

const IMG = `/api/achievement-cards/${'a'.repeat(32)}.png`
const sample = {
  hero: { quote: '今天学一点。' },
  summary: { ownedLevels: 1, totalLevels: 6, drawsAvailable: 3, bonusDraws: 1, fragments: 30, exchangeCost: 60, duplicateFragments: 10 },
  series: [
    {
      id: 1, title: '复习系列', subtitle: '', drawsAvailable: 2,
      task: { text: '每完成 1 次复习，得 1 次抽卡（每天最多 3 次）', earnedToday: 2, dailyCap: 3 },
      cards: [
        { id: 11, title: '复习能手', color: '#B57BEA', cover: IMG, coverNo: 1, ownedLevels: 1, ownedCards: 2, totalLevels: 3, lastDrawnAt: '2026-10-11T02:00:00Z',
          levels: [
            { id: 101, no: 1, image: IMG, probability: 57.14, boost: null, owned: 2, lastDrawnAt: '2026-10-11T02:00:00Z' },
            { id: 102, no: 2, image: 'https://evil.example/x.png', probability: 28.6, boost: { text: '每完成 1 次复习，抽中概率 +0.5%', added: 5, cap: 15 }, owned: 0 },
            { id: 103, no: 3, image: '', probability: 14.3, boost: { text: '每完成 1 次复习，抽中概率 +0.5%', added: 5, cap: 25 }, owned: 0 }
          ] },
        { id: 13, title: '空卡', color: '#FFFFFF', ownedLevels: 0, totalLevels: 0, levels: [] }
      ]
    },
    { id: 2, title: '打卡系列', drawsAvailable: 0, task: null, cards: [{ id: 21, title: '晨读', color: 'red', ownedLevels: 0, levels: [{ id: 201, no: 1, probability: 100, owned: 0 }] }] }
  ]
}

test('normalizes series, odds and boosts, and only trusts our own image paths', async () => {
  const { loadAchievementCards } = loadService(async () => ({ statusCode: 200, data: sample }))
  const model = await loadAchievementCards()
  assert.equal(model.fragments, 30)
  assert.equal(model.exchangeCost, 60)
  const [review, checkin] = model.series
  assert.equal(review.drawsAvailable, 2)
  assert.equal(review.drawsTotal, 3, 'series draws plus the shared ones')
  assert.equal(checkin.drawsTotal, 1)
  assert.equal(review.task.text, '每完成 1 次复习，得 1 次抽卡（每天最多 3 次）')
  assert.equal(review.cards.length, 1, 'cards without levels are dropped')
  const card = review.cards[0]
  assert.equal(card.seriesId, 1)
  assert.equal(card.levels[0].probability, 57.1)
  assert.equal(card.levels[1].image, '')
  assert.equal(card.levels[1].boost.added, 5)
  assert.equal(card.levels[0].lastDrawn, '26/10/11')
  assert.equal(checkin.cards[0].color, '#FD7C02', 'bad colors fall back to the theme orange')
})

test('the learning strip puts owned cards first', async () => {
  const { loadAchievementCards, stripCards } = loadService(async () => ({ statusCode: 200, data: sample }))
  const strip = stripCards(await loadAchievementCards())
  assert.equal(JSON.stringify(strip.map((c) => c.id)), '[11,21]')
})

test('draw and exchange go to the series endpoint; errors become friendly messages', async () => {
  const calls = []
  const { drawInSeries, exchangeFragments } = loadService(async (pathName, options) => {
    calls.push(options.data)
    if (options.data.operation === 'exchange') return { statusCode: 409, data: { code: 'NOT_ENOUGH_FRAGMENTS' } }
    return { statusCode: 200, data: { draw: { cardId: 11, levelId: 102, no: 2, isNew: false, owned: 2, fragments: 10, fragmentBalance: 40, drawnAt: '2026-10-14T02:00:00Z', source: 'series' } } }
  })
  const draw = await drawInSeries(1)
  assert.equal(JSON.stringify(calls[0]), '{"operation":"draw","seriesId":1}')
  assert.equal(draw.fragments, 10)
  assert.equal(draw.source, 'series')
  await assert.rejects(exchangeFragments(), /碎片还不够/)
})

function loadReveal(drawResult) {
  let definition
  const buzz = []
  const timers = []
  const sandbox = {
    Component(d) { definition = d },
    console,
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout() {},
    wx: {
      vibrateShort(o) { buzz.push(o.type) },
      showToast() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      startDeviceMotionListening(o) { o.fail && o.fail() }
    },
    require(name) {
      if (name.endsWith('/services/achievement-cards')) return { drawInSeries: async () => drawResult }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/confetti')) return { burstConfetti() {} }
      throw new Error(`Unexpected import ${name}`)
    }
  }
  vm.runInNewContext(read('components/card-reveal/index.js'), sandbox)
  const events = []
  const comp = {
    ...definition.methods,
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: {},
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
    triggerEvent(name, detail) { events.push({ name, detail }) }
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const flush = async () => {
    for (let i = 0; i < 40; i += 1) {
      await tick()
      if (timers.length) timers.shift()()
    }
  }
  return { comp, buzz, events, flush }
}

const review = () => {
  const mine = { id: 11, seriesId: 1, title: '复习能手', color: '#B57BEA', ownedLevels: 1, ownedCards: 2, levels: [{ id: 101, no: 1, owned: 2, probability: 60 }, { id: 102, no: 2, owned: 0, probability: 30 }] }
  const other = { id: 12, seriesId: 1, title: '目标探索', color: '#F27B6B', ownedLevels: 0, ownedCards: 0, levels: [{ id: 201, no: 1, owned: 0, probability: 10 }] }
  return { mine, series: { id: 1, title: '复习系列', drawsTotal: 2, task: { text: '每完成 1 次复习，得 1 次抽卡' }, cards: [mine, other] } }
}

test('from a card: flies in, fans out, pick, reveal shows whichever card of the series was drawn', async () => {
  const { comp, buzz, events, flush } = loadReveal({ cardId: 12, levelId: 201, no: 1, isNew: true, owned: 1, fragments: 0, lastDrawn: '26/10/14', source: 'series' })
  const { mine, series } = review()
  comp.properties = { card: mine, series, mode: 'detail', origin: { left: 20, top: 300, width: 100, height: 140 }, startLevelId: 0 }
  comp.data.origin = comp.properties.origin
  comp.open()
  assert.equal(comp.data.phase, 'entering')
  assert.equal(comp.data.levelIndex, 0, 'starts on the highest owned level')
  assert.equal(comp.data.drawsLeft, 2)
  await flush()
  assert.equal(comp.data.phase, 'open')
  comp.draw()
  assert.equal(comp.data.stage, 'collapse')
  await flush()
  assert.equal(comp.data.stage, 'fan')
  assert.equal(comp.data.hint, '点击选择卡片')
  comp.pickFan({ currentTarget: { dataset: { id: 2 } } })
  await flush()
  assert.equal(comp.data.stage, 'ready')
  const revealing = comp.reveal()
  await flush()
  await revealing
  await flush()
  assert.equal(comp.data.dcard.id, 12, 'shows the drawn card, not the one opened')
  assert.equal(comp.data.dcard.levels[0].owned, 1)
  assert.equal(comp.data.drawsLeft, 1)
  assert.equal(comp.data.dup, null)
  assert.deepEqual(buzz, ['light', 'medium', 'light', 'heavy'])
  assert.ok(events.some((e) => e.name === 'drawn'))
})

test('from the series header: opens straight into the fan; a repeat shows the fragments', async () => {
  const { comp, flush } = loadReveal({ cardId: 11, levelId: 101, no: 1, isNew: false, owned: 3, fragments: 10, fragmentBalance: 40, lastDrawn: '26/10/14', source: 'bonus' })
  const { series } = review()
  comp.properties = { card: null, series, mode: 'draw', origin: null, startLevelId: 0 }
  comp.openForDraw()
  await flush()
  assert.equal(comp.data.stage, 'fan')
  comp.pickFan({ currentTarget: { dataset: { id: 0 } } })
  await flush()
  const revealing = comp.reveal()
  await flush()
  await revealing
  await flush()
  assert.equal(JSON.stringify(comp.data.dup), '{"fragments":10,"balance":40}')
})

test('cannot draw without chances; closing reports close', async () => {
  const { comp, events, flush } = loadReveal(null)
  const { mine, series } = review()
  comp.properties = { card: mine, series: { ...series, drawsTotal: 0 }, mode: 'detail', origin: null, startLevelId: 0 }
  comp.open()
  await flush()
  comp.draw()
  assert.equal(comp.data.stage, 'view')
  comp.close()
  await flush()
  assert.equal(comp.data.phase, 'hidden')
  assert.ok(events.some((e) => e.name === 'close'))
})

test('pages are wired: collection and fragment shop registered, reveal gets the series', () => {
  const app = JSON.parse(read('app.json'))
  const learning = app.subpackages.find((s) => s.root === 'learning')
  assert.ok(learning.pages.includes('achievement-cards/index'))
  assert.ok(learning.pages.includes('card-fragments/index'))
  assert.match(read('pages/learning/index.wxml'), /series="\{\{openSeries\}\}"/)
  assert.match(read('learning/achievement-cards/index.wxml'), /mode="\{\{openMode\}\}"/)
})

test('redemption result shows the achievement-card draws', () => {
  for (const file of ['pages/redemption/index.js', 'components/growth-page/index.js'])
    assert.match(read(file), /成就卡抽卡次数 \+\$\{cardDraws\}/)
})
