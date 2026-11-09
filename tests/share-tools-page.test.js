const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('../agent/share-tools/index.js'), 'utf8')

function loadPage({ mine = { promotionCode: 'ZLA2B3C4D5', qrUrl: 'https://cdn.example/qr.png' }, error = null } = {}) {
  let definition
  const calls = { toasts: [], clipboard: [], previews: [], loads: 0 }
  vm.runInNewContext(source, {
    Page: (value) => { definition = value },
    require: (name) => name.includes('identity')
      ? { async loadCurrentPromotionCode() { calls.loads += 1; if (error) throw error; return mine } }
      : { attachUiAssets() {} },
    getCurrentPages: () => [{}],
    wx: {
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
      getMenuButtonBoundingClientRect: () => ({ left: 283, top: 26, width: 87, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      setClipboardData: (options) => { calls.clipboard.push(options.data); if (options.success) options.success() },
      previewImage: (options) => calls.previews.push(options.current),
      stopPullDownRefresh() {}
    }
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const keys = key.split('.'); let target = this.data
        while (keys.length > 1) target = target[keys.shift()]
        target[keys[0]] = value
      }
    }
  }
  return { page, calls }
}

test('promotion tools shows nothing but the owner\'s promotion code and its mini program code', async () => {
  // 页面只有一张邀请码卡片：邀请链接生成与已生成邀请记录 2026-09-22 已移除
  const template = fs.readFileSync(require.resolve('../agent/share-tools/index.wxml'), 'utf8')
  assert.match(template, /我的邀请码/)
  for (const gone of ['生成推广链接', '已生成邀请', 'invitationResult']) assert.doesNotMatch(template, new RegExp(gone))
  // 对外只说「邀请码」，不再出现旧叫法
  assert.doesNotMatch(template, /推广码/)
  assert.doesNotMatch(template, /growth-page/)

  const { page, calls } = loadPage()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.code, 'ZLA2B3C4D5')
  assert.equal(page.data.qrUrl, 'https://cdn.example/qr.png')
  assert.equal(calls.loads, 1)
})

test('tapping the code copies it, and an unavailable code copies nothing', async () => {
  const { page, calls } = loadPage()
  await page.loadPage()
  page.copyCode()
  assert.deepEqual(calls.clipboard, ['ZLA2B3C4D5'])
  assert.deepEqual(calls.toasts, ['邀请码已复制'])
  page.previewQr()
  assert.deepEqual(calls.previews, ['https://cdn.example/qr.png'])

  const blank = loadPage({ mine: { promotionCode: '', qrUrl: '' } })
  await blank.page.loadPage()
  blank.page.copyCode()
  blank.page.previewQr()
  assert.deepEqual(blank.calls.clipboard, [])
  assert.deepEqual(blank.calls.previews, [])
})

test('a first load failure offers a retry, while a refresh failure keeps the code on screen', async () => {
  const { page } = loadPage({ error: new Error('邀请码分配失败，请稍后重试。') })
  await page.loadPage()
  assert.equal(page.data.loadState, 'failed')
  assert.match(page.data.loadError, /邀请码分配失败/)

  const refreshed = loadPage()
  await refreshed.page.loadPage()
  refreshed.page.data.loadState = 'ready'
  const failing = loadPage({ error: new Error('网络开小差') })
  failing.page.data.loadState = 'ready'
  failing.page.data.code = 'ZLA2B3C4D5'
  await failing.page.loadPage()
  assert.equal(failing.page.data.loadState, 'ready')
  assert.equal(failing.page.data.code, 'ZLA2B3C4D5')
  assert.deepEqual(failing.calls.toasts, ['网络开小差'])
})
