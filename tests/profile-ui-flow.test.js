const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const profileForm = require('../utils/profile-form')
function fixture({ rejectSave = false } = {}) {
  let definition; const saved = []; const routes = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/profile-setup/index.js'), 'utf8'), {
    Page(value) { definition = value },
    require(name) {
      if (name.includes('profile-form')) return profileForm
      if (name.includes('referral-context')) return { postProfileUrl: () => '/pages/referral-entry/index' }
      return { async saveCurrentLearningProfile(form) { saved.push({ ...form }); if (rejectSave) throw Error('offline'); return { profileCompleted: true } } }
    },
    wx: { showToast() {}, reLaunch({ url }) { routes.push(url) }, switchTab({ url }) { routes.push(url) } },
    getApp: () => ({ globalData: {} }), setTimeout, clearTimeout
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) { const keys = key.split('.'); let target = this.data; while (keys.length > 1) target = target[keys.shift()]; target[keys[0]] = value }
  } }
  page.data.loading = false
  return { page, saved, routes }
}
test('four-step profile validates the declared identity and persists only at completion', async () => {
  const { page, saved, routes } = fixture()
  await page.handleNext()
  assert.equal(page.data.stepIndex, 0)
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'guardian' } } })
  await page.handleNext()
  assert.equal(page.data.stepIndex, 1)
  assert.equal(saved.length, 0)
  page.data.form.nickname = '小鹿'; page.data.form.gender = 'female'; page.data.form.regionDetail = '上海市'; page.data.form.birthday = '2012-06-15'
  await page.handleNext()
  assert.equal(page.data.stepIndex, 2)
  await page.handleNext()
  assert.equal(page.data.stepIndex, 2)
  page.data.form.schoolName = '测试学校'
  page.handleGradePick({ currentTarget: { dataset: { grade: 12, semester: '下学期' } } })
  await page.handleNext()
  assert.equal(page.data.stepIndex, 3)
  assert.equal(saved.length, 0)
  await page.handleNext()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].grade, 12)
  assert.equal(saved[0].accountType, 'guardian')
  assert.equal(saved[0].semester, '下学期')
  assert.equal(page.data.successSheetVisible, true)
  assert.equal(routes.length, 0)
  page.handleSuccessContinue()
  assert.equal(routes[0], '/pages/referral-entry/index')
})
test('failed profile save stays editable and never displays the success sheet', async () => {
  const { page } = fixture({ rejectSave: true })
  Object.assign(page.data.form, { accountType: 'student', nickname: '小鹿', gender: 'male', birthday: '2012-06-15', regionDetail: '上海', schoolName: '学校' })
  await page.saveProfile()
  assert.equal(page.data.successSheetVisible, false)
  assert.equal(page.data.saving, false)
})

test('choosing "none of the grades" finishes at the school step without a textbook', async () => {
  const { page, saved } = fixture()
  await page.handleNext()
  assert.equal(page.data.stepIndex, 0)
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'student' } } })
  await page.handleNext()
  assert.equal(page.data.stepIndex, 1)
  page.data.form.nickname = '小鹿'; page.data.form.gender = 'female'; page.data.form.regionDetail = '上海'; page.data.form.birthday = '2013-06-15'
  await page.handleNext()
  assert.equal(page.data.stepIndex, 2)
  page.data.form.schoolName = '测试学校'
  page.handleGradePick({ currentTarget: { dataset: { grade: 0 } } })
  assert.equal(page.data.form.grade, 0)
  assert.equal(page.data.activeSteps.length, 3)
  assert.equal(page.data.form.textbookVersion, '')
  await page.handleNext()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].grade, 0)
  assert.equal(saved[0].textbookVersion, '')
  assert.equal(saved[0].semester, '')
  assert.equal(page.data.successSheetVisible, true)
})
