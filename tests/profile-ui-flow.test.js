const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const profileForm = require('../utils/profile-form')
const accountSwitch = require('../utils/account-switch')
function fixture({ rejectSave = false, pending = null, bindError = null, rewardCredits = 0, user = { profileCompleted: false, profile: {} }, pages = 1 } = {}) {
  let definition; const saved = []; const routes = []; const bound = []; let cleared = 0
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/profile-setup/index.js'), 'utf8'), {
    Page(value) { definition = value },
    require(name) {
      if (name.includes('profile-form')) return profileForm
      if (name.includes('account-switch')) return accountSwitch
      if (name.includes('referral-context')) return {
        postProfileUrl: () => '/pages/home/index',
        readPendingReferral: () => pending,
        clearPendingReferral: () => { cleared += 1 }
      }
      return {
        async saveCurrentLearningProfile(form) { saved.push({ ...form }); if (rejectSave) throw Error('offline'); return { profileCompleted: true } },
        async bindCurrentPromotionCode(code) { bound.push(code); if (bindError) throw bindError; return { alreadyBound: false, referrer: { name: '李老师' }, rewardCredits } },
        async loadCurrentUser() { return user },
        isAuthenticationRequired: () => false,
        attachUiAssets() {}
      }
    },
    wx: { showToast() {}, reLaunch({ url }) { routes.push(url) }, switchTab({ url }) { routes.push(url) }, navigateBack() { routes.push('back') }, navigateTo({ url }) { routes.push(url) }, showModal(options) { routes.push(`modal:${options.title}`); if (options.success) options.success({ confirm: true }) } },
    getApp: () => ({ globalData: {} }), getCurrentPages: () => Array.from({ length: pages }), setTimeout, clearTimeout
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) { const keys = key.split('.'); let target = this.data; while (keys.length > 1) target = target[keys.shift()]; target[keys[0]] = value }
  } }
  page.data.loading = false
  return { page, saved, routes, bound, cleared: () => cleared }
}
test('four-step profile validates the declared identity and persists only at completion', async () => {
  const { page, saved, routes } = fixture()
  await page.handleNext()
  assert.equal(page.data.stepIndex, 0)
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'student' } } })
  assert.equal(page.data.activeSteps.length, 4)
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
  assert.equal(saved[0].accountType, 'student')
  assert.equal(saved[0].semester, '下学期')
  assert.equal(page.data.successSheetVisible, true)
  assert.equal(routes.length, 0)
  page.handleSuccessContinue()
  // 建完档一律回首页：待绑定的邀请码由首页在后台兑现，不再弹「推广伙伴邀请」整页
  assert.equal(routes[0], '/pages/home/index')
})

test('a guardian finishes the profile on the basic step without school, grade or textbook', async () => {
  const { page, saved, bound } = fixture()
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'guardian' } } })
  assert.equal(page.data.activeSteps.map(step => step.id).join(','), 'identity,basic')
  assert.equal(page.data.activeSteps[1].actionLabel, '完成档案')
  await page.handleNext()
  assert.equal(page.data.stepIndex, 1)
  page.data.form.nickname = '鹿妈妈'; page.data.form.gender = 'female'; page.data.form.regionDetail = '上海市'; page.data.form.birthday = '1985-06-15'
  page.updateTextField({ currentTarget: { dataset: { key: 'promotionCode' } }, detail: { value: 'zla2b3c4d5' } })
  await page.handleNext()
  assert.equal(page.data.stepIndex, 1)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].accountType, 'guardian')
  assert.equal(saved[0].grade, 0)
  assert.equal(saved[0].schoolName, '')
  assert.equal(saved[0].semester, '')
  assert.equal(saved[0].textbookVersion, '')
  assert.deepEqual(bound, ['ZLA2B3C4D5'])
  assert.equal(page.data.successSheetVisible, true)
  // 换回学生身份，学校、年级、教材步重新出现
  page.data.successSheetVisible = false
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'student' } } })
  assert.equal(page.data.activeSteps.length, 4)
})

test('the optional promotion code is typed into the form, bound after saving, and then dropped', async () => {
  const { page, bound, cleared } = fixture()
  Object.assign(page.data.form, { accountType: 'student', nickname: '小鹿', gender: 'male', birthday: '2012-06-15', regionDetail: '上海', schoolName: '学校' })
  page.updateTextField({ currentTarget: { dataset: { key: 'promotionCode' } }, detail: { value: 'zla2b3c4d5' } })
  assert.equal(page.data.form.promotionCode, 'ZLA2B3C4D5')
  await page.saveProfile()
  assert.deepEqual(bound, ['ZLA2B3C4D5'])
  assert.equal(cleared(), 1)
  assert.equal(page.data.successSheetVisible, true)
})

test('a scanned promotion code is prefilled for signup and a rejected one never blocks the profile', async () => {
  const { page, bound, cleared } = fixture({
    pending: { code: 'ZLA2B3C4D5', createdAt: Date.now() },
    bindError: Object.assign(Error('不能填写自己的邀请码。'), { terminalReferral: true })
  })
  await page.loadProfile()
  assert.equal(page.data.form.promotionCode, 'ZLA2B3C4D5')
  Object.assign(page.data.form, { accountType: 'student', nickname: '小鹿', gender: 'male', birthday: '2012-06-15', regionDetail: '上海', schoolName: '学校' })
  await page.saveProfile()
  assert.deepEqual(bound, ['ZLA2B3C4D5'])
  assert.equal(cleared(), 1)
  assert.equal(page.data.successSheetVisible, true)
})
test('the invite-code reward is reported on the success sheet only when the campaign paid out', async () => {
  const on = fixture({ rewardCredits: 2000 })
  Object.assign(on.page.data.form, { accountType: 'student', nickname: '小鹿', gender: 'male', birthday: '2012-06-15', regionDetail: '上海', schoolName: '学校', promotionCode: 'ZLA2B3C4D5' })
  await on.page.saveProfile()
  assert.equal(on.page.data.rewardCredits, 2000)

  // 活动关着（后端返回 0）时弹层不提积分，也不能出现「获得 0 积分」
  const off = fixture()
  Object.assign(off.page.data.form, { accountType: 'student', nickname: '小鹿', gender: 'male', birthday: '2012-06-15', regionDetail: '上海', schoolName: '学校', promotionCode: 'ZLA2B3C4D5' })
  await off.page.saveProfile()
  assert.equal(off.page.data.rewardCredits, 0)
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

const guardianProfile = { id: 5, account_type: 'guardian', nickname: '鹿鹿', gender: 'female', region_detail: '上海市', birthday: '1990-03-01', current_grade: 0, semester: '', school_name: '', textbook_version: '', profile_completed_at: '2026-09-20' }

test('a guardian switching to student only fills school, grade and textbook, and returns to 身份与登录', async () => {
  const { page, saved, routes } = fixture({ user: { profileCompleted: true, profile: guardianProfile }, pages: 2 })
  await page.onLoad({ switch: 'student' })
  assert.equal(page.data.switchTitle, '切换为学生')
  assert.equal(page.data.activeSteps.map(step => step.id).join(','), 'school,textbook')
  assert.equal(page.data.activeSteps.at(-1).actionLabel, '完成切换')
  // 家长的年级 0 不能被当成学生选的「都不是」，教材也不预选
  assert.equal(page.data.form.accountType, 'student')
  assert.equal(page.data.form.grade, null)
  assert.equal(page.data.gradeDisplay, '')
  assert.equal(page.data.form.textbookVersion, '')
  await page.handleNext()
  assert.equal(page.data.stepIndex, 0)
  assert.ok(page.data.errors.school && page.data.errors.grade)
  page.data.form.schoolName = '实验中学'
  page.handleGradePick({ currentTarget: { dataset: { grade: 8, semester: '上学期' } } })
  await page.handleNext()
  assert.equal(page.data.stepIndex, 1)
  await page.handleNext()
  assert.equal(saved.length, 0)
  page.handleTextbookPick({ currentTarget: { dataset: { value: '北师大版' } } })
  await page.handleNext()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].accountType, 'student')
  assert.equal(saved[0].grade, 8)
  assert.equal(saved[0].schoolName, '实验中学')
  assert.equal(saved[0].textbookVersion, '北师大版')
  assert.equal(saved[0].nickname, '鹿鹿')
  assert.equal(page.data.successSheetVisible, true)
  page.handleSuccessContinue()
  assert.equal(routes.join(','), 'back')
})

test('switching to student also asks for missing basic info and estimates a school-age grade from the birthday', async () => {
  // 家长的所在城市选填，改成学生要补上（性别 2026-09-26 起选填，缺了不算基本信息不全）
  const profile = { ...guardianProfile, gender: '', region_detail: '', birthday: '2013-05-01' }
  const { page } = fixture({ user: { profileCompleted: true, profile } })
  await page.onLoad({ switch: 'student' })
  assert.equal(page.data.activeSteps.map(step => step.id).join(','), 'basic,school,textbook')
  const genderOnly = fixture({ user: { profileCompleted: true, profile: { ...guardianProfile, gender: '' } } })
  await genderOnly.page.onLoad({ switch: 'student' })
  assert.equal(genderOnly.page.data.activeSteps.map(step => step.id).join(','), 'school,textbook')
  assert.equal(page.data.gradeAutoFilled, true)
  assert.ok(page.data.form.grade >= 1 && page.data.form.grade < 12)
  // 已预估年级也能改成「都不是」，此时不再要求教材
  page.handleGradePick({ currentTarget: { dataset: { grade: 0 } } })
  assert.equal(page.data.activeSteps.map(step => step.id).join(','), 'basic,school')
})

test('switching to guardian from the wizard keeps only the basic step and keeps school, grade and textbook', async () => {
  const student = { id: 6, account_type: 'student', nickname: '小鹿', gender: '', region_detail: '上海市', birthday: '2012-06-15', current_grade: 8, semester: '上学期', school_name: '实验中学', textbook_version: '人教版', profile_completed_at: '2026-09-01' }
  const { page, saved } = fixture({ user: { profileCompleted: true, profile: student } })
  await page.onLoad({ switch: 'guardian' })
  assert.equal(page.data.activeSteps.map(step => step.id).join(','), 'basic')
  assert.equal(page.data.activeSteps[0].actionLabel, '完成切换')
  page.handleGenderPick({ currentTarget: { dataset: { value: 'male' } } })
  await page.handleNext()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].accountType, 'guardian')
  // 2026-09-25 用户规则：学生资料保留，改回学生直接沿用
  assert.equal(saved[0].grade, 8)
  assert.equal(saved[0].semester, '上学期')
  assert.equal(saved[0].schoolName, '实验中学')
  assert.equal(saved[0].textbookVersion, '人教版')
})

test('a guardian who kept student data edits the profile without losing it, and switching back is prefilled', async () => {
  const kept = { ...guardianProfile, current_grade: 8, semester: '上学期', school_name: '实验中学', textbook_version: '人教版' }
  const editing = fixture({ user: { profileCompleted: true, profile: kept } })
  await editing.page.onLoad({ edit: '1' })
  editing.page.setData({ 'form.nickname': '鹿妈妈' })
  await editing.page.saveProfile()
  assert.deepEqual([editing.saved[0].accountType, editing.saved[0].grade, editing.saved[0].schoolName, editing.saved[0].textbookVersion], ['guardian', 8, '实验中学', '人教版'])

  const switching = fixture({ user: { profileCompleted: true, profile: kept } })
  await switching.page.onLoad({ switch: 'student' })
  assert.equal(switching.page.data.form.grade, 8)
  assert.equal(switching.page.data.form.textbookVersion, '人教版')
})

test('a switch link for someone who never finished the profile falls back to the normal wizard', async () => {
  const { page } = fixture()
  await page.onLoad({ switch: 'student' })
  assert.equal(page.data.switching, '')
  assert.equal(page.data.activeSteps[0].id, 'identity')
})

test('editing a guardian profile and picking student asks for a real grade instead of keeping 都不是', async () => {
  const { page } = fixture({ user: { profileCompleted: true, profile: guardianProfile } })
  await page.onLoad({ edit: '1' })
  assert.equal(page.data.form.accountType, 'guardian')
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'student' } } })
  assert.equal(page.data.activeSteps.length, 4)
  assert.equal(page.data.form.grade, null)
  assert.equal(page.validateForm(), '请选择年级')
})

test('a completed student picking 我是家长 while editing is sent to 身份与登录 for real-name verification', async () => {
  const student = { id: 6, account_type: 'student', nickname: '小鹿', gender: 'male', region_detail: '上海市', birthday: '2012-06-15', current_grade: 8, semester: '上学期', school_name: '实验中学', textbook_version: '人教版', profile_completed_at: '2026-09-01' }
  const { page, routes } = fixture({ user: { profileCompleted: true, profile: student } })
  await page.onLoad({ edit: '1' })
  page.handleAccountTypePick({ currentTarget: { dataset: { value: 'guardian' } } })
  assert.equal(page.data.form.accountType, 'student')
  assert.deepEqual(routes, ['modal:切换为家长', '/account/login-identities/index'])
})

// 2026-09-26 用户规则：性别选填；家长的所在城市、生日也选填，实名认证后生日、性别按身份证锁定
test('gender is optional, and a guardian may leave the city and birthday for real-name verification', async () => {
  const guardian = fixture()
  guardian.page.handleAccountTypePick({ currentTarget: { dataset: { value: 'guardian' } } })
  await guardian.page.handleNext()
  guardian.page.data.form.nickname = '鹿妈妈'
  await guardian.page.handleNext()
  assert.equal(guardian.saved.length, 1)
  assert.deepEqual([guardian.saved[0].gender, guardian.saved[0].regionDetail, guardian.saved[0].birthday], ['', '', ''])

  const student = fixture()
  student.page.handleAccountTypePick({ currentTarget: { dataset: { value: 'student' } } })
  await student.page.handleNext()
  Object.assign(student.page.data.form, { nickname: '小鹿', birthday: '2012-06-15' })
  await student.page.handleNext()
  assert.equal(student.page.data.stepIndex, 1)
  assert.ok(student.page.data.errors.region)
  assert.equal(student.page.data.errors.gender, undefined)
  student.page.data.form.regionDetail = '浙江省 杭州市'
  await student.page.handleNext()
  assert.equal(student.page.data.stepIndex, 2)
})

test('a verified birthday and gender are shown locked in the wizard and saved unchanged', async () => {
  const profile = { ...guardianProfile, gender: 'female', birthday: '1988-04-09', birthday_locked: true, gender_locked: true }
  const { page, saved } = fixture({ user: { profileCompleted: true, profile } })
  await page.onLoad({ edit: '1' })
  assert.deepEqual({ ...page.data.locks }, { birthday: true, gender: true })
  page.handleGenderPick({ currentTarget: { dataset: { value: 'male' } } })
  page.chooseBirthday({ detail: { value: '1990-01-01' } })
  assert.equal(page.data.form.gender, 'female')
  assert.equal(page.data.form.birthday, '1988-04-09')
  await page.saveProfile()
  assert.deepEqual([saved[0].gender, saved[0].birthday], ['female', '1988-04-09'])
})
