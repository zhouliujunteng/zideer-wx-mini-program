const assert = require('node:assert/strict')
const test = require('node:test')

const config = require('../config/index')

const calls = []
const responses = new Map()
let storageToken = 'test-runtime-token'
const navigationCalls = []
let wechatLoginCount = 0

function actionResult(flow, value) {
  responses.set(flow.id, value)
}

function reset() {
  identity.resetPhoneSessionVerification()
  calls.length = 0
  responses.clear()
  storageToken = 'test-runtime-token'
  navigationCalls.length = 0
  wechatLoginCount = 0
}

function flowId(query) {
  const match = String(query).match(/actionFlowId:\s*"([^"]+)"/)
  return match ? match[1] : ''
}

global.wx = {
  getStorageSync(key) { return key === 'zion_runtime_token' ? storageToken : '' },
  removeStorageSync(key) { if (key === 'zion_runtime_token') storageToken = '' },
  setStorageSync(key, value) { if (key === 'zion_runtime_token') storageToken = value },
  reLaunch(options) { navigationCalls.push(options) },
  login(options) {
    wechatLoginCount += 1
    options.success({ code: `wechat-code-${wechatLoginCount}` })
  },
  request(options) {
    if (require('./helpers/verified-phone-session')(options)) return
    if (options.url === `${config.COURSE_PORTAL_ORIGIN}/api/learn/device`) {
      calls.push({ url: options.url, data: options.data, header: options.header })
      if (global.courseHandoffFails) options.fail({ errMsg: 'request:fail timeout' })
      else if (global.courseHandoffReply) options.success(global.courseHandoffReply)
      else options.success({ statusCode: 200, data: { ticket: 'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', expiresAt: Date.now() + 60000 } })
      return
    }
    if (options.url === `${config.COURSE_PORTAL_ORIGIN}/api/course-launch/issue`) {
      calls.push({ url: options.url, data: options.data, header: options.header })
      options.success({ statusCode: 200, data: { launchUrl: `${config.COURSE_PORTAL_ORIGIN}/launch?token=${'test-launch-token'.repeat(3)}` } })
      return
    }
    const query = options.data && options.data.query
    if (String(query).includes('loginWithWechatMiniApp')) {
      calls.push({ id: 'wechat-login', variables: options.data && options.data.variables, query })
      options.success({ statusCode: 200, data: { data: { loginWithWechatMiniApp: { jwt: { token: 'refreshed-runtime-token' } } } } })
      return
    }
    const id = flowId(query)
    calls.push({ id, variables: options.data && options.data.variables, query: options.data && options.data.query })
    const configuredResult = responses.get(id)
    const result = Array.isArray(configuredResult) ? configuredResult.shift() : configuredResult
    if (result instanceof Error) {
      options.success({ statusCode: 200, data: { errors: [{ message: result.message }] } })
      return
    }
    options.success({ statusCode: 200, data: { data: { result } } })
  }
}

const identity = require('../services/identity')

test('credit and growth displays translate runtime codes without changing their underlying values', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, {
    account: {}, batches: [{ source_type: 'redemption', remaining_credits: 2000 }],
    ledger: [{ business_type: 'course_generation_limit_release', entry_type: 'release' }, { business_type: 'unknown_internal_code', entry_type: 'unknown' }]
  })
  const credit = await identity.loadCurrentCreditAccount()
  assert.equal(credit.batches[0].sourceLabel, '兑换码兑换')
  assert.equal(credit.batches[0].source_type, 'redemption')
  assert.equal(credit.ledger[0].businessLabel, '课程超额退回')
  assert.equal(credit.ledger[1].businessLabel, '课程积分变动')
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER, {
    status: 'ready', coinLedger: [{ business_type: 'redemption' }],
    redemptionRecords: [{ status: 'succeeded' }], withdrawals: [{ status: 'processing', net_amount: '5' }, { status: 'wait_user_confirm' }, { status: 'cancelled' }],
    partner: { invitations: [{ scene_type: 'share', status: 'active' }] }
  })
  const growth = await identity.loadCurrentGrowthCenter()
  assert.equal(growth.redemptionRecords[0].statusLabel, '兑换成功')
  assert.equal(growth.coinLedger[0].businessLabel, '兑换码兑换')
  // 金币兑换现金的兑换单用自己的状态说法（2026-09-26）
  assert.deepEqual(growth.withdrawals.map(item => item.statusLabel), ['到账中', '待确认收款', '已取消，金币已退回'])
  assert.equal(growth.withdrawals[0].amountLabel, '¥5.00')
  assert.equal(growth.invitations[0].sceneLabel, '分享邀请')
})

test('only a rejected runtime JWT returns users to login once', async () => {
  reset()
  identity.signOut()
  storageToken = 'expired-token'
  actionResult(config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, new Error('JWT expired'))

  await assert.rejects(
    identity.loadCurrentIdentityVerification(),
    (error) => error && error.code === 'AUTH_REQUIRED'
  )
  assert.equal(storageToken, '')
  assert.deepEqual(navigationCalls.map((call) => call.url), ['/pages/login/login'])

  await assert.rejects(
    identity.loadCurrentIdentityVerification(),
    (error) => error && error.code === 'AUTH_REQUIRED'
  )
  assert.equal(navigationCalls.length, 1)
  // 登录页打开后放开：用户点「先随便看看」离开后，再进要登录的页面还能被带去登录
  navigationCalls[0].complete()
  await assert.rejects(identity.loadCurrentIdentityVerification(), { code: 'AUTH_REQUIRED' })
  assert.equal(navigationCalls.length, 2)
})

test('guests browsing the tab pages are never sent to login and keep any login in progress intact', async () => {
  reset()
  identity.signOut()
  storageToken = ''
  const pages = global.getCurrentPages
  try {
    for (const route of ['pages/home/index', 'pages/learning/index', 'pages/knowledge-universe/index', 'pages/knowledge-map/index', 'pages/me/index', 'learning/library/index', 'pages/splash/index']) {
      global.getCurrentPages = () => [{ route }]
      await assert.rejects(identity.loadCurrentIdentityVerification(), { code: 'AUTH_REQUIRED' })
    }
    assert.deepEqual(navigationCalls, [])
    assert.equal(calls.length, 0)
    // 要登录的页面照旧带去登录
    global.getCurrentPages = () => [{ route: 'commerce/orders/index' }]
    await assert.rejects(identity.loadOrders(), { code: 'AUTH_REQUIRED' })
    assert.deepEqual(navigationCalls.map((call) => call.url), ['/pages/login/login'])
  } finally {
    global.getCurrentPages = pages
    navigationCalls.forEach((call) => call.complete && call.complete())
  }
})

test('an expired session on a tab page is dropped quietly so the page can show the guest state', async () => {
  reset()
  const pages = global.getCurrentPages
  global.getCurrentPages = () => [{ route: 'pages/me/index' }]
  try {
    storageToken = 'expired-token'
    actionResult(config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, new Error('JWT expired'))
    await assert.rejects(identity.loadCurrentIdentityVerification(), { code: 'AUTH_REQUIRED' })
    assert.equal(storageToken, '')
    assert.deepEqual(navigationCalls, [])
    assert.equal(identity.hasSession(), false)
  } finally {
    global.getCurrentPages = pages
  }
})

test('a rejected runtime JWT renews through WeChat once and retries the original flow', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, [
    new Error('JWT expired'),
    { status: 'ready', verification: null, roles: ['student'] }
  ])

  const result = await identity.loadCurrentIdentityVerification()

  assert.deepEqual(result, { verification: null, roles: ['student'] })
  assert.equal(wechatLoginCount, 1)
  assert.equal(storageToken, 'refreshed-runtime-token')
  assert.equal(navigationCalls.length, 0)
  assert.deepEqual(calls.map((item) => item.id), [
    config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION.id,
    'wechat-login',
    config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION.id
  ])
})

test('a business flow unauthenticated status does not erase an otherwise valid runtime token', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, { status: 'unauthenticated' })

  await assert.rejects(identity.loadCurrentIdentityVerification(), /请先登录后查看实名认证状态/)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

test('an authorization error does not erase an otherwise valid runtime token', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, new Error('authorization denied for this role'))

  await assert.rejects(identity.loadCurrentIdentityVerification(), /authorization denied/)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

test('a generic GraphQL unauthenticated error does not discard a fresh runtime token', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP, new Error('Unauthenticated'))

  await assert.rejects(identity.loadKnowledgeMap('Mathematics'), /Unauthenticated/)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

test('knowledge map initializes a newly authenticated account once before retrying', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP, [
    { status: 'unauthenticated' },
    {
      status: 'ready',
      datasetKey: 'china-k12-tokenmap-135386badef4',
      subjects: [{ id: 1, subject_key: 'Mathematics', display_name: '数学', display_order: 1 }],
      topics: [],
      dependencies: [],
      masteries: []
    }
  ])
  actionResult(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER, 101)
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {
    id: 201, nickname: '小鹿', current_grade: 8, profile_completed_at: '2026-09-05T00:00:00Z'
  })

  const map = await identity.loadKnowledgeMap('Mathematics')

  assert.equal(map.activeSubjectKey, 'Mathematics')
  assert.deepEqual(calls.map((item) => item.id), [
    config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP.id,
    config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id,
    config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE.id,
    config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP.id
  ])
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

test('session restoration keeps its token when initialization has a non-authentication error', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER, new Error('temporary service unavailable'))

  const user = await identity.restoreAuthenticatedUser()
  assert.equal(user, null)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

function lastCall(flow) {
  const call = calls.filter((item) => item.id === flow.id).at(-1)
  assert.ok(call, `expected ${flow.id} to be invoked`)
  return call
}

test('first-user initialization and profile save use authoritative action flows', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER, 101)
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {
    id: 201, nickname: '小鹿', current_grade: 8, semester: '上学期', profile_completed_at: '2026-09-05T00:00:00Z'
  })

  const user = await identity.restoreAuthenticatedUser()
  assert.equal(user.userPrincipalId, 101)
  assert.equal(user.userProfileId, 201)
  assert.equal(user.profileCompleted, true)

  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE, 201)
  await identity.saveCurrentLearningProfile({
    nickname: '小鹿', grade: 8, schoolStage: '初中', semester: '上学期', schoolName: '测试学校', textbookVersion: '人教版', regionDetail: '深圳'
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE).variables.args, {
    nickname: '小鹿', grade: 8, school_stage: '初中', semester: '上学期', school_name: '测试学校', textbook_version: '人教版', region_detail: '深圳'
  })
})

// 2026-09-26 用户规则：性别、户籍地选填，没选不提交；实名后生日、性别、户籍地由后端按身份证写入
test('optional gender is omitted when empty, household region is sent, and locked values confirm the save', async () => {
  reset()
  const form = { accountType: 'guardian', nickname: '鹿妈妈', grade: 0, semester: '', regionDetail: '', birthday: '', gender: '', householdRegion: ' 浙江省 温州市 ' }
  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE, 201)
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, { id: 201, nickname: '鹿妈妈', account_type: 'guardian', current_grade: 0, semester: '', household_region: '浙江省 温州市', profile_completed_at: '2026-09-05T00:00:00Z' })
  const saved = await identity.saveCurrentLearningProfile(form)
  assert.deepEqual({ ...lastCall(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE).variables.args.personal_details }, { account_type: 'guardian', birthday: null, household_region: '浙江省 温州市' })
  assert.equal(saved.profile.household_region, '浙江省 温州市')

  // 已实名：页面提交的空生日由后端改成身份证上的日期，不能因此判成「保存结果未确认」
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, { id: 201, nickname: '鹿妈妈', account_type: 'guardian', current_grade: 0, semester: '', gender: 'female', birthday: '1988-04-09', household_region: '浙江省 温州市', birthday_locked: true, gender_locked: true, household_region_locked: true, profile_completed_at: '2026-09-05T00:00:00Z' })
  const locked = await identity.saveCurrentLearningProfile({ ...form, gender: 'male' })
  assert.deepEqual([locked.profile.birthday, locked.profile.gender, locked.profile.birthday_locked, locked.profile.gender_locked, locked.profile.household_region_locked], ['1988-04-09', 'female', true, true, true])
  await assert.rejects(() => identity.saveCurrentLearningProfile({ ...form, gender: 'unknown' }), /请选择性别/)
})

test('service contacts only accept complete backend-issued enterprise WeChat chat entries', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_SERVICE_CONTACTS, {
    status: 'ready',
    contacts: [
      { id: 1, contactType: 'enterprise_wechat_link', title: '课程顾问', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' },
      { id: 2, contactType: 'enterprise_wechat_link', title: '缺少企业ID', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' },
      { id: 3, contactType: 'enterprise_wechat_link', title: '错误域名', corpId: 'ww1234567890abcdef', targetRef: 'https://service.example.com/contact' },
      { id: 4, contactType: 'meeting_link', title: '错误类型', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' },
      { id: 5, contactType: 'enterprise_wechat_link', title: '无效企业ID', corpId: 'not-a-corp-id', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' }
    ]
  })

  const result = await identity.loadCurrentServiceContacts()
  assert.deepEqual(result, {
    status: 'ready',
    contacts: [{ id: '1', contactType: 'enterprise_wechat_link', title: '课程顾问', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef' }]
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_SERVICE_CONTACTS).variables.args, {})
})

test('service contact profile and empty states are non-navigating fallbacks', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_SERVICE_CONTACTS, { status: 'profile_incomplete', contacts: [] })
  assert.deepEqual(await identity.loadCurrentServiceContacts(), { status: 'profile_incomplete', contacts: [] })

  actionResult(config.ACTION_FLOWS.GET_CURRENT_SERVICE_CONTACTS, { status: 'no_active_contacts', contacts: [] })
  assert.deepEqual(await identity.loadCurrentServiceContacts(), { status: 'no_active_contacts', contacts: [] })
  assert.equal(navigationCalls.length, 0)
})

test('learning-plan candidates use only the selected topic and preserve server-owned state', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLAN_CANDIDATES, {
    status: 'ready',
    candidates: [
      { id: 71, topicId: 81, topicName: '一次函数', subjectKey: 'Mathematics', subjectName: '数学', status: 'active', source: 'knowledge_map', createdAt: '2026-09-06T00:00:00Z' },
      { id: 72, topicId: 'bad', topicName: '应丢弃' }
    ]
  })

  const candidates = await identity.loadCurrentTopicCandidates()
  assert.deepEqual(candidates, {
    status: 'ready',
    candidates: [{ id: '71', topicId: '81', topicName: '一次函数', subjectKey: 'Mathematics', subjectName: '数学', status: 'active', source: 'knowledge_map', createdAt: '2026-09-06T00:00:00Z' }]
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLAN_CANDIDATES).variables.args, {})

  actionResult(config.ACTION_FLOWS.ADD_CURRENT_LEARNING_PLAN_CANDIDATE, {
    status: 'added', candidate: { id: 71, topicId: 81, status: 'active', source: 'knowledge_map', createdAt: '2026-09-06T00:00:00Z' }
  })
  assert.equal((await identity.addCurrentTopicCandidate('81')).status, 'added')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.ADD_CURRENT_LEARNING_PLAN_CANDIDATE).variables.args, { topic_id: 81 })

  actionResult(config.ACTION_FLOWS.REMOVE_CURRENT_LEARNING_PLAN_CANDIDATE, { status: 'removed' })
  assert.equal((await identity.removeCurrentTopicCandidate(81)).status, 'removed')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.REMOVE_CURRENT_LEARNING_PLAN_CANDIDATE).variables.args, { topic_id: 81 })
})

test('learning-plan candidate errors do not alter a valid login session', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.ADD_CURRENT_LEARNING_PLAN_CANDIDATE, { status: 'topic_out_of_scope' })
  await assert.rejects(identity.addCurrentTopicCandidate(81), /不在当前年级学习范围/)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)

  reset()
  await assert.rejects(identity.addCurrentTopicCandidate(0), /知识点信息不完整/)
  await assert.rejects(identity.removeCurrentTopicCandidate('bad'), /知识点信息不完整/)
  assert.equal(calls.length, 0)
})

test('course generation quotes and confirms use distinct idempotency keys', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.CREATE_CURRENT_COURSE_GENERATION_QUOTE, {
    status: 'quoted', quoteId: 41, estimatedLowerCredits: 2.1, estimatedUpperCredits: 3.2, frozenTargetCredits: 3.2
  })
  actionResult(config.ACTION_FLOWS.CONFIRM_CURRENT_COURSE_GENERATION, {
    status: 'queued', courseInstanceId: 51, generationJobId: 61, settlementId: 71, frozenCredits: 3.2
  })

  const quote = await identity.createCurrentCourseGenerationQuote(11, 'quote-key')
  assert.equal(quote.quoteId, '41')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CREATE_CURRENT_COURSE_GENERATION_QUOTE).variables.args, {
    plan_item_id: 11, idempotency_key: 'quote-key'
  })
  const confirmed = await identity.confirmCurrentCourseGeneration(quote.quoteId, 'confirm-key')
  assert.equal(confirmed.generationJobId, '61')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CONFIRM_CURRENT_COURSE_GENERATION).variables.args, {
    quote_id: 41, idempotency_key: 'confirm-key'
  })
})

test('course entry carries a single-use ticket, fails loudly without one, and acceptance retains its authorized entry', async () => {
  reset()

  const courseUrl = await identity.createCourseLaunchUrl(51)
  assert.equal(courseUrl, `${config.COURSE_PORTAL_ORIGIN}/api/learn/entry?course=51&layout=focus&ticket=TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT`)
  assert.deepEqual(calls[0].data, { operation: 'handoff', courseInstanceId: 51 })
  assert.equal(calls[0].header.authorization, 'Bearer test-runtime-token')

  const libraryId = 'a'.repeat(32)
  const libraryUrl = await identity.createLibraryCourseLaunchUrl(libraryId)
  assert.equal(libraryUrl, `${config.COURSE_PORTAL_ORIGIN}/api/learn/entry?library=${libraryId}&layout=focus&ticket=TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT`)
  assert.deepEqual(calls[1].data, { operation: 'handoff', libraryCourseId: libraryId })

  // 定制课程：课程详情页点了某一页，入口带上这一页（课程服务从这一页开始）；不像页面 id 的值不带
  const agentUrl = await identity.createAgentCourseLaunchUrl('stage-abc123', 'scene_a1')
  assert.equal(agentUrl, `${config.COURSE_PORTAL_ORIGIN}/api/learn/entry?agent=stage-abc123&scene=scene_a1&layout=focus&ticket=TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT`)
  assert.deepEqual(calls[2].data, { operation: 'handoff', agentCourseId: 'stage-abc123' })
  assert.equal(await identity.createAgentCourseLaunchUrl('stage-abc123', '../x'), `${config.COURSE_PORTAL_ORIGIN}/api/learn/entry?agent=stage-abc123&layout=focus&ticket=TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT`)

  // 换不到入场券就报错，由课程页重试；不再回落到不含凭证的课程地址（学习设备确认已下线，网页没有别的登录方式）
  global.courseHandoffFails = true
  try {
    await assert.rejects(identity.createCourseLaunchUrl(51), /课程服务响应超时/)
  } finally {
    global.courseHandoffFails = false
  }
  for (const [reply, message] of [
    [{ statusCode: 403, data: { code: 'MEMBERSHIP_REQUIRED' } }, /暂无会员课程学习权限/],
    [{ statusCode: 403, data: { code: 'COURSE_ACCESS_DENIED' } }, /暂不可访问这门课程/],
    [{ statusCode: 200, data: { ticket: 'short' } }, /课程入口暂时不可用/]
  ]) {
    global.courseHandoffReply = reply
    try {
      await assert.rejects(identity.createLibraryCourseLaunchUrl(libraryId), message)
    } finally {
      global.courseHandoffReply = undefined
    }
  }
  calls.length = 0

  const acceptanceUrl = await identity.createAcceptanceLaunchUrl(51, 61)
  assert.equal(acceptanceUrl, `${config.COURSE_PORTAL_ORIGIN}/launch?token=${'test-launch-token'.repeat(3)}`)
  assert.deepEqual(calls[0].data, { courseInstanceId: 51, targetScene: 'acceptance', acceptanceId: 61 })
  assert.equal(calls[0].header.authorization, 'Bearer test-runtime-token')
  assert.equal(calls.length, 1)
})

test('course quote failures preserve actionable server codes for page recovery', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.CONFIRM_CURRENT_COURSE_GENERATION, { status: 'COURSE_DISPATCH_UNCONFIRMED' })
  await assert.rejects(identity.confirmCurrentCourseGeneration(41, 'confirm-unreceived'), (error) => {
    assert.equal(error.code, 'COURSE_DISPATCH_UNCONFIRMED')
    assert.match(error.message, /暂未确认课程服务收到请求/)
    return true
  })
  actionResult(config.ACTION_FLOWS.CONFIRM_CURRENT_COURSE_GENERATION, { status: 'COURSE_ALREADY_REQUESTED' })
  await assert.rejects(identity.confirmCurrentCourseGeneration(41, 'confirm-competing'), (error) => {
    assert.equal(error.code, 'COURSE_ALREADY_REQUESTED')
    assert.match(error.message, /已创建课程/)
    return true
  })
  actionResult(config.ACTION_FLOWS.CONFIRM_CURRENT_COURSE_GENERATION, { status: 'QUOTE_EXPIRED' })
  await assert.rejects(identity.confirmCurrentCourseGeneration(41, 'confirm-expired'), (error) => {
    assert.equal(error.code, 'QUOTE_EXPIRED')
    assert.match(error.message, /报价已过期/)
    return true
  })
  actionResult(config.ACTION_FLOWS.CREATE_CURRENT_COURSE_GENERATION_QUOTE, { status: 'PLAN_ITEM_LOCKED' })
  await assert.rejects(identity.createCurrentCourseGenerationQuote(11, 'quote-locked'), (error) => {
    assert.equal(error.code, 'PLAN_ITEM_LOCKED')
    assert.match(error.message, /尚未解锁/)
    return true
  })
})

test('a signed-out learner never receives a public creator-page fallback', async () => {
  reset()
  storageToken = ''
  await assert.rejects(identity.createCourseLaunchUrl(51), (error) => error.code === 'AUTH_REQUIRED')
  assert.equal(calls.length, 0)
})

test('purchase, family binding, redemption, notifications and audio authorization validate their contracts', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.CREATE_SECURE_CREDIT_ORDER, {
    order_id: 81, order_no: 'ZL-81', amount: '0.01', description: '测试积分包'
  })
  actionResult(config.ACTION_FLOWS.CREATE_CURRENT_STUDENT_BINDING_CODE, {
    status: 'ready', code: '12345678', expiresAt: '2026-09-06T00:00:00Z', bindingCodeId: 91
  })
  actionResult(config.ACTION_FLOWS.BIND_CURRENT_GUARDIAN_TO_STUDENT, { status: 'bound', relation: { id: 92 } })
  actionResult(config.ACTION_FLOWS.REDEEM_CURRENT_STUDENT_CODE, { ok: true, status: 'succeeded', record_no: 'R-1' })
  actionResult(config.ACTION_FLOWS.MARK_CURRENT_NOTIFICATION_READ, { status: 'ready', updated: true })
  actionResult(config.ACTION_FLOWS.AUTHORIZE_ACCEPTANCE_AUDIO, { authorized: true, asset: { id: 5, url: 'https://assets.example/audio' } })

  await identity.createSecureCreditOrder(4, 3, 'order-key')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CREATE_SECURE_CREDIT_ORDER).variables.args, {
    product_version_id: 4, beneficiary_student_id: 3, idempotency_key: 'order-key'
  })
  assert.equal((await identity.createCurrentStudentBindingCode()).code, '12345678')
  assert.deepEqual(await identity.bindCurrentGuardianToStudent('1234 5678'), { id: 92 })
  assert.equal((await identity.redeemCurrentStudentCode('zl-test-01', 3, 'redeem-key')).record_no, 'R-1')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.REDEEM_CURRENT_STUDENT_CODE).variables.args, {
    code: 'ZL-TEST-01', beneficiary_student_id: 3, idempotency_key: 'redeem-key'
  })
  assert.equal(await identity.markCurrentNotificationRead(99), true)
  assert.equal((await identity.authorizeAcceptanceAudio(5)).url, 'https://assets.example/audio')
})

test('invalid identifiers are rejected before a server request is made', async () => {
  reset()
  await assert.rejects(identity.createCurrentCourseGenerationQuote(0), /课程任务信息不完整/)
  await assert.rejects(identity.createSecureCreditOrder(0, 1), /商品版本无效/)
  await assert.rejects(identity.bindCurrentGuardianToStudent('bad'), /8 位数字/)
  await assert.rejects(identity.redeemCurrentStudentCode('bad', 1), /有效的兑换码/)
  await assert.rejects(identity.authorizeAcceptanceAudio(0), /音频标识无效/)
  assert.equal(calls.length, 0)
})

test('redemption safety rejections present one safe user-facing message', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.REDEEM_CURRENT_STUDENT_CODE, new Error('REDEMPTION_CODE_UNAVAILABLE'))

  await assert.rejects(
    identity.redeemCurrentStudentCode('zl-test-01', 3, 'redeem-key'),
    /兑换码无效、已过期或暂不适用于当前学生/
  )
})

test('guardian identity submission keeps the raw card transient and maps server outcomes', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION, {
    success: true,
    duplicate: false,
    message: '实名认证成功',
    recordId: 93,
    maskedIdCard: '123456********7890'
  })

  const result = await identity.submitCurrentGuardianIdentityVerification({
    name: '测试家长',
    idCardNumber: '11010519491231002X'
  })

  assert.equal(result.recordId, '93')
  assert.equal(result.maskedIdCard, '123456********7890')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION).variables.args, {
    name: '测试家长',
    idCardNumber: '11010519491231002X'
  })

  reset()
  await assert.rejects(identity.submitCurrentGuardianIdentityVerification({ name: '', idCardNumber: '11010519491231002X' }), /请输入有效姓名/)
  await assert.rejects(identity.submitCurrentGuardianIdentityVerification({ name: '测试家长', idCardNumber: 'invalid' }), /18 位身份证号/)
  assert.equal(calls.length, 0)
})

// 2026-09-29 起普通实名一步完成；刷脸只在申请推广伙伴时做，视频以 base64 随请求发出、不经过文件上传
test('the partner face check sends the video inline and maps each outcome for the page', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION, { success: true, duplicate: false, message: '实名认证成功', verify: null })
  assert.equal('livenessRequired' in (await identity.submitCurrentGuardianIdentityVerification({ name: '测试家长', idCardNumber: '11010519491231002X' })), false)
  // 已实名的账号填了别人的证：带上错误码，申请页据此提示
  reset()
  actionResult(config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION, { success: false, message: '你已完成实名认证，填写的姓名或身份证号与实名记录不一致', verify: 'identity_mismatch' })
  await assert.rejects(identity.submitCurrentGuardianIdentityVerification({ name: '测试家长', idCardNumber: '11010519491231002X' }),
    (error) => error.code === 'IDENTITY_MISMATCH' && /不一致/.test(error.message))

  // 2026-10-13 起人脸识别流程整个去掉：小程序不再有刷脸接口
  assert.equal(identity.submitPartnerLiveness, undefined)
  assert.equal(config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_LIVENESS, undefined)
})

test('promotion assignment and family-facing flows keep identity and idempotency server-side', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.SUBMIT_PROMOTER_ASSIGNMENT_REQUEST, { request: { id: 701, status: 'pending' } })
  actionResult(config.ACTION_FLOWS.CANCEL_CURRENT_PROMOTER_ASSIGNMENT_REQUEST, { request: { id: 701, status: 'cancelled' } })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_FAMILY_RELATIONS, {
    self: { id: 201 }, students: [{ id: 801, student_profile: { id: 202, nickname: '小鹿' } }], guardians: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, { status: 'ready', verification: { status: 'verified' }, roles: ['student'] })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_DASHBOARD, { status: 'ready', children: [] })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_LEARNING_FEED, { status: 'ready', children: [] })
  actionResult(config.ACTION_FLOWS.GET_AUTHORIZED_TOPIC_LEARNING_REPORTS, { own: { id: 202, topic_learning_reports: [] }, children: [] })

  await identity.submitPromoterAssignmentRequest({
    contact: '测试联系方式', region: '深圳', availableTime: '周末', idempotencyKey: 'assignment-key'
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SUBMIT_PROMOTER_ASSIGNMENT_REQUEST).variables.args, {
    contact: '测试联系方式', region: '深圳', available_time: '周末', idempotency_key: 'assignment-key'
  })
  await identity.cancelPromoterAssignmentRequest('cancel-key')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CANCEL_CURRENT_PROMOTER_ASSIGNMENT_REQUEST).variables.args, { idempotency_key: 'cancel-key' })
  assert.equal((await identity.loadCurrentFamilyRelations()).students[0].student.nickname, '小鹿')
  assert.equal((await identity.loadCurrentIdentityVerification()).verification.status, 'verified')
  assert.deepEqual((await identity.loadGuardianDashboard()).children, [])
  assert.deepEqual((await identity.loadGuardianLearningFeed()).children, [])
  assert.equal((await identity.loadAuthorizedTopicLearningReports()).students[0].source, 'self')
})

test('every bound-student view carries the avatar the backend signs for this load', async () => {
  reset()
  const avatar = { url: 'https://fz-zion-static.example/avatar.jpeg' }
  actionResult(config.ACTION_FLOWS.GET_CURRENT_FAMILY_RELATIONS, {
    self: { id: 201 },
    students: [{ id: 801, student_profile: { id: 202, nickname: '小鹿', avatar } }],
    guardians: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_DASHBOARD, {
    status: 'ready', children: [{ id: 801, student_profile: { id: 202, nickname: '小鹿', avatar } }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_LEARNING_FEED, {
    status: 'ready', children: [{ id: 801, student_profile: { id: 202, nickname: '小鹿', avatar } }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_TEACHER_WORKSPACE, {
    status: 'ready',
    teacher: { id: 11, name: '王老师', teacherNo: 'T102938' },
    students: [{ bindingId: 7, studentProfileId: 202, name: '小鹿', avatarUrl: avatar.url }]
  })

  assert.equal((await identity.loadCurrentFamilyRelations()).students[0].avatarUrl, avatar.url)
  assert.equal((await identity.loadGuardianDashboard()).children[0].avatarUrl, avatar.url)
  assert.equal((await identity.loadGuardianLearningFeed()).children[0].avatarUrl, avatar.url)
  assert.equal((await identity.loadCurrentTeacherWorkspace()).students[0].avatarUrl, avatar.url)
})

test('a student without an avatar falls back to an empty string, never undefined', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_FAMILY_RELATIONS, {
    self: { id: 201 }, students: [{ id: 801, student_profile: { id: 202, nickname: '小鹿' } }], guardians: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_TEACHER_WORKSPACE, {
    status: 'ready', teacher: { id: 11, name: '王老师' }, students: [{ bindingId: 7, studentProfileId: 202, name: '小鹿' }]
  })

  assert.equal((await identity.loadCurrentFamilyRelations()).students[0].avatarUrl, '')
  assert.equal((await identity.loadCurrentTeacherWorkspace()).students[0].avatarUrl, '')
})

test('promotion invitations and attribution only send a token, safe path, scene and idempotency key', async () => {
  reset()
  const token = 'a'.repeat(43)
  actionResult(config.ACTION_FLOWS.CREATE_CURRENT_PROMOTER_INVITATION, {
    invitation: { id: 801, invitation_code: 'ZLA-test', status: 'active' },
    share: { token, path: `/pages/referral-entry/index?token=${token}` },
    reused: false
  })
  const invitation = await identity.createCurrentPromoterInvitation({
    targetPath: '/pages/home/index', sceneType: 'share', idempotencyKey: 'invite-key'
  })
  assert.equal(invitation.sharePath, `/pages/referral-entry/index?token=${token}`)
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CREATE_CURRENT_PROMOTER_INVITATION).variables.args, {
    target_path: '/pages/home/index', scene_type: 'share', idempotency_key: 'invite-key'
  })

  actionResult(config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE, {
    touch: { id: 901 }, attribution: { id: 902 }, reused: false
  })
  await identity.recordCurrentPromotionTouchAndAttribute({ invitationToken: token, sourceType: 'share', idempotencyKey: 'touch-key' })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE).variables.args, {
    invitation_token: token, source_type: 'share', idempotency_key: 'touch-key'
  })

  actionResult(config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE, {
    status: 'deep_gift_granted',
    deep_gift: true,
    reused: false,
    grant: { id: 903, grantNo: 'DGR-link', status: 'available' },
    touch: { id: 904, result: 'deep_assessment_claimed' }
  })
  const deepGift = await identity.recordCurrentPromotionTouchAndAttribute({ invitationToken: token, sourceType: 'share', idempotencyKey: 'deep-touch-key' })
  assert.equal(deepGift.isDeepGift, true)
  assert.equal(deepGift.grant.id, 903)
  assert.equal(deepGift.attribution, null)
  assert.deepEqual(lastCall(config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE).variables.args, {
    invitation_token: token, source_type: 'share', idempotency_key: 'deep-touch-key'
  })

  reset()
  await assert.rejects(identity.createCurrentPromoterInvitation({ targetPath: 'https://attacker.example' }), /落地页无效/)
  await assert.rejects(identity.recordCurrentPromotionTouchAndAttribute({ invitationToken: 'invalid' }), /邀请链接无效/)
  assert.equal(calls.length, 0)

  reset()
  actionResult(config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE, { status: 'invitation_expired' })
  await assert.rejects(
    identity.recordCurrentPromotionTouchAndAttribute({ invitationToken: token, sourceType: 'share', idempotencyKey: 'expired-key' }),
    (error) => error.terminalReferral === true && /已过期/.test(error.message)
  )

  reset()
  actionResult(config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE, { status: 'deep_gift_consumed' })
  await assert.rejects(
    identity.recordCurrentPromotionTouchAndAttribute({ invitationToken: token, sourceType: 'share', idempotencyKey: 'consumed-key' }),
    (error) => error.terminalReferral === true && /已被领取/.test(error.message)
  )
})

test('read-only student, assessment, credit and growth views invoke their current-user flows', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP, {
    status: 'ready', grade: 8,
    datasetKey: 'china-k12-tokenmap-135386badef4',
    subjects: [{ id: 1, subject_key: 'Mathematics', display_name: '数学', display_order: 1 }],
    topics: [{ id: 11, subject_id: 1, display_name: '一次函数', centrality: 0.6 }],
    masteries: [{ knowledge_topic_id: 11, status: 'learning', evidence_count: 2 }],
    dependencies: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_CENTER, {
    status: 'ready', profile: { id: 201 },
    subjects: [{ key: 'Mathematics', questionCount: 12 }],
    attempts: [{ id: 21, subjectKey: 'Mathematics', status: 'draft' }]
  })
  actionResult(config.ACTION_FLOWS.GET_CREDIT_PRODUCTS, {
    products: [{ id: 31, display_name: '体验积分包', amount: '0.01', credit_amount: '2.5', estimated_course_count: 1, credit_product: { product_code: 'TRY' } }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, {
    studentId: 201,
    account: { status: 'active', available_credits: '2.5', frozen_credits: '1', consumed_credits: '0', expired_credits: '0' },
    batches: [{ remaining_credits: '2.5', source_type: 'purchase' }],
    ledger: [{ credits: '2.5', business_type: 'purchase' }],
    orders: [{ id: 41, amount: '0.01', status: '待支付', beneficiary_student: { nickname: '小鹿' } }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER, {
    status: 'ready', coinAccount: { status: 'active', available_coins: 12, frozen_coins: 1 }, partner: { clients: [{ id: 51 }] }
  })

  const map = await identity.loadKnowledgeMap('Mathematics')
  assert.equal(map.activeSubjectKey, 'Mathematics')
  assert.equal(map.nodes[0].status, 'learning')
  assert.equal(map.nodes[0].evidence, '已汇集 2 条学习证据 · 测评 0 · 课程 0')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP).variables.args, {})

  const center = await identity.loadAssessmentCenter()
  assert.equal(center.subjects[0].name, '数学')
  assert.equal(center.attempts[0].id, '21')
  assert.equal(center.attempts[0].statusLabel, '进行中')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_CENTER).variables.args, {})

  const products = await identity.loadCreditProducts()
  assert.deepEqual(products.products[0], {
    id: 31, productCode: 'TRY', name: '体验积分包', description: undefined, amount: '0.01', memberAmount: '', payableAmount: '0.01', memberPriceApplied: false, credits: '3', estimatedCourseCount: 1,
    validityRule: {}, serviceRule: {}, refundRule: {}, subjectScope: []
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CREDIT_PRODUCTS).variables.args, {})

  const account = await identity.loadCurrentCreditAccount()
  assert.equal(account.account.available, '3')
  assert.equal(account.orders[0].amountDisplay, '0.01')
  assert.equal(account.orders[0].beneficiaryName, '小鹿')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT).variables.args, {})

  const growth = await identity.loadCurrentGrowthCenter()
  assert.equal(growth.coinAccount.available, 12)
  assert.equal(growth.clients[0].id, 51)
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER).variables.args, {})
})

test('assessment center and learning plans put the newest server records first', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_CENTER, {
    status: 'ready', profile: { id: 201 }, subjects: [],
    attempts: [
      { id: 11, subjectKey: 'Mathematics', status: 'submitted', submitted_at: '2026-09-01T00:00:00Z' },
      { id: 12, subjectKey: 'Mathematics', status: 'completed', completed_at: '2026-09-07T00:00:00Z' }
    ]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLANS, {
    status: 'ready', profile: { id: 201 },
    plans: [
      { id: 31, status: 'active', generated_at: '2026-09-01T00:00:00Z', items: [] },
      { id: 32, status: 'active', generated_at: '2026-09-07T00:00:00Z', items: [] }
    ]
  })

  const assessment = await identity.loadAssessmentCenter()
  const plans = await identity.loadCurrentLearningPlans()

  assert.deepEqual(assessment.attempts.map((item) => item.id), ['12', '11'])
  assert.deepEqual(plans.plans.map((item) => item.id), ['32', '31'])
})

test('learning task rows use course generation and settlement instead of stale plan estimates', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER, 901)
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {
    id: 902, nickname: '测试学生', profile_completed_at: '2026-09-07T00:00:00Z'
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLANS, {
    status: 'ready', profile: { id: 902 }, plans: [{ id: 501, status: 'active', items: [
      { id: 1, status: 'available', estimatedCredits: 1, courseInstances: [{ id: 10, status: 'planned', generationJob: { status: 'queued' }, creditSettlement: { frozenCredits: 10, actualCredits: null } }] },
      { id: 2, status: 'available', estimatedCredits: 1, courseInstances: [{ id: 11, status: 'ready', contentVersionRef: 'saved-course', creditSettlement: { frozenCredits: 10, actualCredits: 8, returnedCredits: 2 } }] },
      { id: 3, status: 'available', estimatedCredits: 1, courseInstances: [{ id: 12, status: 'ready', contentVersionRef: 'free-course', creditSettlement: { actualCredits: 0 } }] },
      { id: 4, status: 'available', estimatedCredits: 1, generationJob: { status: 'generating' } },
      { id: 5, status: 'available', estimatedCredits: 3 },
      { id: 6, status: 'locked', estimatedCredits: null },
      { id: 7, status: 'available', estimatedCredits: 1, courseInstances: [{ id: 13, status: 'failed', creditSettlement: { status: 'released', frozenCredits: 10, voidedCredits: 10 } }] }
    ] }]
  })

  const dashboard = await identity.loadLearningDashboard()

  assert.equal(dashboard.currentTask.status, '等待生成')
  assert.deepEqual(dashboard.tasks.map((task) => task.meta), [
    '等待生成 · 已冻结 10 积分',
    '课程已就绪 · 已结算 8 积分',
    '课程已就绪 · 已结算 0 积分',
    '课程生成中 · 预计 1 积分',
    '可开始 · 预计 3 积分',
    '等待前置任务',
    '生成失败 · 已退回 10 积分'
  ])
})

test('learning dashboard keeps launchable courses from older plans when the current task is voided', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER, 901)
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {
    id: 902, nickname: '测试学生', profile_completed_at: '2026-09-07T00:00:00Z'
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLANS, {
    status: 'ready', profile: { id: 902 }, plans: [
      {
        id: 601, status: 'active', generated_at: '2026-09-08T00:00:00Z', items: [
          { id: 61, status: 'available', topicName: '被作废的课程', courseInstances: [{ id: 6011, status: 'voided_credit_limit', contentVersionRef: '' }] }
        ]
      },
      {
        id: 600, status: 'completed', generated_at: '2026-09-01T00:00:00Z', items: [
          { id: 60, status: 'lesson_completed', topicName: '历史已生成课程', subjectName: '数学', courseInstances: [{ id: 6001, status: 'awaiting_acceptance', contentVersionRef: 'saved-course', coverUrl: 'https://assets.example/cover.png' }] }
        ]
      }
    ]
  })

  const dashboard = await identity.loadLearningDashboard()

  assert.equal(dashboard.currentTask.courseInstanceId, null)
  assert.deepEqual(dashboard.myCourses.map((course) => course.courseInstanceId), ['6001'])
      assert.equal(dashboard.myCourses[0].stateLabel, '需要复述')
  assert.equal(dashboard.myCourses[0].canStartAcceptance, true)
})

test('home dashboard uses completed diagnostic evidence when score prediction is unavailable', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER, 901)
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {
    id: 902, nickname: '测试学生', profile_completed_at: '2026-09-07T00:00:00Z'
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLANS, {
    status: 'ready', profile: { id: 902 }, plans: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_CENTER, {
    status: 'ready', profile: { id: 902 }, subjects: [],
    attempts: [{ id: 903, subjectKey: 'Mathematics', status: 'completed', completed_at: '2026-09-07T00:00:00Z' }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_DIAGNOSTIC_REPORTS, {
    status: 'ready', profile: { id: 902 },
    reports: [{ id: 904, status: 'completed', weakTopics: ['一次函数', '全等三角形'] }],
    predictions: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, {
    studentId: 902, account: { status: 'active', available_credits: 0, frozen_credits: 0 }, batches: [], ledger: [], orders: []
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER, {
    status: 'ready', coinAccount: { status: 'active', available_coins: 0, frozen_coins: 0 }, partner: {}
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_NOTIFICATIONS, { status: 'ready', notifications: [] })

  const home = await identity.loadHomeDashboard()

  assert.equal(home.assessment.masteryLabel, '诊断已完成')
  assert.equal(home.assessment.weakCount, 2)
  assert.equal(home.assessment.forecast, '数据不足')
})

test('current-user relationship, identity and notification readers never accept client-owned account identifiers', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_PROMOTER_ASSIGNMENT_REQUEST, {
    studentId: 201,
    request: { id: 61, status: 'pending' },
    attribution: { id: 62, promoter_profile: { id: 63, display_name: '测试推广伙伴' } }
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LOGIN_IDENTITIES, { principal: { id: 201, login_methods: ['wechat'] } })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_NOTIFICATIONS, {
    status: 'ready', notifications: [{ id: 71, status: 'unread', title: '测试通知' }]
  })

  const assignment = await identity.loadPromoterAssignmentRequest()
  assert.equal(assignment.studentId, 201)
  assert.equal(assignment.attribution.promoter.display_name, '测试推广伙伴')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_PROMOTER_ASSIGNMENT_REQUEST).variables.args, {})

  const principal = await identity.loadCurrentLoginIdentities()
  assert.equal(principal.id, 201)
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_LOGIN_IDENTITIES).variables.args, {})

  const notifications = await identity.loadCurrentNotifications()
  assert.equal(notifications[0].title, '测试通知')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_NOTIFICATIONS).variables.args, {})
})

test('acceptance audio uses a private upload credential before registering the server-owned asset', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.REGISTER_CURRENT_ACCEPTANCE_AUDIO, {
    status: 'registered', audio_asset_id: 81
  })
  const originalRequest = global.wx.request
  const originalGetFileInfo = global.wx.getFileInfo
  const originalArrayBufferToBase64 = global.wx.arrayBufferToBase64
  const originalFileSystemManager = global.wx.getFileSystemManager
  const uploadCalls = []
  global.wx.getFileInfo = ({ success }) => success({ size: 2048, digest: '00000000000000000000000000000000' })
  global.wx.arrayBufferToBase64 = (buffer) => Buffer.from(new Uint8Array(buffer)).toString('base64')
  global.wx.getFileSystemManager = () => ({
    readFile({ success }) { success({ data: new ArrayBuffer(4) }) }
  })
  global.wx.request = (options) => {
    if (options.url === 'https://upload.example/private-audio') {
      uploadCalls.push({ method: options.method, header: options.header, data: options.data })
      options.success({ statusCode: 204, data: {} })
      return
    }
    if (/GetAcceptanceAudioUploadUrl/.test(String(options.data && options.data.query))) {
      calls.push({ id: 'private-audio-upload', variables: options.data.variables, query: options.data.query })
      options.success({ statusCode: 200, data: { data: { filePresignedUrl: {
        fileId: 91, uploadUrl: 'https://upload.example/private-audio', uploadHeaders: { 'x-upload-test': '1' }
      } } } })
      return
    }
    originalRequest(options)
  }

  try {
    const result = await identity.uploadCurrentAcceptanceAudio(71, '/tmp/answer.m4a', 1250)
    assert.deepEqual(result, { status: 'registered', audioAssetId: '81', fileId: '91' })
    assert.deepEqual(calls.find((item) => item.id === 'private-audio-upload').variables, {
      md5: 'AAAAAAAAAAAAAAAAAAAAAA==', format: 'OTHER', name: 'feynman-acceptance-71.m4a', suffix: 'OTHER', sizeBytes: 2048, acl: 'PRIVATE'
    })
    assert.equal(uploadCalls.length, 1)
    assert.equal(uploadCalls[0].method, 'PUT')
    assert.deepEqual(uploadCalls[0].header, { 'x-upload-test': '1' })
    assert.deepEqual(lastCall(config.ACTION_FLOWS.REGISTER_CURRENT_ACCEPTANCE_AUDIO).variables.args, {
      acceptance_id: 71, segment_no: 1, audio_file_id: 91, file_format: 'm4a', duration_ms: 1250, size_bytes: 2048, md5_base64: 'AAAAAAAAAAAAAAAAAAAAAA=='
    })
  } finally {
    global.wx.request = originalRequest
    global.wx.getFileInfo = originalGetFileInfo
    global.wx.arrayBufferToBase64 = originalArrayBufferToBase64
    global.wx.getFileSystemManager = originalFileSystemManager
  }
})

test('learning-plan task creation sends only user-entered planning constraints and normalizes completed output', async () => {
  reset()
  const originalRequest = global.wx.request
  const originalSetTimeout = global.setTimeout
  const taskRequests = []
  global.setTimeout = (callback) => { callback(); return 0 }
  global.wx.request = (options) => {
    const query = String(options.data && options.data.query)
    if (/CreateLearningPlanTask/.test(query)) {
      taskRequests.push({ kind: 'create', query, variables: options.data.variables })
      options.success({ statusCode: 200, data: { data: { taskId: 101 } } })
      return
    }
    if (/GetLearningPlanTask/.test(query)) {
      taskRequests.push({ kind: 'read', variables: options.data.variables })
      options.success({ statusCode: 200, data: { data: { task: { status: 'COMPLETED', output: { status: 'ready', planId: 102 } } } } })
      return
    }
    originalRequest(options)
  }

  try {
    const progress = []
    const result = await identity.generateCurrentLearningPlan({
      goal: '  提升数学  ', dailyMinutes: 35, targetDate: '2026-10-01', subjectPriorities: ['Mathematics']
    }, (status) => progress.push(status))
    assert.deepEqual(result, { status: 'ready', planId: 102 })
    assert.equal(taskRequests[0].kind, 'create')
    assert.match(taskRequests[0].query, new RegExp(config.ACTION_FLOWS.GENERATE_CURRENT_LEARNING_PLAN.id))
    assert.deepEqual(taskRequests[0].variables, {
      args: { goal: '提升数学', daily_minutes: 35, target_date: '2026-10-01', subject_priorities: ['Mathematics'] }
    })
    assert.deepEqual(taskRequests[1], { kind: 'read', variables: { taskId: 101 } })
    assert.deepEqual(progress, ['COMPLETED'])
  } finally {
    global.wx.request = originalRequest
    global.setTimeout = originalSetTimeout
  }
})

test('learning-plan task surfaces a server failure without clearing the login session', async () => {
  reset()
  const originalRequest = global.wx.request
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (callback) => { callback(); return 0 }
  global.wx.request = (options) => {
    const query = String(options.data && options.data.query)
    if (/CreateLearningPlanTask/.test(query)) {
      options.success({ statusCode: 200, data: { data: { taskId: 102 } } })
      return
    }
    if (/GetLearningPlanTask/.test(query)) {
      options.success({ statusCode: 200, data: { data: { task: { status: 'FAILED', output: '规划服务暂不可用' } } } })
      return
    }
    originalRequest(options)
  }

  try {
    await assert.rejects(
      identity.generateCurrentLearningPlan({ goal: '提升数学', dailyMinutes: 35, targetDate: '2026-10-01', subjectPriorities: [] }),
      /规划服务暂不可用/
    )
    assert.equal(storageToken, 'test-runtime-token')
    assert.equal(navigationCalls.length, 0)
  } finally {
    global.wx.request = originalRequest
    global.setTimeout = originalSetTimeout
  }
})

test('learning-plan task stops polling after its bounded processing window', async () => {
  reset()
  const originalRequest = global.wx.request
  const originalSetTimeout = global.setTimeout
  let pollingCount = 0
  global.setTimeout = (callback) => { callback(); return 0 }
  global.wx.request = (options) => {
    const query = String(options.data && options.data.query)
    if (/CreateLearningPlanTask/.test(query)) {
      options.success({ statusCode: 200, data: { data: { taskId: 103 } } })
      return
    }
    if (/GetLearningPlanTask/.test(query)) {
      pollingCount += 1
      options.success({ statusCode: 200, data: { data: { task: { status: 'PROCESSING', output: null } } } })
      return
    }
    originalRequest(options)
  }

  try {
    await assert.rejects(
      identity.generateCurrentLearningPlan({ goal: '提升数学', dailyMinutes: 35, targetDate: '2026-10-01', subjectPriorities: [] }),
      /仍在生成中/
    )
    assert.equal(pollingCount, 48)
    assert.equal(storageToken, 'test-runtime-token')
    assert.equal(navigationCalls.length, 0)
  } finally {
    global.wx.request = originalRequest
    global.setTimeout = originalSetTimeout
  }
})

test('promotion poster generation uses the configured Zion image agent and returns its image asset', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER, {
    status: 'ready',
    student: { id: 201 },
    promoter: { id: 301, status: 'active' },
    coinAccount: {},
    partner: {}
  })
  const originalRequest = global.wx.request
  const originalSetTimeout = global.setTimeout
  const zaiCalls = []
  global.setTimeout = (callback) => { callback(); return 0 }
  global.wx.request = (options) => {
    const query = String(options.data && options.data.query)
    if (/CreatePromotionPosterConversation/.test(query)) {
      zaiCalls.push({ kind: 'create', variables: options.data.variables })
      options.success({ statusCode: 200, data: { data: { conversationId: 71 } } })
      return
    }
    if (/GetPromotionPosterConversation/.test(query)) {
      zaiCalls.push({ kind: 'read', variables: options.data.variables })
      options.success({ statusCode: 200, data: { data: { result: {
        status: 'COMPLETED', images: [{ id: 81, url: 'https://assets.example/poster.png' }]
      } } } })
      return
    }
    originalRequest(options)
  }

  try {
    const progress = []
    const result = await identity.generateCurrentPromoterPosterBackground(' 初中数学学习规划 ', (status) => progress.push(status))
    assert.deepEqual(result, { conversationId: '71', imageId: '81', imageUrl: 'https://assets.example/poster.png' })
    assert.deepEqual(zaiCalls, [
      { kind: 'create', variables: {
        zaiConfigId: config.ZAI.PROMOTION_POSTER_BACKGROUND.id,
        inputArgs: { [config.ZAI.PROMOTION_POSTER_BACKGROUND.inputKey]: '初中数学学习规划' }
      } },
      { kind: 'read', variables: { conversationId: 71 } }
    ])
    assert.deepEqual(progress, ['COMPLETED'])
  } finally {
    global.wx.request = originalRequest
    global.setTimeout = originalSetTimeout
  }
})

test('promotion poster generation rejects inactive promoters before starting an image task', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER, {
    status: 'ready', student: { id: 201 }, promoter: null, coinAccount: {}, partner: {}
  })
  await assert.rejects(identity.generateCurrentPromoterPosterBackground('初中数学学习规划'), /有效推广伙伴/)
})

test('published promotion materials only use the current-user server flow and normalize safe fields', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_PUBLISHED_PROMOTION_ASSETS, {
    status: 'ready',
    assets: [{
      id: 71,
      asset_no: 'MAT-001',
      asset_type: 'image',
      version_no: 'v1',
      title: '数学学习规划海报',
      campaign_key: 'math-plan',
      copy_text: '为孩子制定清晰的学习计划。',
      published_at: '2026-09-05T00:00:00Z',
      expires_at: '2026-10-01T00:00:00Z',
      cover_image: { id: 81, url: 'https://assets.example/material.png' },
      asset_file: { id: 82, url: 'https://assets.example/material.pdf' },
      scope_rule: { audience: 'all_promoters' }
    }]
  })

  const result = await identity.loadPublishedPromotionAssets()

  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_PUBLISHED_PROMOTION_ASSETS).variables, { args: {} })
  assert.deepEqual(result, {
    status: 'ready',
    assets: [{
      id: '71', assetNo: 'MAT-001', assetType: 'image', versionNo: 'v1',
      title: '数学学习规划海报', campaignKey: 'math-plan', copyText: '为孩子制定清晰的学习计划。',
      publishedAt: '2026-09-05T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z',
      coverImage: { id: '81', url: 'https://assets.example/material.png' },
      assetFile: { id: '82', url: 'https://assets.example/material.pdf' }
    }]
  })
})

test('published promotion materials preserve the current session for an inactive partner', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_PUBLISHED_PROMOTION_ASSETS, { status: 'promoter_inactive', assets: [] })

  assert.deepEqual(await identity.loadPublishedPromotionAssets(), { status: 'promoter_inactive', assets: [] })
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

test('daily coin check-in only invokes the current-user server flow and normalizes its result', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.CLAIM_CURRENT_DAILY_COIN_CHECKIN, {
    status: 'checked_in', checkin_date: '2026-09-06', reward_coins: 3, available_coins: 18
  })

  assert.deepEqual(await identity.claimCurrentDailyCoinCheckin(), {
    status: 'checked_in', checkinDate: '2026-09-06', rewardCoins: 3, availableCoins: 18
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CLAIM_CURRENT_DAILY_COIN_CHECKIN).variables, { args: {} })

  reset()
  actionResult(config.ACTION_FLOWS.CLAIM_CURRENT_DAILY_COIN_CHECKIN, {
    status: 'already_checked_in', checkin_date: '2026-09-06', reward_coins: 3, available_coins: 18
  })
  assert.equal((await identity.claimCurrentDailyCoinCheckin()).status, 'already_checked_in')
})

test('learning check-in reading passes on how many coins the next check-in brings', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_CHECKIN, {
    status: 'ready', today: '2026-09-27', checkedDates: ['2026-09-26', '2026-09-27'],
    reward: { enabled: true, coins: 20, nextDay: 'tomorrow', nextCoins: 40 }
  })
  assert.deepEqual((await identity.loadCurrentLearningCheckin()).reward, { enabled: true, coins: 20, nextDay: 'tomorrow', nextCoins: 40 })

  // 旧后端没有 nextDay / nextCoins：当成今天、0 金币（页面不提示）
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_CHECKIN, { status: 'ready', today: '2026-09-27', reward: { enabled: true, coins: 20 } })
  assert.deepEqual((await identity.loadCurrentLearningCheckin()).reward, { enabled: true, coins: 20, nextDay: 'today', nextCoins: 0 })
})

test('daily coin check-in does not clear a valid session when its rule is not published', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.CLAIM_CURRENT_DAILY_COIN_CHECKIN, { status: 'rule_unavailable' })
  await assert.rejects(identity.claimCurrentDailyCoinCheckin(), /暂未发布/)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})

test('credit account can be read for a bound child and labels who spent guardian credits', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, {
    studentId: 302, viewerStudentId: 201, student: { id: 302, nickname: '小鹿' },
    account: { status: 'active', available_credits: '10', frozen_credits: '0', consumed_credits: '0', expired_credits: '0' },
    batches: [],
    ledger: [
      { id: 1, credits: '-4', business_type: 'course_generation_consume', learner_profile_id: 302, beneficiary_profile_id: 302 },
      { id: 2, credits: '-6', business_type: 'course_generation_consume', learner_profile_id: 201, beneficiary_profile_id: 302, learner_profile: { id: 201, nickname: '鹿爸' } }
    ],
    orders: []
  })
  const child = await identity.loadCurrentCreditAccount('302')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT).variables.args, { studentId: '302' })
  assert.deepEqual(child.viewer, { studentId: '201', isSelf: false })
  assert.deepEqual(child.student, { id: '302', name: '小鹿' })
  assert.equal(child.ledger[0].counterpartyLabel, '')
  assert.equal(child.ledger[1].counterpartyLabel, '使用鹿爸的积分')

  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, {
    studentId: 201, viewerStudentId: 201, student: { id: 201, nickname: '鹿爸' },
    account: { status: 'active', available_credits: '90', frozen_credits: '0', consumed_credits: '6', expired_credits: '0' },
    batches: [],
    ledger: [{ id: 2, credits: '-6', business_type: 'course_generation_consume', learner_profile_id: 201, beneficiary_profile_id: 302, beneficiary_profile: { id: 302, nickname: '小鹿' } }],
    orders: []
  })
  const own = await identity.loadCurrentCreditAccount()
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT).variables.args, {})
  assert.equal(own.viewer.isSelf, true)
  assert.equal(own.ledger[0].counterpartyLabel, '使用人：小鹿')
})

// 定制课程按节扣积分（2026-10-05）：每节一条「定制课程扣费」，余额不够的写明本节多少、待补扣多少；补扣另有一条。
test('custom-course charges show the lesson, what is still owed and the repayment', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, {
    studentId: 31, viewerStudentId: 31, student: { id: 31, nickname: '小鹿' },
    account: { status: 'active', available_credits: '0', frozen_credits: '0', consumed_credits: '2300', expired_credits: '0' },
    batches: [],
    ledger: [
      { id: 3, credits: '-300', entry_type: 'consume', business_type: 'agent_course_debt_repay', business_ref: 'stage-b', learner_profile_id: 31, beneficiary_profile_id: 31 },
      { id: 2, credits: '0', entry_type: 'consume', business_type: 'agent_course', business_ref: 'stage-b', learner_profile_id: 31, beneficiary_profile_id: 31 },
      { id: 1, credits: '-2000', entry_type: 'consume', business_type: 'agent_course', business_ref: 'stage-a', learner_profile_id: 31, beneficiary_profile_id: 31 }
    ],
    agentCourseCharges: [
      { stage_id: 'stage-b', title: '第2节 连续退位', status: 'charged', actual_credits: '1500', paid_credits: '0', debt_credits: '1500', repaid_credits: '300', debt_status: 'open' },
      { stage_id: 'stage-b', title: '第2节 连续退位', status: 'released', actual_credits: '0', paid_credits: '0', debt_credits: '0', repaid_credits: '0', debt_status: 'none' },
      { stage_id: 'stage-a', title: '第1节 退位减法', status: 'charged', actual_credits: '2000', paid_credits: '2000', debt_credits: '0', repaid_credits: '0', debt_status: 'none' }
    ],
    debt: 1200,
    orders: []
  })
  const account = await identity.loadCurrentCreditAccount()
  assert.equal(account.debt, '1200')
  assert.deepEqual(account.ledger.map((item) => [item.businessLabel, item.counterpartyLabel]), [
    ['补扣欠款', '《第2节 连续退位》的欠款'],
    ['定制课程扣费', '《第2节 连续退位》 · 本节 1500，1200 待补扣'],
    ['定制课程扣费', '《第1节 退位减法》']
  ])
})

test('reading an unrelated student credit account surfaces the authorization error in Chinese', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, new Error('STUDENT_NOT_AUTHORIZED'))
  await assert.rejects(identity.loadCurrentCreditAccount('999'), /没有查看该学生课程积分的权限/)
})

// 老师的头像是后端新加的字段。identity 这层是逐字段挑出来的，漏挑一个前端就永远拿不到——
// 这条用例盯住整条链路：动作流返回什么，页面就应该拿到什么。
test('the invite the student opens carries the teacher avatar and voice straight through', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_TEACHER_AGENT_INVITE, {
    status: 'ready',
    online: true,
    serverNow: '2026-09-22T11:00:00Z',
    invite: {
      inviteId: '5',
      token: 'tk1',
      subject: '数学',
      scheduledOnlineAt: '2026-09-22T11:00:00Z',
      status: 'scheduled',
      sessionId: '',
      teacherName: '周流君騰',
      teacherAvatarUrl: 'https://cdn.example.com/t.jpg',
      voiceUrl: 'https://cdn.example.com/v.mp3',
      voiceDurationMs: 14266
    }
  })
  const result = await identity.loadTeacherAgentInvite('tk1')
  assert.equal(result.status, 'ready')
  assert.equal(result.invite.teacherName, '周流君騰')
  assert.equal(result.invite.teacherAvatarUrl, 'https://cdn.example.com/t.jpg')
  assert.equal(result.invite.voiceUrl, 'https://cdn.example.com/v.mp3')
  assert.equal(result.invite.voiceDurationMs, 14266)

  // 老师没设头像时给空串，页面据此退回占位圆，而不是渲染一个坏掉的 image
  reset()
  actionResult(config.ACTION_FLOWS.GET_TEACHER_AGENT_INVITE, {
    status: 'ready', online: false, serverNow: '',
    invite: { inviteId: '5', token: 'tk1', subject: '数学', scheduledOnlineAt: '2026-09-22T11:00:00Z', status: 'scheduled', teacherName: '王老师' }
  })
  const bare = await identity.loadTeacherAgentInvite('tk1')
  assert.equal(bare.invite.teacherAvatarUrl, '')
  assert.equal(bare.invite.voiceUrl, '')
})
