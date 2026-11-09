const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const pagePath = require.resolve('../agent/ai-poster/index.js')
const servicePath = require.resolve('../services/ai-poster.js')
const identityPath = require.resolve('../services/identity.js')
const ORIGIN = 'https://course.zideer.cn'
const ID_A = 'a'.repeat(32)
const ID_B = 'b'.repeat(32)
const ID_C = 'c'.repeat(32)

function applyData(target, values) {
  for (const [key, value] of Object.entries(values)) target[key] = value
}

function activity(id, label, detail = '副标题', cover = '') {
  return { id, label, detail, cover }
}

function catalog(overrides = {}) {
  return {
    success: true,
    enabled: true,
    activities: [activity('study-gift', '开学季学习礼包', '新学期 · 学习成长', `/api/promotion-posters/${ID_C}.jpg`), activity('family-study', '家庭共学计划', '亲子陪伴 · 一起成长')],
    templates: [
      { id: 'portrait', label: '竖版', ratio: '3:4' },
      { id: 'story', label: '长图', ratio: '9:16' },
      { id: 'square', label: '方形', ratio: '1:1' }
    ],
    quota: { dailyLimit: 5, remaining: 5 },
    history: [],
    ...overrides
  }
}

function poster(id, status, overrides = {}) {
  return {
    id,
    activityId: 'study-gift',
    activityLabel: '开学季学习礼包',
    templateId: 'portrait',
    status,
    image: status === 'ready' ? `/api/promotion-posters/${id}.jpg` : '',
    width: status === 'ready' ? 1080 : 0,
    height: status === 'ready' ? 1440 : 0,
    createdAt: new Date().toISOString(),
    failure: status === 'failed' ? 'content' : '',
    ...overrides
  }
}

/**
 * 加载页面：services/ai-poster 用真的（接口结果经它归一），课程服务请求与邀请码中心换成脚本化的假实现。
 * server(path, options) 返回 { statusCode, data }。
 */
function loadPage(server, { qr = async () => ({ qrUrl: 'https://fz-zion-static.functorz.com/qr.png' }), pageStack = [{}, {}] } = {}) {
  delete require.cache[pagePath]
  delete require.cache[servicePath]
  const requests = []
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      requestCourseApi: async (url, options = {}) => {
        requests.push({ url, method: options.method, data: options.data })
        return server(url, options)
      },
      loadCurrentPromotionCode: qr
    }
  }
  const calls = { toast: [], navigate: [], redirect: [], saved: [], written: [], unlinked: [], modal: [], downloads: [] }
  const ctx = { ops: [] }
  for (const name of ['clearRect', 'save', 'restore', 'beginPath', 'closePath']) ctx[name] = () => {}
  ctx.drawImage = (image, ...rest) => ctx.ops.push(['drawImage', image.src, ...rest])
  ctx.arc = (...args) => ctx.ops.push(['arc', ...args])
  ctx.fill = () => ctx.ops.push(['fill', ctx.fillStyle])
  ctx.clip = () => ctx.ops.push(['clip'])
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    createImage() {
      const image = {}
      Object.defineProperty(image, 'src', {
        get() { return this._src },
        set(value) {
          this._src = value
          this.width = value.includes('qr') ? 430 : 1080
          this.height = value.includes('qr') ? 430 : 1440
          Promise.resolve().then(() => this.onload())
        }
      })
      return image
    }
  }
  let definition = null
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pageStack
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
    showToast: (opts) => calls.toast.push(opts.title),
    showModal: (opts) => calls.modal.push(opts.title),
    navigateBack: () => calls.navigate.push('back'),
    navigateTo: (opts) => calls.navigate.push(opts.url),
    redirectTo: (opts) => calls.redirect.push(opts.url),
    request: (opts) => {
      calls.downloads.push(opts.url)
      assert.equal(opts.responseType, 'arraybuffer')
      opts.success({ statusCode: 200, data: new ArrayBuffer(8) })
    },
    downloadFile: (opts) => {
      calls.downloads.push(opts.url)
      opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/qr.png' })
    },
    getFileSystemManager: () => ({
      writeFile: (opts) => { calls.written.push(opts.filePath); opts.success() },
      unlink: (opts) => calls.unlinked.push(opts.filePath)
    }),
    createSelectorQuery: () => ({
      in() { return this },
      select() { return this },
      fields() { return this },
      exec: (callback) => callback([{ node: canvas }])
    }),
    canvasToTempFilePath: (opts) => opts.success({ tempFilePath: 'wxfile://tmp/composed.jpg' }),
    saveImageToPhotosAlbum: (opts) => { calls.saved.push(opts.filePath); opts.success() }
  }
  require(pagePath)
  delete require.cache[identityPath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { applyData(this.data, values) }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls, requests, ctx }
}

const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }

test('course API results are normalized and only course-service poster paths become image URLs', () => {
  delete require.cache[servicePath]
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: {} }
  const service = require('../services/ai-poster')
  delete require.cache[identityPath]
  assert.equal(service.posterImageUrl(`/api/promotion-posters/${ID_A}.jpg`), `${ORIGIN}/api/promotion-posters/${ID_A}.jpg`)
  assert.equal(service.posterImageUrl('https://evil.example/x.jpg'), '')
  assert.equal(service.posterImageUrl('/api/promotion-posters/../x.jpg'), '')
  const normalized = service.normalizeCatalog(catalog({
    activities: [activity('study-gift', '开学季'), activity('Bad Id', '坏的'), { id: 'no-label' }],
    history: [poster(ID_A, 'ready'), poster(ID_B, 'generating'), { id: 'nope' }]
  }))
  assert.deepEqual(normalized.activities.map((item) => item.id), ['study-gift'])
  assert.deepEqual(normalized.history.map((item) => [item.status, Boolean(item.imageUrl)]), [['ready', true], ['generating', false]])
})

test('history times read as 今天 / 昨天 / 月日 / 年月日', () => {
  delete require.cache[servicePath]
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: {} }
  const { formatPosterTime, decoratePoster, filterActivities } = require('../services/ai-poster')
  delete require.cache[identityPath]
  const now = new Date(2026, 8, 26, 18, 0)
  assert.equal(formatPosterTime(new Date(2026, 8, 26, 17, 6).toISOString(), now), '今天 17:06')
  assert.equal(formatPosterTime(new Date(2026, 8, 25, 20, 18).toISOString(), now), '昨天 20:18')
  assert.equal(formatPosterTime(new Date(2026, 8, 20, 9, 30).toISOString(), now), '9月20日 09:30')
  assert.equal(formatPosterTime(new Date(2025, 11, 1, 9, 30).toISOString(), now), '2025年12月1日')
  assert.equal(formatPosterTime('', now), '')
  const decorated = decoratePoster({ templateId: 'story', createdAt: '' })
  assert.deepEqual([decorated.templateLabel, decorated.ratioLabel], ['长图', '9:16'])
  const list = [activity('a', '开学季学习礼包', '新学期'), activity('b', '家庭共学计划', '亲子陪伴')]
  assert.deepEqual(filterActivities(list, '亲子').map((item) => item.id), ['b'])
  assert.deepEqual(filterActivities(list, '  ').map((item) => item.id), ['a', 'b'])
})

test('first load shows skeletons, then real activities with the first one selected', async () => {
  let resolveCatalog
  const { page, requests } = loadPage(() => new Promise((resolve) => { resolveCatalog = resolve }))
  const loading = page.onLoad()
  assert.equal(page.data.loadState, 'loading')
  assert.equal(page.data.canGenerate, false)
  assert.equal(page.data.historyRight, 375 - 281 + 8)
  resolveCatalog({ statusCode: 200, data: catalog() })
  await loading
  assert.equal(requests[0].url, '/api/learn/promotion-poster')
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.selectedActivityId, 'study-gift')
  assert.equal(page.data.visibleActivities[0].coverUrl, `${ORIGIN}/api/promotion-posters/${ID_C}.jpg`)
  assert.equal(page.data.selectedTemplate.id, 'portrait')
  assert.deepEqual([page.data.canGenerate, page.data.generateLabel], [true, '生成专属海报'])

  page.handleActivitySearch({ detail: { value: '共学' } })
  assert.deepEqual(page.data.visibleActivities.map((item) => item.id), ['family-study'])
  page.handleActivityPick({ currentTarget: { dataset: { id: 'family-study' } } })
  page.handleTemplatePick({ currentTarget: { dataset: { id: 'story' } } })
  assert.equal(page.data.selectedActivityId, 'family-study')
  assert.equal(page.data.selectedTemplate.label, '长图')
})

test('generating polls until the poster is ready, then composes my mini-program code and saves it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const polls = [poster(ID_A, 'generating'), poster(ID_A, 'ready')]
  const { page, calls, requests, ctx } = loadPage((url, options) => {
    if (options.method === 'POST') return { statusCode: 200, data: { success: true, poster: poster(ID_A, 'generating'), remaining: 4 } }
    if (url.includes('?id=')) return { statusCode: 200, data: { success: true, poster: polls.shift() } }
    return { statusCode: 200, data: catalog() }
  })
  await page.onLoad()
  page.handleTemplatePick({ currentTarget: { dataset: { id: 'square' } } })
  await page.handleGenerate()
  assert.deepEqual(requests[1], { url: '/api/learn/promotion-poster', method: 'POST', data: { activityId: 'study-gift', templateId: 'square' } })
  assert.equal(page.data.resultVisible, true)
  assert.equal(page.data.result.status, 'generating')
  assert.equal(page.data.shareVisible, false)
  assert.equal(page.data.quota.remaining, 4)
  assert.equal(page.data.history[0].id, ID_A)

  t.mock.timers.tick(4000)
  await settle()
  assert.equal(page.data.result.status, 'generating')
  t.mock.timers.tick(4000)
  await settle()
  assert.equal(requests.filter((item) => item.url === `/api/learn/promotion-poster?id=${ID_A}`).length, 2)
  assert.equal(page.data.result.status, 'ready')
  assert.equal(page.data.shareVisible, true, '出好图直接拉起分享层（设计稿）')
  assert.equal(page.data.shareImageSrc, 'wxfile://tmp/composed.jpg')
  assert.equal(page.data.composingPoster, false)
  assert.deepEqual(calls.downloads, [`${ORIGIN}/api/promotion-posters/${ID_A}.jpg`, 'https://fz-zion-static.functorz.com/qr.png'])
  // 白色圆底 + 裁圆后画码：1080×1440 → 码 151px、白底直径 184、边距 54，圆心 (934, 1294)
  assert.deepEqual(ctx.ops.find((op) => op[0] === 'arc').slice(1, 4), [934, 1294, 92])
  assert.ok(ctx.ops.some((op) => op[0] === 'clip'))

  // 停止轮询：再走几轮也不会再请求
  t.mock.timers.tick(20000)
  await settle()
  assert.equal(requests.filter((item) => item.url.includes('?id=')).length, 2)

  await page.handleSavePoster()
  assert.deepEqual(calls.saved, ['wxfile://tmp/composed.jpg'])
  assert.ok(calls.toast.includes('已保存到相册'))

  page.onUnload()
  assert.deepEqual(calls.unlinked, [`wxfile://usr/ai-poster-${ID_A}.jpg`])
})

test('a failed generation is not charged, explains itself, and can be regenerated with the same choices', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let catalogReads = 0
  const { page, calls, requests } = loadPage((url, options) => {
    if (options.method === 'POST') return { statusCode: 200, data: { success: true, poster: poster(requests.length > 3 ? ID_B : ID_A, 'generating', { templateId: 'story' }), remaining: 4 } }
    if (url.includes('?id=')) return { statusCode: 200, data: { success: true, poster: poster(ID_A, 'failed', { templateId: 'story' }) } }
    catalogReads += 1
    return { statusCode: 200, data: catalog() }
  })
  await page.onLoad()
  page.handleTemplatePick({ currentTarget: { dataset: { id: 'story' } } })
  await page.handleGenerate()
  t.mock.timers.tick(4000)
  await settle()
  assert.equal(page.data.result.status, 'failed')
  assert.ok(calls.toast.includes('画面没通过内容审核，换个活动再试试'))
  assert.equal(catalogReads, 2, '失败后重新读一次剩余次数')

  page.handleActivityPick({ currentTarget: { dataset: { id: 'family-study' } } })
  await page.handleRegenerate()
  const posts = requests.filter((item) => item.method === 'POST')
  assert.deepEqual(posts[1].data, { activityId: 'study-gift', templateId: 'story' })
  assert.equal(page.data.selectedActivityId, 'study-gift')
  assert.equal(page.data.result.id, ID_B)
  page.onUnload()
})

test('server-side refusals turn into readable messages and refresh the quota', async () => {
  const { page, calls, requests } = loadPage((url, options) => {
    if (options.method === 'POST') return { statusCode: 429, data: { code: 'DAILY_LIMIT' } }
    return { statusCode: 200, data: catalog() }
  })
  await page.onLoad()
  await page.handleGenerate()
  assert.deepEqual(calls.toast, ['今天的生成次数用完了，明天再来吧。'])
  assert.equal(page.data.resultVisible, false)
  assert.equal(requests.filter((item) => item.method === 'GET').length, 2)
})

test('an exhausted quota disables the button without calling the server', async () => {
  const { page, calls, requests } = loadPage(() => ({ statusCode: 200, data: catalog({ quota: { dailyLimit: 5, remaining: 0 } }) }))
  await page.onLoad()
  assert.deepEqual([page.data.canGenerate, page.data.generateLabel], [false, '今日生成次数已用完'])
  await page.handleGenerate()
  assert.deepEqual(calls.toast, ['今天的生成次数用完了，明天再来吧'])
  assert.equal(requests.length, 1)
})

test('history opens a ready poster straight into the share sheet; back steps out one layer at a time', async () => {
  const history = [poster(ID_A, 'ready', { templateId: 'story', width: 1080, height: 1920 }), poster(ID_B, 'failed')]
  const { page, calls } = loadPage(() => ({ statusCode: 200, data: catalog({ history }) }))
  await page.onLoad()
  assert.deepEqual(page.data.history.map((item) => [item.templateLabel, item.ratioLabel]), [['长图', '9:16'], ['竖版', '3:4']])
  page.openHistory()
  page.handleHistoryPick({ currentTarget: { dataset: { id: ID_A } } })
  assert.equal(page.data.historyVisible, false)
  assert.equal(page.data.resultVisible, true)
  assert.equal(page.data.shareVisible, true)
  assert.match(page.data.resultPosterStyle, /^width: \d+px; height: \d+px;$/)
  await settle()

  page.handleBack()
  assert.equal(page.data.shareClosing, true)
  page.data.shareVisible = false
  page.handleBack()
  assert.equal(page.data.resultVisible, false)
  page.handleBack()
  assert.deepEqual(calls.navigate, ['back'])

  page.handleHistoryPick({ currentTarget: { dataset: { id: ID_B } } })
  assert.equal(page.data.result.status, 'failed')
  assert.equal(page.data.shareVisible, false)
})

test('when my mini-program code cannot be made, saving falls back to the original poster', async () => {
  const history = [poster(ID_A, 'ready')]
  const { page, calls } = loadPage(() => ({ statusCode: 200, data: catalog({ history }) }), {
    qr: async () => { throw new Error('小程序码生成失败') }
  })
  await page.onLoad()
  page.handleHistoryPick({ currentTarget: { dataset: { id: ID_A } } })
  await settle()
  assert.equal(page.data.composeFailed, true)
  assert.equal(page.data.shareImageSrc, `${ORIGIN}/api/promotion-posters/${ID_A}.jpg`)
  await page.handleSavePoster()
  assert.deepEqual(calls.saved, [`wxfile://usr/ai-poster-${ID_A}.jpg`])
})

test('load failure, a switched-off service and an empty activity list each get their own state', async () => {
  let response = { statusCode: 503, data: { code: 'POSTER_UNAVAILABLE' } }
  const { page } = loadPage(() => response)
  await page.onLoad()
  assert.deepEqual([page.data.loadState, page.data.loadError], ['failed', '海报服务暂时不可用，请稍后再试。'])
  response = { statusCode: 200, data: catalog({ enabled: false, activities: [] }) }
  await page.loadCatalog()
  assert.deepEqual([page.data.loadState, page.data.posterEnabled, page.data.canGenerate], ['ready', false, false])
  response = { statusCode: 200, data: catalog({ activities: [] }) }
  await page.loadCatalog()
  assert.deepEqual([page.data.posterEnabled, page.data.activities.length, page.data.canGenerate], [true, 0, false])
})

test('the workbench banner opens the AI poster page, and every asset comes from the backend', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const workbench = read('agent/promotion/index.wxml')
  assert.match(workbench, /class="promotion-ai-poster-banner" data-url="\/agent\/ai-poster\/index" bindtap="navigate"/)
  assert.match(workbench, /UA\.src\(ui, '\/assets\/promotion\/ai-banner\.jpg'\)/)
  const page = read('agent/ai-poster/index.wxml')
  for (const asset of ['/assets/promotion/history.svg', '/assets/course-library/search.svg', '/assets/promotion/share-download.svg']) {
    assert.ok(page.includes(`UA.src(ui, '${asset}')`), asset)
  }
  assert.equal(/growth-page/.test(page), false)
})
