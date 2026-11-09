const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { getProfileModel } = require('../services/mock-service')

function profilePage({ backendAvatar = '', saveResultAvatar = 'https://cdn.example/avatar.jpeg', backendProfile = null } = {}) {
  let definition
  const saved = []
  const storage = {}
  const identity = {
    loadCurrentUser: async () => ({ profile: backendProfile || { id: 1, nickname: '小鹿', current_grade: 7, semester: '上学期', avatar_url: backendAvatar } }),
    saveCurrentLearningProfile: async (form) => {
      saved.push(form)
      return { profile: { id: 1, avatar_url: saveResultAvatar } }
    },
    isAuthenticationRequired: () => false,
    // 资料页进入时还会拉推荐人；这里只要不炸，用例关心的是头像
    loadCurrentReferrer: async () => ({ referrer: null, attributedAt: '' }),
    bindCurrentPromotionCode: async () => ({ alreadyBound: false, referrer: null })
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/profile/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => name.includes('identity') ? identity : name.includes('referral-context') ? { clearPendingReferral() {} } : { getProfileModel },
    wx: {
      showToast() {}, showLoading() {}, hideLoading() {},
      showActionSheet: (options) => options.success({ tapIndex: 1 }),
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => { storage[key] = value }
    },
    setTimeout, clearTimeout
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      for (const [key, value] of Object.entries(values)) {
        const keys = key.split('.')
        let target = this.data
        while (keys.length > 1) target = target[keys.shift()]
        target[keys[0]] = value
      }
    }
  }
  return { page, saved, storage }
}

test('chosen WeChat avatar is saved right away and replaced by the backend url', async () => {
  const { page, saved, storage } = profilePage()
  await page.onShow()
  // 页面上未保存的昵称修改不能被选头像连带提交
  page.setData({ 'model.name': '未保存的新名字' })
  await page.handleChooseAvatar({ detail: { avatarUrl: 'http://tmp/wechat-default.jpeg' } })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].avatarPath, 'http://tmp/wechat-default.jpeg')
  assert.equal(saved[0].nickname, '小鹿')
  assert.equal(saved[0].profileId, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(saved[0], 'birthday'), false)
  assert.equal(page.data.model.avatarSrc, 'https://cdn.example/avatar.jpeg')
  assert.equal(storage['zhilu-mock-profile-setup'], undefined)

  await page.handleSave()
  assert.equal(saved[1].avatarPath, '')
})

test('failed avatar upload keeps the preview so the save button can retry it', async () => {
  const { page, saved } = profilePage()
  await page.onShow()
  let fail = true
  const original = page.saveAvatar
  page.saveAvatar = async function (path) {
    if (fail) { fail = false; return }
    return original.call(this, path)
  }
  await page.handleChooseAvatar({ detail: { avatarUrl: 'http://tmp/wechat-default.jpeg' } })
  // 选头像时小程序可能触发 onShow，未保存的预览不能被后端空头像覆盖
  await page.onShow()
  assert.equal(page.data.model.avatarSrc, 'http://tmp/wechat-default.jpeg')
  await page.handleSave()
  assert.equal(saved[0].avatarPath, 'http://tmp/wechat-default.jpeg')
})

test('profile avatar ignores stale local copies and shows the backend avatar', async () => {
  const { page, storage } = profilePage({ backendAvatar: 'https://cdn.example/backend.jpeg' })
  storage['zhilu-mock-profile-setup'] = { avatarSrc: 'wxfile://store/old-local.jpeg' }
  await page.onShow()
  assert.equal(page.data.model.avatarSrc, 'https://cdn.example/backend.jpeg')
})

test('a guardian profile keeps its identity and never gains a grade, school or textbook when saved here', async () => {
  const { page, saved } = profilePage({ backendProfile: { id: 1, nickname: '鹿妈妈', account_type: 'guardian', current_grade: 0, semester: '', school_name: '', textbook_version: '', region_detail: '上海', avatar_url: '' } })
  await page.onShow()
  assert.equal(page.data.model.rows.some(row => ['school', 'grade', 'textbook'].includes(row.id)), false)
  await page.handleChooseAvatar({ detail: { avatarUrl: 'http://tmp/a.jpeg' } })
  assert.equal(saved[0].grade, 0)
  assert.equal(saved[0].semester, '')
  await page.handleSave()
  assert.equal(saved[1].accountType, 'guardian')
  assert.equal(saved[1].grade, 0)
  assert.equal(saved[1].semester, '')
  assert.equal(saved[1].schoolName, '')
  assert.equal(saved[1].textbookVersion, '')
})

// 2026-09-26 用户规则：个人资料加性别、户籍地；实名认证后生日、性别、户籍地按身份证锁定，所在城市仍可改
test('verified birthday, gender and household region are locked rows and saved as the ID values', async () => {
  const { page, saved } = profilePage({ backendProfile: { id: 1, nickname: '鹿妈妈', account_type: 'guardian', current_grade: 0, semester: '', gender: 'female', birthday: '1988-04-09', household_region: '浙江省 温州市', region_detail: '浙江省 杭州市', birthday_locked: true, gender_locked: true, household_region_locked: true, avatar_url: '' } })
  await page.onShow()
  assert.deepEqual(page.data.model.rows.map(row => row.id), ['gender', 'region', 'household', 'birthday'])
  const rows = Object.fromEntries(page.data.model.rows.map(row => [row.id, row]))
  assert.deepEqual([rows.gender.value, rows.household.value, rows.birthday.value, rows.region.value], ['女', '浙江省 温州市', '1988-04-09', '浙江省 杭州市'])
  assert.deepEqual([rows.gender.locked, rows.household.locked, rows.birthday.locked, rows.region.locked], [true, true, true, false])
  assert.doesNotMatch(page.data.model.footerNote, /实名认证/)
  await page.handleSave()
  assert.deepEqual([saved[0].gender, saved[0].householdRegion, saved[0].birthday, saved[0].regionDetail], ['female', '浙江省 温州市', '1988-04-09', '浙江省 杭州市'])
})

test('before verification a guardian picks gender and household region and is told verification fills them', async () => {
  const { page, saved } = profilePage({ backendProfile: { id: 1, nickname: '鹿妈妈', account_type: 'guardian', current_grade: 0, semester: '', region_detail: '', avatar_url: '' } })
  await page.onShow()
  assert.match(page.data.model.footerNote, /实名认证后/)
  assert.equal(page.data.model.rows.find(row => row.id === 'gender').value, '未设置')
  page.handleRow({ currentTarget: { dataset: { action: 'gender' } } })
  page.handleHouseholdChange({ detail: { value: ['北京市', '北京市'] } })
  page.handleRegionChange({ detail: { value: ['浙江省', '杭州市'] } })
  await page.handleSave()
  assert.deepEqual([saved[0].gender, saved[0].householdRegion, saved[0].regionDetail], ['female', '北京市', '浙江省 杭州市'])
})
