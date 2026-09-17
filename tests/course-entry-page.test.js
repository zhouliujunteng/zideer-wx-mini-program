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
    require() {
      return {
        createCourseLaunchUrl: load,
        createLibraryCourseLaunchUrl: load,
        courseShareUrl: (url) => String(url || '').replace('/api/learn/entry?', '/learn?').replace(/&ticket=[A-Za-z0-9_-]*/, '')
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
  assert.equal(page.data.courseUrl, 'https://example.test/learn?course=1')
})

test('entry failures retain their actionable Chinese reason', async () => {
  const { page } = loadPage(async () => { throw new Error('请先登录后进入课程。') })
  await page.loadCourse()
  assert.equal(page.data.errorMessage, '请先登录后进入课程。')
})

test('copying the course link never exposes the one-time entry ticket', async () => {
  const { page } = loadPage(async () => 'https://example.test/api/learn/entry?course=1&layout=focus&ticket=TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT')
  await page.loadCourse()
  assert.match(page.data.launchUrl, /ticket=/)
  assert.equal(page.data.courseUrl, 'https://example.test/learn?course=1&layout=focus')
})
