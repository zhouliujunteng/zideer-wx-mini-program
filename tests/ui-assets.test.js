const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '..')
const servicePath = require.resolve('../services/ui-assets.js')

function loadService({ responses = [], stored = null } = {}) {
  delete require.cache[servicePath]
  const requests = []
  const storage = { ui_assets_v1: stored }
  global.wx = {
    request(options) {
      requests.push(options)
      const next = responses.shift()
      setTimeout(() => {
        if (next instanceof Error) options.fail(next)
        else options.success(next)
      }, 0)
    },
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value }
  }
  return { service: require(servicePath), requests, storage }
}

const ok = (rows) => ({ statusCode: 200, data: { data: { ui_asset: rows } } })

test('ui assets are fetched once per launch without a login token and keyed by asset path', async () => {
  const { service, requests, storage } = loadService({ responses: [ok([
    { asset_key: 'me/coins.png', image: { url: 'https://cdn/coins.png' } },
    { asset_key: 'broken.png', image: null }
  ])] })

  const [first, second] = await Promise.all([service.loadUiAssets(), service.loadUiAssets()])
  const third = await service.loadUiAssets()

  assert.equal(requests.length, 1)
  assert.equal(requests[0].header.Authorization, undefined)
  assert.deepEqual(first, { 'me/coins.png': 'https://cdn/coins.png' })
  assert.equal(second, first)
  assert.equal(third, first)
  assert.deepEqual(storage.ui_assets_v1.map, first)
})

test('a failed load keeps the cached map and the next call retries', async () => {
  const cached = { map: { 'brand/splash.jpg': 'https://cdn/old.jpg' }, fetchedAt: Date.now() - 1000 }
  const { service, requests } = loadService({ stored: cached, responses: [new Error('offline'), ok([{ asset_key: 'brand/splash.jpg', image: { url: 'https://cdn/new.jpg' } }])] })

  assert.deepEqual(service.getUiAssets(), cached.map)
  await assert.rejects(service.loadUiAssets())
  assert.deepEqual(service.getUiAssets(), cached.map)
  assert.deepEqual(await service.loadUiAssets(), { 'brand/splash.jpg': 'https://cdn/new.jpg' })
  assert.equal(requests.length, 2)
})

test('an expired local cache is not used for first paint', () => {
  const stale = { map: { 'a.png': 'https://cdn/a.png' }, fetchedAt: Date.now() - 13 * 60 * 60 * 1000 }
  const { service } = loadService({ stored: stale })
  assert.deepEqual(service.getUiAssets(), {})
})

test('attaching renders with the current map, then refreshes once the launch fetch arrives', async () => {
  const { service } = loadService({ responses: [ok([{ asset_key: 'home/brand-logo.png', image: { url: 'https://cdn/logo.png' } }])] })
  const updates = []
  const page = { setData(values) { updates.push(values.ui) } }

  await service.attachUiAssets(page)

  assert.deepEqual(updates, [{}, { 'home/brand-logo.png': 'https://cdn/logo.png' }])
})

// —— 规则守护：界面图片一律走后端 ——

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', 'tests', 'scripts', 'docs', 'integrations'].includes(name)) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

test('the package ships no images except the native tab bar icons declared in app.json', () => {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const allowed = new Set(app.tabBar.list.flatMap((item) => [item.iconPath, item.selectedIconPath]))
  const images = walk(ROOT)
    .map((file) => path.relative(ROOT, file))
    .filter((file) => /\.(png|jpe?g|svg|gif|webp)$/i.test(file) && !allowed.has(file))
  assert.deepEqual(images, [], '界面图片应上传到后端 ui_asset 表，不要放进小程序包')
})

test('every image that shows a package asset path goes through the backend asset map', () => {
  const offenders = []
  for (const file of walk(ROOT).filter((name) => name.endsWith('.wxml'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const tag of text.match(/<(image|cover-image)\b(?:[^>{]|\{\{[\s\S]*?\}\})*?>/g) || []) {
      const src = /\ssrc="([^"]*)"/.exec(tag)
      if (src && src[1].includes('assets/') && !src[1].startsWith('{{UA.src(ui,')) offenders.push(`${path.relative(ROOT, file)}: ${src[1]}`)
    }
    if (text.includes('UA.src(') && !text.includes('<wxs module="UA"')) offenders.push(`${path.relative(ROOT, file)}: missing wxs import`)
  }
  assert.deepEqual(offenders, [])
})

test('the template helper maps any package path spelling to the backend url and leaves other sources alone', () => {
  const vm = require('node:vm')
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'utils/ui-asset.wxs'), 'utf8'), sandbox)
  const { src } = sandbox.module.exports
  const ui = { 'me/coins.png': 'https://cdn/coins.png', 'membership/plan-crown.svg': 'https://cdn/crown.svg' }

  assert.equal(src(ui, '/assets/me/coins.png'), 'https://cdn/coins.png')
  assert.equal(src(ui, '../../assets/me/coins.png'), 'https://cdn/coins.png')
  assert.equal(src(ui, '/commerce/assets/membership/plan-crown.svg'), 'https://cdn/crown.svg')
  assert.equal(src(ui, '/assets/me/unknown.png'), '')
  assert.equal(src(undefined, '/assets/me/coins.png'), '')
  assert.equal(src(ui, 'https://zion/avatar.png'), 'https://zion/avatar.png')
  assert.equal(src(ui, 'wxfile://tmp/a.png'), 'wxfile://tmp/a.png')
  assert.equal(src(ui, ''), '')
})
