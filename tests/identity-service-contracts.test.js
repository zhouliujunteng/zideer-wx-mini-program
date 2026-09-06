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
    if (options.url === `${config.COURSE_PORTAL_ORIGIN}/api/course-launch/issue`) {
      calls.push({ url: options.url, data: options.data, header: options.header })
      options.success({ statusCode: 200, data: { launchUrl: `${config.COURSE_PORTAL_ORIGIN}/launch?token=test-launch-token` } })
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
  assert.deepEqual(navigationCalls, [{ url: '/pages/login/login' }])

  await assert.rejects(
    identity.loadCurrentIdentityVerification(),
    (error) => error && error.code === 'AUTH_REQUIRED'
  )
  assert.equal(navigationCalls.length, 1)
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
    id: 201, nickname: '小鹿', current_grade: 8, profile_completed_at: '2026-09-05T00:00:00Z'
  })

  const user = await identity.restoreAuthenticatedUser()
  assert.equal(user.userPrincipalId, 101)
  assert.equal(user.userProfileId, 201)
  assert.equal(user.profileCompleted, true)

  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE, 201)
  await identity.saveCurrentLearningProfile({
    nickname: '小鹿', grade: 8, schoolStage: '初中', semester: '秋季', schoolName: '测试学校', textbookVersion: '人教版', regionDetail: '深圳'
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE).variables.args, {
    nickname: '小鹿', grade: 8, school_stage: '初中', semester: '秋季', school_name: '测试学校', textbook_version: '人教版', region_detail: '深圳'
  })
})

test('assessment answers and submission preserve their server-owned identifiers', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.START_OR_RESUME_BASIC_ASSESSMENT, { status: 'ready', attemptId: 31 })
  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_ANSWER, { status: 'saved', answer: 'B' })
  actionResult(config.ACTION_FLOWS.SUBMIT_CURRENT_BASIC_ASSESSMENT, { status: 'submitted', attemptId: 31 })

  await identity.startOrResumeBasicAssessment('Mathematics', '中考')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.START_OR_RESUME_BASIC_ASSESSMENT).variables.args, {
    subject_key: 'Mathematics', target_exam: '中考'
  })
  assert.equal(await identity.saveCurrentAssessmentAnswer(31, 9, 'B'), 'B')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_ANSWER).variables.args, {
    attempt_id: 31, question_id: 9, answer: 'B'
  })
  await identity.submitCurrentBasicAssessment(31)
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SUBMIT_CURRENT_BASIC_ASSESSMENT).variables.args, { attempt_id: 31 })
})

test('assessment scores, exam files and OCR review preserve the owning attempt', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_SCORES, {
    status: 'ready', uploads: [{ id: 41, score: 92, full_score: 100, exam_name: '月考', exam_date: '2026-09-05', original_files: [] }]
  })
  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_SCORE, { status: 'saved', upload: { id: 41 } })
  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_EXAM_FILES, { status: 'saved', upload: { id: 41 } })
  actionResult(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_OCR_REVIEW, { status: 'saved', upload: { id: 41 } })

  assert.equal((await identity.loadCurrentAssessmentScores(31))[0].id, '41')
  await identity.saveCurrentAssessmentScore(31, { examName: '月考', examDate: '2026-09-05', score: 92, fullScore: 100, rankText: '年级测试' })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_SCORE).variables.args, {
    attempt_id: 31, upload_id: null, exam_name: '月考', exam_date: '2026-09-05', score: 92, full_score: 100, rank_text: '年级测试'
  })
  const files = [{ assetId: 'asset-1', sizeBytes: 1024, md5Base64: 'AAAAAAAAAAAAAAAAAAAAAA==', suffix: 'JPG' }]
  await identity.saveCurrentAssessmentExamFiles(31, { id: 41, examName: '月考', examDate: '2026-09-05' }, files)
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_EXAM_FILES).variables.args, {
    attempt_id: 31, upload_id: 41, exam_name: '月考', exam_date: '2026-09-05',
    original_files: [{ pageNo: 1, assetId: 'asset-1', name: '试卷第 1 页', sizeBytes: 1024, md5Base64: 'AAAAAAAAAAAAAAAAAAAAAA==', suffix: 'JPG', uploadedAt: '' }]
  })
  await identity.saveCurrentAssessmentOcrReview(31, 41, { score: '92' })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_OCR_REVIEW).variables.args, {
    attempt_id: 31, upload_id: 41, ocr_corrected: { score: '92' }
  })
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

test('temporary course and acceptance launch open the configured public HTTPS page without a bridge request', async () => {
  reset()

  const courseUrl = await identity.createCourseLaunchUrl(51)
  assert.equal(courseUrl, `${config.COURSE_PORTAL_ORIGIN}${config.PUBLIC_COURSE_PAGE_PATH}`)
  assert.equal(calls.length, 0)

  const acceptanceUrl = await identity.createAcceptanceLaunchUrl(51, 61)
  assert.equal(acceptanceUrl, `${config.COURSE_PORTAL_ORIGIN}${config.PUBLIC_COURSE_PAGE_PATH}`)
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

test('deep assessment, diagnosis, plan and acceptance flows preserve server-owned state', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_DEEP_ASSESSMENT_ENTITLEMENTS, {
    status: 'ready', profile: { id: 201 }, grants: [{ id: 301, status: 'available', sourceType: 'promotion' }]
  })
  actionResult(config.ACTION_FLOWS.START_OR_RESUME_DEEP_ASSESSMENT, { status: 'ready', attemptId: 302 })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_DIAGNOSTIC_REPORTS, {
    status: 'ready', profile: { id: 201 }, reports: [{ id: 401, confidence: 0.82, weakTopics: ['一次函数'] }],
    predictions: [{ id: 402, subjectCode: 'Mathematics', scoreLower: 88, scoreUpper: 96, confidence: 0.8 }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLANS, {
    status: 'ready', profile: { id: 201 }, plans: [{ id: 501, plannedCredits: 12.5, items: [{ id: 502, status: 'available', estimatedCredits: 2.5 }] }]
  })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_REMEDIATION_TASKS, { status: 'ready', tasks: [] })
  actionResult(config.ACTION_FLOWS.GET_CURRENT_LIVE_SCHEDULE, { status: 'ready', profile: { id: 201 }, sessions: [], assignments: [] })
  actionResult(config.ACTION_FLOWS.CREATE_CURRENT_FEYNMAN_ACCEPTANCE, { status: 'ready', acceptanceId: 601, courseInstanceId: 602, topicId: 603 })

  const grants = await identity.loadDeepAssessmentEntitlements()
  assert.equal(grants.grants[0].sourceLabel, '推广赠送')
  await identity.startOrResumeDeepAssessment(301, 'Mathematics')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.START_OR_RESUME_DEEP_ASSESSMENT).variables.args, {
    grant_id: '301', subject_key: 'Mathematics'
  })
  const diagnostics = await identity.loadCurrentDiagnosticReports()
  assert.equal(diagnostics.reports[0].confidencePercent, 82)
  assert.equal(diagnostics.predictions[0].scoreRange, '88 - 96')
  const plans = await identity.loadCurrentLearningPlans()
  assert.equal(plans.plans[0].items[0].estimatedCreditsDisplay, '3')
  assert.deepEqual(await identity.loadCurrentRemediationTasks(), { status: 'ready', tasks: [] })
  assert.deepEqual((await identity.loadCurrentLiveSchedule()).sessions, [])
  assert.deepEqual(await identity.createCurrentFeynmanAcceptance(602), {
    acceptanceId: '601', courseInstanceId: '602', topicId: '603'
  })
  assert.deepEqual(lastCall(config.ACTION_FLOWS.CREATE_CURRENT_FEYNMAN_ACCEPTANCE).variables.args, { course_instance_id: 602 })
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

test('deep assessment gift only submits a safe attribution identifier', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GIFT_CURRENT_PROMOTER_CLIENT_DEEP_ASSESSMENT, {
    status: 'granted', reused: false, grant: { id: 901, grantNo: 'DGR-test', status: 'available' }
  })

  const result = await identity.giftCurrentPromoterClientDeepAssessment(701, 'deep-gift-key')
  assert.equal(result.reused, false)
  assert.equal(result.grant.grantNo, 'DGR-test')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GIFT_CURRENT_PROMOTER_CLIENT_DEEP_ASSESSMENT).variables.args, {
    attribution_id: 701,
    idempotency_key: 'deep-gift-key'
  })

  reset()
  actionResult(config.ACTION_FLOWS.GIFT_CURRENT_PROMOTER_CLIENT_DEEP_ASSESSMENT, { status: 'already_received' })
  await assert.rejects(identity.giftCurrentPromoterClientDeepAssessment(701, 'deep-gift-key'), /已获得过推广深测资格/)
  await assert.rejects(identity.giftCurrentPromoterClientDeepAssessment(0, 'deep-gift-key'), /有效的直属用户/)
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
})

test('read-only student, assessment, credit and growth views invoke their current-user flows', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP, {
    status: 'ready', grade: 8,
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
  assert.equal(map.nodes[0].evidence, '已汇集 2 条学习证据')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP).variables.args, {})

  const center = await identity.loadAssessmentCenter()
  assert.equal(center.subjects[0].name, '数学')
  assert.equal(center.attempts[0].id, '21')
  assert.equal(center.attempts[0].statusLabel, '进行中')
  assert.deepEqual(lastCall(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_CENTER).variables.args, {})

  const products = await identity.loadCreditProducts()
  assert.deepEqual(products.products[0], {
    id: 31, productCode: 'TRY', name: '体验积分包', description: undefined, amount: '0.01', credits: '3', estimatedCourseCount: 1,
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
      publishedAt: '2026-09-05T00:00:00Z',
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

test('daily coin check-in does not clear a valid session when its rule is not published', async () => {
  reset()
  actionResult(config.ACTION_FLOWS.CLAIM_CURRENT_DAILY_COIN_CHECKIN, { status: 'rule_unavailable' })
  await assert.rejects(identity.claimCurrentDailyCoinCheckin(), /暂未发布/)
  assert.equal(storageToken, 'test-runtime-token')
  assert.equal(navigationCalls.length, 0)
})
