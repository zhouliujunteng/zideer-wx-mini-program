const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// 申请成为推广伙伴（2026-09-29 用户规则；10-13 起整个流程不刷脸）：基础核验（实名）→ 提交申请，后台审核开通。
const applyPagePath = require.resolve('../agent/partner-apply/index.js')
const identityPath = require.resolve('../services/identity.js')
const servicePath = require.resolve('../services/settlement-service.js')
const assetsPath = require.resolve('../services/ui-assets.js')
const csPath = require.resolve('../utils/customer-service.js')
const view = require('../services/partner-apply-view')

const CONTACT = { id: 1, title: '知鹿客服', corpId: 'ww1', url: 'https://work.weixin.qq.com/kfid/x' }
const overview = (extra = {}) => ({
  status: 'ready',
  promoter: { status: 'inactive', active: false },
  verification: { verified: true, masked_name: '**鹿', id_tail: '123X' },
  application: null,
  ...extra
})

function stub(path, exports) { require.cache[path] = { id: path, filename: path, loaded: true, exports } }
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

// 代理身份（2026-11-10）：默认三种身份都已开通，页面行为与原来只申请推广伙伴时一样
const ALL_ROLES = [{ key: 'love_mom', label: '爱心妈妈' }, { key: 'mentor_mom', label: '导师妈妈' }, { key: 'team_leader', label: '爱心妈妈团团长' }]
const rolesOverview = (extra = {}) => ({ roles: ALL_ROLES, application: null, verified: true, ...extra })

function loadPage({ load, verify, apply, roles, pagePath = applyPagePath, pages } = {}) {
  delete require.cache[pagePath]
  const calls = { verify: [], apply: [], roleApply: [], navigate: [], toast: [], customerService: [] }
  let currentRoles = roles || rolesOverview()
  let current = typeof load === 'function' ? load : async () => load || overview()
  stub(identityPath, {
    submitCurrentGuardianIdentityVerification: async (form) => { calls.verify.push(form); return verify ? verify(form) : { message: '该身份已完成核验', duplicate: true } },
    loadCurrentServiceContacts: async () => ({ status: 'ready', contacts: [CONTACT] }),
    loadAgentApplication: async () => currentRoles,
    submitAgentApplication: async (form) => { calls.roleApply.push(form); return rolesOverview() }
  })
  stub(servicePath, {
    loadPartnerApplication: (...args) => current(...args),
    submitPartnerApplication: async (form) => { calls.apply.push(form); return apply ? apply(form) : { status: 'submitted' } }
  })
  stub(assetsPath, { attachUiAssets() {} })
  stub(csPath, { openCustomerServiceChat: async (contact) => { calls.customerService.push(contact) }, customerServiceErrorMessage: () => 'x' })
  let definition = null
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pages || [{ route: 'agent/settlement/index' }, { route: 'agent/partner-apply/index' }]
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32, width: 87, left: 283 }),
    showToast: (options) => calls.toast.push(options.title),
    navigateTo: (options) => calls.navigate.push(options),
    navigateBack: () => calls.navigate.push('back'),
    redirectTo: (options) => calls.navigate.push(options)
  }
  require(pagePath)
  for (const path of [identityPath, servicePath, assetsPath, csPath]) delete require.cache[path]
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback() }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') instance[key] = value
  instance.onLoad()
  return {
    page: instance, calls,
    setLoad: (next) => { current = typeof next === 'function' ? next : async () => next },
    setRoles: (next) => { currentRoles = next }
  }
}

const ACTIVE = { status: 'active', active: true }

test('the first load draws skeletons; a verified account starts at submitting', async () => {
  const { page } = loadPage()
  assert.equal(page.data.loadState, 'loading')
  await page.onShow()
  assert.equal(page.data.loadState, 'ready')
  assert.deepEqual([page.data.state, page.data.step], ['form', 2], '已实名的直接到提交申请')
  assert.deepEqual(page.data.steps.map((s) => s.state), ['done', 'active'])
  assert.match(page.data.basicDoneHint, /已实名认证（\*\*鹿，尾号 123X）/)
  const wxml = fs.readFileSync(path.join(__dirname, '../agent/partner-apply/index.wxml'), 'utf8')
  assert.match(wxml, /wx:elif="\{\{loadState !== 'ready'\}\}"/, '读到状态前只画骨架')
})

test('a failed first read shows retry instead of the form', async () => {
  const { page } = loadPage({ load: async () => { throw new Error('网络开小差了') } })
  await page.onShow()
  assert.deepEqual([page.data.loadState, page.data.loadError], ['failed', '网络开小差了'])
})

test('basic check → submit, no face check in the application', async () => {
  const unverified = overview({ verification: { verified: false, masked_name: '', id_tail: '' } })
  const { page, calls, setLoad } = loadPage({ load: unverified })
  await page.onShow()
  assert.equal(page.data.step, 1)
  assert.match(page.data.basicHint, /即完成实名认证/)
  page.handleBasicCheck()
  assert.match(page.data.basicError, /姓名/)
  page.handleNameInput({ detail: { value: ' 林小鹿 ' } })
  page.handleIdInput({ detail: { value: '11010519491231002x' } })
  setLoad(overview())
  await page.handleBasicCheck()
  assert.deepEqual(calls.verify, [{ name: '林小鹿', idCardNumber: '11010519491231002X' }])
  assert.deepEqual([page.data.step, page.data.name, page.data.idCard], [2, '', ''], '核验通过后输入框清空，进入第 2 步')
  assert.equal(JSON.stringify(page.data).includes('11010519491231002X'), false, '身份证号不进页面数据')
  assert.equal(calls.navigate.length, 0, '不打开人脸核验页')

  assert.equal(page.data.canSubmit, false)
  page.handlePhoneInput({ detail: { value: '138 1234 5678' } })
  assert.equal(page.data.canSubmit, true)
  page.handleNoteInput({ detail: { value: '家长群推广' } })
  setLoad(overview({ application: { status: 'submitted', masked_name: '**鹿', id_tail: '123X', contact_phone_masked: '138****5678', submitted_at: '2026-09-29T03:00:00Z' } }))
  await page.handleSubmit()
  assert.deepEqual(calls.apply, [{ contactPhone: '13812345678', note: '家长群推广' }])
  assert.equal(page.data.state, 'submitted')
  assert.deepEqual(page.data.applicationRows.map((row) => row.label), ['实名信息', '联系电话', '提交时间'])
  const wxml = fs.readFileSync(path.join(__dirname, '../agent/partner-apply/index.wxml'), 'utf8')
  assert.equal(/刷脸|人脸|account\/liveness/.test(wxml.replace(/<!--[\s\S]*?-->/g, '')), false, '申请页不再提刷脸')
})

test('a verified account typing another identity sees the mismatch and stays on step 1', async () => {
  const { page } = loadPage({ load: overview({ verification: { verified: false } }), verify: async () => { throw Object.assign(new Error('你已完成实名认证，填写的姓名或身份证号与实名记录不一致'), { code: 'IDENTITY_MISMATCH' }) } })
  await page.onShow()
  page.handleNameInput({ detail: { value: '别人' } })
  page.handleIdInput({ detail: { value: '11010519491231002X' } })
  await page.handleBasicCheck()
  assert.equal(page.data.step, 1)
  assert.match(page.data.basicError, /不一致/)
})

test('active, suspended, submitted and rejected applications each get their own card', async () => {
  const active = loadPage({ load: overview({ promoter: ACTIVE }) })
  await active.page.onShow()
  assert.equal(active.page.data.state, 'active')
  active.page.handleGoSettlement()
  assert.deepEqual(active.calls.navigate, ['back'])

  const suspended = loadPage({ load: overview({ promoter: { status: 'suspended', active: false } }) })
  await suspended.page.onShow()
  assert.equal(suspended.page.data.state, 'suspended')
  await suspended.page.handleService()
  assert.equal(suspended.calls.customerService.length, 1)

  const rejected = loadPage({ load: overview({ application: { status: 'rejected', review_note: '请补充推广渠道', reviewed_at: '2026-09-29T05:00:00Z' } }) })
  await rejected.page.onShow()
  assert.deepEqual([rejected.page.data.state, rejected.page.data.step], ['form', 2])
  assert.equal(rejected.page.data.rejectNotice.copy, '原因：请补充推广渠道')
})

test('view helpers: steps, hints and states', () => {
  assert.equal(view.applyState(overview({ promoter: null })), 'form')
  assert.equal(view.applyState(overview({ promoter: ACTIVE })), 'active', '开通了就是推广伙伴，不再要完善信息')
  assert.equal(view.currentStep(overview()), 2)
  assert.equal(view.currentStep(overview({ verification: { verified: false } })), 1)
  assert.match(view.basicHint(), /即完成实名认证/)
  assert.equal(view.rejectNotice({ status: 'submitted' }), null)
  assert.equal(view.PHONE_PATTERN.test(view.normalizePhone('138 0000 0000')), true)
})
test('the application page is registered and the face check is gone everywhere', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  const subpackages = app.subpackages || app.subPackages
  const agent = subpackages.find((item) => item.root === 'agent')
  assert.ok(agent.pages.includes('partner-apply/index'))
  // 2026-10-13 用户规则：人脸识别流程整个去掉，人脸核验页、完善信息页都不注册
  const pages = [...app.pages, ...subpackages.flatMap((item) => item.pages.map((page) => `${item.root}/${page}`))]
  assert.deepEqual(pages.filter((page) => /liveness|identity-check|partner-verify/.test(page)), [])
  for (const dir of ['../account/liveness', '../account/identity-check', '../agent/partner-verify']) assert.equal(fs.existsSync(path.join(__dirname, dir)), false)
  const withdraw = fs.readFileSync(path.join(__dirname, '../agent/withdraw/index.js'), 'utf8')
  assert.match(withdraw, /\/agent\/partner-apply\/index/)
  const promotion = require('../services/promotion-view')
  assert.equal(promotion.buildPartnerNotice(null, 'settlement').url, '/agent/partner-apply/index')
  assert.equal(fs.existsSync(path.join(__dirname, '../services/partner-gate.js')), false, '不再先查实名再找客服')
})

test('代理身份：勾选身份后一起提交身份申请与推广伙伴申请', async () => {
  const { page, calls } = loadPage({ roles: rolesOverview({ roles: [] }) })
  await page.onShow()
  assert.deepEqual(page.data.roleOptions.map((r) => r.key), ['love_mom', 'mentor_mom', 'team_leader'])
  assert.ok(page.data.roleOptions.every((r) => r.work && r.reward), '每种身份写明做什么与分润')
  page.toggleRole({ currentTarget: { dataset: { key: 'mentor_mom' } } })
  page.toggleRole({ currentTarget: { dataset: { key: 'love_mom' } } })
  page.handlePhoneInput({ detail: { value: '13800000000' } })
  assert.equal(page.data.canSubmit, true)
  await page.handleSubmit()
  assert.deepEqual(calls.roleApply, [{ roles: ['love_mom', 'mentor_mom'], contactPhone: '13800000000', note: '' }])
  assert.equal(calls.apply.length, 1, '还没开通推广伙伴的一起申请提现账户')
})

test('代理身份：已是推广伙伴还能申请没开通的身份，必须勾一个；审核中显示申请的身份', async () => {
  const { page, calls, setRoles } = loadPage({
    load: overview({ promoter: ACTIVE }),
    roles: rolesOverview({ roles: [{ key: 'love_mom', label: '爱心妈妈' }] })
  })
  await page.onShow()
  assert.equal(page.data.state, 'form')
  assert.deepEqual(page.data.roleOptions.map((r) => r.key), ['mentor_mom', 'team_leader'])
  page.handlePhoneInput({ detail: { value: '13800000000' } })
  assert.equal(page.data.canSubmit, false, '已是推广伙伴必须勾选身份')
  page.toggleRole({ currentTarget: { dataset: { key: 'team_leader' } } })
  assert.equal(page.data.canSubmit, true)
  setRoles(rolesOverview({ roles: [{ key: 'love_mom', label: '爱心妈妈' }], application: { status: 'submitted', roles: [{ key: 'team_leader', label: '爱心妈妈团团长' }], submittedAt: '2026-11-10T02:00:00Z', proposed: false } }))
  await page.handleSubmit()
  assert.equal(calls.apply.length, 0, '已开通推广伙伴不再申请提现账户')
  assert.equal(page.data.state, 'role-pending')
  assert.equal(page.data.rolePending.roleText, '爱心妈妈团团长')
})

test('代理身份：一个身份都没有的人不勾身份不能提交，灰按钮点了也不发申请；已有身份的可以只申请提现账户', async () => {
  const fresh = loadPage({ roles: rolesOverview({ roles: [] }) })
  await fresh.page.onShow()
  fresh.page.handlePhoneInput({ detail: { value: '13800000000' } })
  assert.equal(fresh.page.data.mustPickRole, true)
  assert.equal(fresh.page.data.canSubmit, false)
  await fresh.page.handleSubmit()
  assert.equal(fresh.calls.roleApply.length, 0)
  assert.equal(fresh.calls.apply.length, 0, '不勾身份时连提现账户申请也不发')

  const held = loadPage({ roles: rolesOverview({ roles: [{ key: 'love_mom', label: '爱心妈妈' }] }) })
  await held.page.onShow()
  held.page.handlePhoneInput({ detail: { value: '13800000000' } })
  assert.equal(held.page.data.mustPickRole, false)
  assert.equal(held.page.data.canSubmit, true)
  await held.page.handleSubmit()
  assert.equal(held.calls.roleApply.length, 0)
  assert.equal(held.calls.apply.length, 1)
})
