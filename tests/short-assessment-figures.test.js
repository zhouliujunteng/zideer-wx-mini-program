// 摸底诊断题目配图（2026-09-29）：题干、选项、解析的配图由测评动作流随题下发，页面按原图宽高比占位、点图看大图、
// 加载失败可重读换新地址。配图数据在后端表 k12_question_figure，见 docs/测评题目配图记录.md。
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function loadWxs() {
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'utils/question-figure.wxs'), 'utf8'), sandbox)
  return sandbox.module.exports
}

function fixture(call) {
  let definition
  const previews = []
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assessment/short/index.js'), 'utf8'), {
    Page: (p) => { definition = p },
    require: () => ({ call, reportView: (r) => r }),
    wx: { showModal() {}, navigateTo() {}, showToast() {}, previewImage: (options) => previews.push(options) },
    // 倒计时与本测试无关：不起真定时器，断言失败时进程也能退出
    Date, setInterval: () => 1, clearInterval() {}
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  page.onLoad({ attemptId: 'a1' })
  page.visible = true
  return { page, previews }
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const figure = (name, width = 800, height = 600) => ({ url: `https://img/${name}.png`, alt: name, width, height })

const drafting = (stemUrl) => ({
  id: 'a1', status: 'draft', revision: 1, answeredCount: 0, totalQuestions: 3, roundCount: 1,
  current: {
    id: 11, prompt: '检查右图装置的气密性',
    figures: [figure(stemUrl)],
    options: [{ value: 'A', label: '甲', figures: [figure('opt-a')] }, { value: 'B', label: '乙' }]
  }
})

test('figure boxes keep the source aspect ratio and cap tall pictures', () => {
  const { box } = loadWxs()
  assert.equal(box({ width: 800, height: 600 }, 1), 'width: 100%; padding-top: 75%;')
  // 竖长图：高度不超过 maxRatio × 容器宽，宽度相应收窄
  assert.equal(box({ width: 400, height: 800 }, 1), 'width: 50%; padding-top: 100%;')
  assert.equal(box({ width: 300, height: 600 }, 0.6), 'width: 30%; padding-top: 60%;')
  // 没有尺寸时按默认比例占位
  assert.equal(box({ url: 'x' }, 1), 'width: 100%; padding-top: 62%;')
})

test('the wxs helper only uses what the WXS runtime supports', () => {
  // WXS 里调用 Number() 会让 wcc 编译失败、整个小程序起不来（Node 里却能跑过），2026-09-29 踩过
  const source = fs.readFileSync(path.join(ROOT, 'utils/question-figure.wxs'), 'utf8').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(source, /\bNumber\s*\(/)
  assert.doesNotMatch(source, /=>|\bconst\b|\blet\b|`/)
})

test('failed figures are matched by url', () => {
  const { failed } = loadWxs()
  assert.equal(failed(['https://img/a.png'], 'https://img/a.png'), true)
  assert.equal(failed(['https://img/a.png'], 'https://img/b.png'), false)
  assert.equal(failed(undefined, 'https://img/a.png'), false)
})

test('option figures pass through to the rendered option list', async () => {
  const { page } = fixture(async () => ({ attempt: drafting('stem') }))
  await page.loadPage()
  assert.equal(page.data.optionList[0].figures[0].url, 'https://img/opt-a.png')
  assert.equal(page.data.optionList[1].figures, undefined)
})

test('previewing a figure pages through every figure of the same question', async () => {
  const { page, previews } = fixture(async () => ({ attempt: drafting('stem') }))
  await page.loadPage()
  page.previewFigure({ currentTarget: { dataset: { url: 'https://img/opt-a.png', group: 'current' } } })
  assert.deepEqual(plain(previews[0]), { current: 'https://img/opt-a.png', urls: ['https://img/stem.png', 'https://img/opt-a.png'] })
  // 报告里逐题回顾的配图（含解析配图）在报告页，见 tests/assessment-report-page.test.js
})

test('a figure that fails to load can be retried and the attempt is re-read for fresh urls', async () => {
  let stem = 'stem-old'
  let reads = 0
  const { page } = fixture(async () => { reads++; return { attempt: drafting(stem) } })
  await page.loadPage()
  page.figureFailed({ currentTarget: { dataset: { url: 'https://img/stem-old.png' } } })
  page.figureFailed({ currentTarget: { dataset: { url: 'https://img/stem-old.png' } } })
  assert.deepEqual(plain(page.data.failedFigures), ['https://img/stem-old.png'])

  stem = 'stem-new'
  page.setData({ answer: 'A' })
  page.retryFigures()
  assert.deepEqual(plain(page.data.failedFigures), [])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reads, 2)
  assert.equal(page.data.attempt.current.figures[0].url, 'https://img/stem-new.png')
  // 重读的是同一道题：已选的答案不能被清掉
  assert.equal(page.data.answer, 'A')
})

test('the answering template renders stem and option figures through the wxs helper', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'assessment/short/index.wxml'), 'utf8')
  assert.match(wxml, /<wxs module="QF" src="\.\.\/\.\.\/utils\/question-figure\.wxs" \/>/)
  for (const list of ['attempt.current.figures', 'item.figures']) {
    assert.ok(wxml.includes(`wx:for="{{${list}}}"`), `missing figures loop: ${list}`)
  }
  // 解析配图只在提交后的报告页出现，作答中的模板里不能有
  assert.ok(!wxml.includes('explanationFigures'))
  const images = wxml.match(/<image [^>]*class="short-figure-image"[^>]*>/g) || []
  assert.equal(images.length, 2)
  images.forEach((tag) => {
    assert.match(tag, /binderror="figureFailed"/)
    assert.match(tag, /data-url="\{\{figure\.url\}\}"/)
  })
})

test('option letters follow each option value, so a scrambled option array still matches the review page', async () => {
  const { page } = fixture(async () => ({ attempt: { ...drafting('stem'), current: { id: 10096, prompt: 'p', options: [{ value: 'B', label: '乙' }, { value: 'A', label: '甲' }, { value: 'C', label: '丙' }, { value: 'D', label: '丁' }] } } }))
  await page.loadPage()
  assert.deepEqual(plain(page.data.optionList.map((o) => o.key)), ['B、', 'A、', 'C、', 'D、'])
})
