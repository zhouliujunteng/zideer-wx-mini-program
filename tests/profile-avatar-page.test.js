const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { getProfileModel } = require('../services/mock-service')

function profilePage({ backendAvatar = '', saveResultAvatar = 'https://cdn.example/avatar.jpeg' } = {}) {
  let definition
  const saved = []
  const storage = {}
  const identity = {
    loadCurrentUser: async () => ({ profile: { id: 1, nickname: '小鹿', current_grade: 7, semester: '上学期', avatar_url: backendAvatar } }),
    saveCurrentLearningProfile: async (form) => {
      saved.push(form)
      return { profile: { id: 1, avatar_url: saveResultAvatar } }
    },
    isAuthenticationRequired: () => false
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/profile/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => name.includes('identity') ? identity : { getProfileModel },
    wx: {
      showToast() {}, showLoading() {}, hideLoading() {},
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

test('chosen WeChat avatar is uploaded on save and replaced by the backend url', async () => {
  const { page, saved, storage } = profilePage()
  await page.onShow()
  page.handleChooseAvatar({ detail: { avatarUrl: 'http://tmp/wechat-default.jpeg' } })
  assert.equal(page.data.model.avatarSrc, 'http://tmp/wechat-default.jpeg')

  // 选头像时小程序可能触发 onShow，未保存的预览不能被后端空头像覆盖
  await page.onShow()
  assert.equal(page.data.model.avatarSrc, 'http://tmp/wechat-default.jpeg')

  await page.handleSave()
  assert.equal(saved[0].avatarPath, 'http://tmp/wechat-default.jpeg')
  assert.equal(page.data.model.avatarSrc, 'https://cdn.example/avatar.jpeg')
  assert.equal(storage['zhilu-mock-profile-setup'].avatarSrc, undefined)

  await page.handleSave()
  assert.equal(saved[1].avatarPath, '')
})

test('profile avatar ignores stale local copies and shows the backend avatar', async () => {
  const { page, storage } = profilePage({ backendAvatar: 'https://cdn.example/backend.jpeg' })
  storage['zhilu-mock-profile-setup'] = { avatarSrc: 'wxfile://store/old-local.jpeg' }
  await page.onShow()
  assert.equal(page.data.model.avatarSrc, 'https://cdn.example/backend.jpeg')
})
