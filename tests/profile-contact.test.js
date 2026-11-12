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

test('picking a WeChat address saves it right away; cancelling does nothing; failures are explained', async () => {
  const ok = profilePage()
  await ok.page.loadContact()
  ok.page.chooseShippingAddress()
  await settle()
  assert.equal(ok.saved.length, 1)
  assert.equal(ok.saved[0].userName, '王妈妈')
  assert.equal(ok.page.data.address.contact, '王妈妈 138****8000')
  assert.equal(ok.page.data.savingAddress, false)
  assert.deepEqual(ok.toasts, ['收货地址已保存'])

  const cancel = profilePage({ choose: 'cancel' })
  await cancel.page.loadContact()
  cancel.page.chooseShippingAddress()
  assert.deepEqual([cancel.saved.length, cancel.toasts.length], [0, 0])

  const privacy = profilePage({ choose: 'privacy' })
  await privacy.page.loadContact()
  privacy.page.chooseShippingAddress()
  assert.match(privacy.toasts[0], /隐私保护指引/)

  const refused = profilePage({ saveFails: true })
  await refused.page.loadContact()
  refused.page.chooseShippingAddress()
  await settle()
  assert.equal(refused.page.data.address, null)
  assert.match(refused.toasts[0], /手机号不对/)
})

test('a failed first read offers a retry instead of showing 未上传 / 从微信选择', async () => {
  const { page } = profilePage({ loadFails: true })
  await page.loadContact()
  assert.equal(page.data.contactLoaded, false)
  assert.equal(page.data.contactFailed, true)
  const wxml = read('pages/profile/index.wxml')
  assert.match(wxml, /wx:elif="\{\{contactLoaded\}\}" class="profile-row-value \{\{qrUploaded/)
  assert.match(wxml, /bindtap="retryLoadContact"/)
})

test('wx.chooseAddress is declared in app.json requiredPrivateInfos', () => {
  assert.ok(JSON.parse(read('app.json')).requiredPrivateInfos.includes('chooseAddress'))
})

test('the QR page carries the four-step upload guide and warns against payment codes', () => {
  const wxml = read('account/wechat-qr/index.wxml')
  for (const step of ['点底部右下角的「我」', '小二维码图标', '「保存图片」', '从相册选刚保存的那张']) assert.ok(wxml.includes(step), step)
  assert.match(wxml, /不要传收款码、群二维码/)
})
