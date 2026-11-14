// 个人信息「联系与收货」（2026-11-12 用户要求）：微信加好友二维码 + 直接调用微信收货地址，选好即存课程服务。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { getProfileModel } = require('../services/mock-service')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const picked = {
  errMsg: 'chooseAddress:ok', userName: '王妈妈', telNumber: '13800138000', provinceName: '广东省', cityName: '深圳市',
  countyName: '南山区', streetName: '粤海街道', detailInfoNew: '科技园 1 号', postalCode: '518000', nationalCode: '440305'
}
const stored = { userName: '王妈妈', telNumber: '13800138000', province: '广东省', city: '深圳市', county: '南山区', street: '粤海街道', detail: '科技园 1 号' }

function profilePage({ qr = { uploaded: false }, address = null, loadFails = false, choose = 'ok', saveFails = false } = {}) {
  let definition
  const saved = []
  const toasts = []
  const navigations = []
  const identity = {
    loadCurrentUser: async () => ({ profile: { id: 1, nickname: '王妈妈', account_type: 'guardian', current_grade: 0 } }),
    saveCurrentLearningProfile: async () => ({ profile: { id: 1 } }),
    isAuthenticationRequired: () => false,
    loadFamilyWechatQr: async () => { if (loadFails) throw new Error('down'); return qr },
    loadShippingAddress: async () => address,
    saveShippingAddress: async (value) => {
      if (saveFails) throw new Error('收货地址里的手机号不对，请在微信里改一下再选。')
      saved.push(value)
      return { ...stored, city: value.cityName }
    }
  }
  vm.runInNewContext(read('pages/profile/index.js'), {
    Page: (value) => { definition = value },
    require: (name) => name.includes('identity') ? identity
      : name.includes('permission-guide') ? { isPrivacyError: (e) => /privacy/.test(e.errMsg || '') }
      : { getProfileModel, attachUiAssets() {} },
    wx: {
      showToast: (o) => toasts.push(o.title), showLoading() {}, hideLoading() {},
      navigateTo: (o) => navigations.push(o.url),
      getStorageSync: () => undefined, setStorageSync() {},
      chooseAddress(options) {
        if (choose === 'ok') options.success(picked)
        else options.fail({ errMsg: choose === 'cancel' ? 'chooseAddress:fail cancel' : 'chooseAddress:fail privacy permission is not authorized' })
      }
    },
    setTimeout, clearTimeout
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, saved, toasts, navigations }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('the contact card shows skeletons first, then the QR state and the saved address', async () => {
  const { page } = profilePage({ qr: { uploaded: true }, address: stored })
  assert.equal(page.data.contactLoaded, false)
  await page.onShow()
  await settle()
  assert.equal(page.data.contactLoaded, true)
  assert.equal(page.data.qrUploaded, true)
  assert.equal(JSON.stringify(page.data.address), JSON.stringify({ contact: '王妈妈 138****8000', line: '广东省深圳市南山区粤海街道科技园 1 号' }))
})

test('the QR row opens the upload page', async () => {
  const { page, navigations } = profilePage()
  page.openWechatQr()
  assert.deepEqual(navigations, ['/account/wechat-qr/index'])
})

test('the address row opens the hand-filled address page; nothing in the app declares or calls wx.chooseAddress', async () => {
  const { page, navigations, saved } = profilePage()
  await page.loadContact()
  page.chooseShippingAddress()
  assert.deepEqual(navigations, ['/account/shipping-address/index'])
  assert.equal(saved.length, 0)
  // 没有收货地址接口权限时，app.json 的声明会挡住提审（2026-11-14）
  assert.equal(JSON.parse(read('app.json')).requiredPrivateInfos, undefined)
  assert.ok(!/wx\.chooseAddress\(/.test(read('pages/profile/index.js')))
  assert.ok((JSON.parse(read("app.json")).subpackages || JSON.parse(read("app.json")).subPackages).some((pkg) => pkg.root === 'account' && pkg.pages.includes('shipping-address/index')))
})

function addressPage({ address = null, loadFails = false, saveFails = false } = {}) {
  let definition
  const saved = []
  const toasts = []
  let backs = 0
  vm.runInNewContext(read('account/shipping-address/index.js'), {
    Page: (value) => { definition = value },
    require: (name) => name.includes('identity') ? {
      async loadShippingAddress() { if (loadFails) throw new Error('读不到'); return address },
      async saveShippingAddress(value) { if (saveFails) throw new Error('手机号不对'); saved.push(value); return value }
    } : { rpxToPx: (v) => v / 2 },
    wx: { getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }), getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32 }),
      showToast: (o) => toasts.push(o.title), navigateBack() { backs++ }, switchTab() { backs++ } },
    getCurrentPages: () => [1, 2], setTimeout: (fn) => fn()
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, done) { Object.assign(this.data, values); if (done) done() } }
  return { page, saved, toasts, backs: () => backs }
}
const input = (page, field, value) => page.handleInput({ currentTarget: { dataset: { field } }, detail: { value } })

test('the address form saves name, phone, region and detail in the fields the course service expects', async () => {
  const { page, saved, toasts, backs } = addressPage()
  await page.load()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.canSave, false)
  input(page, 'userName', ' 王妈妈 ')
  input(page, 'telNumber', '13800138000')
  page.handleRegion({ detail: { value: ['广东省', '深圳市', '南山区'] } })
  assert.equal(page.data.canSave, false, '还差详细地址')
  input(page, 'detail', '科技园 1 号')
  assert.equal(page.data.canSave, true)
  await page.handleSave()
  assert.equal(JSON.stringify(saved), JSON.stringify([{ userName: '王妈妈', telNumber: '13800138000', provinceName: '广东省', cityName: '深圳市', countyName: '南山区', detailInfo: '科技园 1 号' }]))
  assert.deepEqual(toasts, ['收货地址已保存'])
  assert.equal(backs(), 1)
})

test('the address form prefills a saved address, says what is missing, and still works when the read fails', async () => {
  const filled = addressPage({ address: stored })
  await filled.page.load()
  assert.equal(filled.page.data.userName, '王妈妈')
  assert.equal(filled.page.data.regionText, '广东省 深圳市 南山区')
  assert.equal(filled.page.data.hasAddress, true)
  assert.equal(filled.page.data.canSave, true)

  const empty = addressPage()
  await empty.page.load()
  input(empty.page, 'userName', '王妈妈')
  input(empty.page, 'telNumber', '1380013')
  await empty.page.handleSave()
  assert.deepEqual([empty.saved.length, empty.toasts[0]], [0, '请填写 11 位手机号'])

  const failed = addressPage({ loadFails: true })
  await failed.page.load()
  assert.deepEqual([failed.page.data.loaded, failed.page.data.loadFailed], [true, true])

  const refused = addressPage({ saveFails: true, address: stored })
  await refused.page.load()
  await refused.page.handleSave()
  assert.match(refused.toasts[0], /手机号不对/)
  assert.equal(refused.page.data.saving, false)
})

test('a failed first read offers a retry instead of showing 未上传 / 去填写', async () => {
  const { page } = profilePage({ loadFails: true })
  await page.loadContact()
  assert.equal(page.data.contactLoaded, false)
  assert.equal(page.data.contactFailed, true)
  const wxml = read('pages/profile/index.wxml')
  assert.match(wxml, /wx:elif="\{\{contactLoaded\}\}" class="profile-row-value \{\{qrUploaded/)
  assert.match(wxml, /bindtap="retryLoadContact"/)
})

test('the QR page carries the four-step upload guide and warns against payment codes', () => {
  const wxml = read('account/wechat-qr/index.wxml')
  for (const step of ['点底部右下角的「我」', '小二维码图标', '「保存图片」', '从相册选刚保存的那张']) assert.ok(wxml.includes(step), step)
  assert.match(wxml, /不要传收款码、群二维码/)
})
