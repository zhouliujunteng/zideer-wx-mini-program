const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const config = require('../config/index')
const pagePath = require.resolve('../pages/galaxy/index.js')

function loadPage() {
  delete require.cache[pagePath]
  let definition = null
  const navigations = [], clipboard = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateBack(options) { if (options && options.fail) options.fail({ errMsg: 'no previous page' }) },
    switchTab(options) { navigations.push(options.url) },
    redirectTo(options) { navigations.push(options.url) },
    setClipboardData(options) { clipboard.push(options.data) }
  }
  require(pagePath)
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values) } }
  return { page, navigations, clipboard }
}

test('the galaxy entry opens the public site with the flag that hides its back-to-site link', () => {
  const { page } = loadPage()
  page.onLoad()
  assert.equal(page.data.launchUrl, 'https://zideer.cn/galaxy.html?from=miniprogram')
  assert.equal(page.data.launchUrl, config.GALAXY_URL)

  const template = fs.readFileSync(path.join(__dirname, '../pages/galaxy/index.wxml'), 'utf8')
  assert.match(template, /<web-view\b[^>]*binderror="onWebViewError"/)
})

test('the site hides the back-to-site link exactly for the flag the mini program sends', () => {
  const site = fs.readFileSync(path.join(__dirname, '../../website/galaxy.html'), 'utf8')
  const flag = new URL(config.GALAXY_URL).searchParams.get('from')
  assert.ok(site.includes(`=== '${flag}'`), '官网需要按小程序传的 from 参数判断')
  assert.match(site, /html\[data-embed="miniprogram"\] \.nav-right \.back \{ display: none; \}/)
})

test('a web-view failure offers a retry that reloads, and the link can be copied out', () => {
  const { page, clipboard } = loadPage()
  page.onLoad()

  page.onWebViewError({ detail: { src: 'https://zideer.cn/other', errMsg: 'network failed' } })
  assert.equal(page.data.failed, false)

  page.onWebViewError({ detail: { src: page.data.launchUrl, errMsg: 'url not in domain list' } })
  assert.equal(page.data.failed, true)
  assert.match(page.data.errorMessage, /业务域名/)

  page.retry()
  assert.equal(page.data.failed, false)
  assert.match(page.data.launchUrl, /^https:\/\/zideer\.cn\/galaxy\.html\?from=miniprogram&t=\d+$/)

  page.copyGalaxyLink()
  assert.deepEqual(clipboard, [config.GALAXY_URL])
})

test('the galaxy page falls back to the knowledge map page when it has no previous page', () => {
  const { page, navigations } = loadPage()
  page.goBack()
  assert.deepEqual(navigations, ['/pages/knowledge-map/index'])
})
