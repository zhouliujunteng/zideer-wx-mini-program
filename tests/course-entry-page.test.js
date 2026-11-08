const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function loadPage(load = async () => 'https://example.test/learn?course=1') {
  let definition
  const navigations = [], notices = []
  const source = fs.readFileSync(path.join(__dirname, '../learning/course/index.js'), 'utf8')
  vm.runInNewContext(source, {
    Page(value) { definition = value },
    require(name) {
      if (name.includes('support-diagnostics')) return { record() {} }
      return {
        createCourseLaunchUrl: load,
        createLibraryCourseLaunchUrl: load,
        createAgentCourseLaunchUrl: load
      }
    },
    wx: {
      navigateBack(options) { if (options && options.fail) options.fail({ errMsg: 'no previous page' }) },
      switchTab(options) { navigations.push(options.url) },
      showToast(options) { notices.push(options.title) }
    }
  })
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values) } }
  return { page, navigations, notices }
}

test('standalone course entry can return to the learning tab without a previous page', () => {
  const { page, navigations } = loadPage()
  page.goBack()
  assert.deepEqual(navigations, ['/pages/learning/index'])
})

test('a slower previous request cannot replace a newer course entry', async () => {
  const replies = []
  const { page } = loadPage(() => new Promise(resolve => replies.push(resolve)))
  const older = page.loadCourse(), latest = page.retry()
  replies[1]('https://example.test/learn?course=2'); await latest
  replies[0]('https://example.test/learn?course=1'); await older
  assert.equal(page.data.launchUrl, 'https://example.test/learn?course=2')
})

test('an unloaded course entry ignores late success and errors', async () => {
  for (const failed of [false, true]) {
    let resolve, reject
    const { page, notices } = loadPage(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    const pending = page.loadCourse()
    page.onUnload?.()
    const before = JSON.stringify(page.data)
    if (failed) reject(new Error('Old request failed'))
    else resolve('https://example.test/learn?course=1')
    await pending
    assert.equal(JSON.stringify(page.data), before)
    assert.deepEqual(notices, [])
  }
})

test('web-view failure exposes retry and retry reopens the authorized course URL', async () => {
  const { page } = loadPage()
  await page.loadCourse()
  page.onWebViewError()
  assert.equal(page.data.failed, true)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.launchUrl, 'https://example.test/learn?course=1')
  await page.retry()
  assert.equal(page.data.failed, false)
  assert.equal(page.data.launchUrl, 'https://example.test/learn?course=1')
  const template = fs.readFileSync(path.join(__dirname, '../learning/course/index.wxml'), 'utf8')
  assert.match(template, /<web-view\b[^>]*binderror="onWebViewError"/)
})

test('domain restrictions are not disguised as a network outage, and stale web errors are ignored', async () => {
  const { page } = loadPage()
  await page.loadCourse()
  page.onWebViewError({ detail: { src: 'https://old.test/learn', errMsg: 'network failed' } })
  assert.equal(page.data.failed, false)
  page.onWebViewError({ detail: { src: page.data.launchUrl, errMsg: 'url not in domain list' } })
  assert.equal(page.data.failed, true)
  assert.match(page.data.errorMessage, /业务域名/)
})

test('entry failures retain their actionable Chinese reason', async () => {
  const { page } = loadPage(async () => { throw new Error('请先登录后进入课程。') })
  await page.loadCourse()
  assert.equal(page.data.errorMessage, '请先登录后进入课程。')
})

// 课程只能在小程序里学（学习设备确认已下线）：出错时只给重试和返回，不引导复制链接到浏览器
test('a failed course page offers retry and back, never a link to open in a browser', async () => {
  const { page } = loadPage()
  await page.loadCourse()
  page.onWebViewError({ detail: { src: page.data.launchUrl, errMsg: 'network failed' } })
  assert.doesNotMatch(page.data.errorMessage, /复制|浏览器/)
  assert.equal(page.copyCourseLink, undefined)
  const template = fs.readFileSync(path.join(__dirname, '../learning/course/index.wxml'), 'utf8')
  assert.doesNotMatch(template, /复制|copyCourseLink/)
  assert.match(template, /bindtap="retry"/)
  assert.match(template, /bindtap="goBack"/)
})

// 课程详情页点了某一页：把这一页交给入口地址，课程从这一页开始
test('an agent course opened from a page row asks for an entry that starts at that page', async () => {
  const requests = []
  const { page } = loadPage(async (...args) => { requests.push(args); return 'https://example.test/learn?agent=stage-abc123&scene=scene_a2' })
  page.onLoad({ agentCourseId: 'stage-abc123', sceneId: 'scene_a2' })
  await page.loadCourse()
  assert.deepEqual(requests.pop(), ['stage-abc123', 'scene_a2'])
  page.onLoad({ agentCourseId: 'stage-abc123' })
  await page.loadCourse()
  assert.deepEqual(requests.pop(), ['stage-abc123', ''])
})
