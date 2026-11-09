// 奖励结算（整笔转现金 / 兑换积分）、我的结算记录、结算详情三页与推广结算服务（2026-09-26）。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
require('./helpers/stub-ui-assets')

const view = require('../services/settlement-apply-view')
const withdrawPath = require.resolve('../agent/withdraw/index.js')
const applicationsPath = require.resolve('../agent/settlement-applications/index.js')
const applicationPath = require.resolve('../agent/settlement-application/index.js')
const identityPath = require.resolve('../services/identity.js')
const servicePath = require.resolve('../services/settlement-service.js')
const configPath = require.resolve('../config/index.js')

const CONTACT = { id: '7', contactType: 'enterprise_wechat_link', title: '知鹿课程顾问', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc0123456789' }

function overview(overrides = {}) {
  return {
    status: 'ready',
    promoter: { id: 3, status: 'active', active: true },
    amounts: { available: 20, cash_only: 5, locked: 30, withdrawing: 0, paid: 99, credited: 0, next_unlock_at: '2026-09-29T04:00:00.000Z' },
    cash: {
      state: 'ready', amount: 25, subject_type: 'individual', legal_name: '林小鹿', contact_phone_masked: '138****5678',
      bank: { account_name: '林小鹿', bank_name: '招商银行', branch: '杭州分行', account_no_masked: '**** 5678' },
      tax: { rule: 'labor_withholding', income: 25, deduction: 25, deduction_kind: 'fixed_800', taxable: 0, rate: 0.2, quick_deduction: 0, tax: 0, net: 25 },
      invoice_required: false,
      agreement: { no: 'LW-001', signed_at: '2026-09-20T00:00:00Z', file_url: 'https://fz-zion-static.functorz.com/a.pdf', file_name: '协议.pdf', file_type: 'pdf' }
    },
    credits: { state: 'ready', amount: 20, rate: 100, credits: 2000, valid_days: null },
    pending: { count: 0, latest_request_no: '' },
    ...overrides
  }
}

function applyData(target, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!key.includes('.') && !key.includes('[')) { target[key] = value; continue }
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (const part of parts.slice(0, -1)) cursor = cursor[part]
    cursor[parts[parts.length - 1]] = value
  }
}

function loadPage(pagePath, { service = {}, identity = {}, wxOverrides = {}, pageStack = [{}, {}] } = {}) {
  delete require.cache[pagePath]
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: {
    loadCurrentServiceContacts: async () => ({ status: 'ready', contacts: [CONTACT] }), ...identity
  } }
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
    createSettlementKey: (prefix) => `${prefix}-key-${Math.random().toString(36).slice(2, 10)}`, ...service
  } }
  let definition = null
  const calls = { navigate: [], toast: [], modal: [], customerService: [], preview: [], documents: [], downloads: [], clipboard: [] }
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pageStack
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 283, top: 50, width: 87, height: 32 }),
    navigateTo: (opts) => calls.navigate.push(opts.url),
    navigateBack: () => calls.navigate.push('back'),
    showToast: (opts) => calls.toast.push(opts.title),
    showModal: (opts) => { calls.modal.push(opts); opts.success({ confirm: true }) },
    openCustomerServiceChat: (opts) => { calls.customerService.push(opts); opts.success({}) },
    previewImage: (opts) => calls.preview.push(opts),
    openDocument: (opts) => calls.documents.push(opts),
    downloadFile: (opts) => { calls.downloads.push(opts.url); opts.success({ statusCode: 200, tempFilePath: '/tmp/doc.pdf' }); if (opts.complete) opts.complete() },
    setClipboardData: (opts) => calls.clipboard.push(opts.data),
    createSelectorQuery: () => ({
      select: () => ({ boundingClientRect(callback) { callback({ top: 300, height: 120 }); return this }, exec() {} }),
      exec() {}
    }),
    ...wxOverrides
  }
  require(pagePath)
  delete require.cache[identityPath]
  delete require.cache[servicePath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, callback) { applyData(this.data, values); if (callback) callback() }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

// ---------- 展示计算 ----------

test('cash view explains each missing step and points to the application page or customer service', () => {
  for (const [state, title] of [
    ['not_promoter', '提现需开通推广伙伴'], ['promoter_suspended', '推广伙伴资格已暂停'],
    ['profile_disabled', '结算资料已停用'], ['agreement_missing', '劳务协议待上传'],
    ['profile_missing', '签约资料待填写'], ['profile_pending', '签约资料复核中'], ['profile_rejected', '签约资料未通过复核']
  ]) {
    const cash = view.buildCashView(overview({ cash: { state, amount: 25 } }))
    assert.equal(cash.ready, false)
    assert.equal(cash.notice.title, title)
    assert.ok(cash.notice.actionLabel)
  }
  // 2026-09-29 起推广伙伴在小程序申请：核验身份证后提交，平台审核开通（10-13 起整个流程不刷脸）
  assert.doesNotMatch(view.buildCashView(overview({ cash: { state: 'not_promoter' } })).notice.copy, /刷脸|人脸/)
  assert.equal(view.buildCashView(overview({ cash: { state: 'not_promoter' } })).notice.action, 'open_partner')
  assert.match(view.buildCashView(overview({ cash: { state: 'profile_missing' } })).notice.copy, /身份证号后 6 位/)
  assert.equal(view.buildCashView(overview({ cash: { state: 'profile_rejected', review_note: '开户支行写错了' } })).notice.copy, '原因：开户支行写错了。请按客服发的链接修改后重新提交。')
})

test('cash view shows the masked bank card, a withholding estimate and the agreement', () => {
  const cash = view.buildCashView(overview())
  assert.equal(cash.ready, true)
  assert.equal(cash.amountText, '25.00')
  assert.equal(cash.bankTail, '5678')
  assert.deepEqual(cash.bankRows.map((row) => row.value), ['个人 · 林小鹿', '林小鹿', '招商银行 杭州分行', '**** 5678'])
  assert.deepEqual(cash.taxRows.map((row) => row.label), ['提现金额', '减除费用', '应纳税所得额', '预扣个税'])
  assert.equal(cash.netText, '25.00')
  assert.equal(cash.invoiceRequired, false)
  assert.equal(cash.agreement.title, '《劳务费代扣代发协议》')
  assert.equal(cash.agreement.meta, '协议编号 LW-001 · 2026.09.20 签署')

  const big = view.buildCashView(overview({ cash: { ...overview().cash, amount: 30000, tax: { rule: 'labor_withholding', income: 30000, deduction: 6000, deduction_kind: 'ratio_20', taxable: 24000, rate: 0.3, quick_deduction: 2000, tax: 5200, net: 24800 } } }))
  assert.deepEqual(big.taxRows.map((row) => row.value), ['¥30000.00', '-¥6000.00', '¥24000.00', '-¥5200.00'])
  assert.equal(big.taxRows[3].note, '预扣率 30%，速算扣除 2000.00 元')
  assert.equal(big.netText, '24800.00')

  const company = view.buildCashView(overview({ cash: { ...overview().cash, subject_type: 'company', invoice_required: true, tax: { rule: 'invoice', income: 25, tax: 0, net: 25 } } }))
  assert.equal(company.invoiceRequired, true)
  assert.deepEqual(company.taxRows.map((row) => row.value), ['¥25.00', '不代扣'])
  assert.match(company.taxNote, /凭发票结算/)
})

test('credits view shows the exchange and warns about cash-only rewards', () => {
  const credits = view.buildCreditsView(overview())
  assert.deepEqual([credits.ready, credits.amountText, credits.creditsText, credits.rateText, credits.validityText], [true, '20.00', '2000', '1 元 = 100 积分', '兑换的积分永久有效'])
  assert.match(credits.cashOnlyNote, /5\.00 已选择提现/)
  assert.equal(view.buildCreditsView(overview({ credits: { state: 'disabled' } })).notice.title, '兑换积分暂未开放')
  assert.equal(view.buildCreditsView(overview({ credits: { state: 'no_profile' } })).notice.title, '请先完善学习档案')
  assert.equal(view.defaultTab(overview()), 'cash')
  assert.equal(view.defaultTab(overview({ promoter: { status: 'inactive', active: false } })), 'credits')
  assert.equal(view.buildHero(overview()).value, '25.00')
})

test('application items and detail read naturally for both kinds', () => {
  const items = view.buildApplicationItems([
    { id: 2, request_no: 'DH1', settle_type: 'credits', status: 'completed', reward_amount: 20, credits_amount: 2000, submitted_at: '2026-09-26T04:00:00Z' },
    { id: 1, request_no: 'TX1', settle_type: 'cash', status: 'paid', reward_amount: 25, paid_amount: 24, submitted_at: '2026-09-25T04:00:00Z' },
    { id: 3, request_no: 'TX2', settle_type: 'cash', status: 'submitted', reward_amount: 8, invoice_count: 2, submitted_at: '2026-09-24T04:00:00Z' }
  ])
  assert.deepEqual(items.map((item) => [item.title, item.statusLabel, item.amountText]), [
    ['兑换课程积分', '已完成', '+2000 积分'], ['提现到银行卡', '已打款', '¥24.00'], ['提现到银行卡', '待处理', '¥8.00']
  ])
  assert.deepEqual(view.filterApplications(items, 'pending').map((item) => item.requestNo), ['TX2'])
  assert.deepEqual(view.filterApplications(items, 'done').map((item) => item.requestNo), ['DH1', 'TX1'])

  const paid = view.buildApplicationDetail({
    id: 1, request_no: 'TX1', settle_type: 'cash', status: 'paid', reward_amount: 25, estimated_tax: 0, estimated_net: 25,
    settled_amount: 25, tax_amount: 1, paid_amount: 24, submitted_at: '2026-09-25T04:00:00Z', processing_at: '2026-09-25T06:00:00Z', completed_at: '2026-09-26T02:00:00Z',
    subject_type: 'individual', legal_name: '林小鹿', bank: { account_name: '林小鹿', bank_name: '招商银行', branch: '', account_no_masked: '**** 5678' },
    process_note: '已转账', files: [
      { id: 7, kind: 'invoice', name: '发票.pdf', format: 'pdf', url: 'https://x/a.pdf' },
      { id: 8, kind: 'payment_proof', name: '回单.png', format: 'png', url: 'https://x/b.png' }
    ]
  })
  assert.deepEqual([paid.heroLabel, paid.heroValue, paid.statusTone], ['实发金额（元）', '24.00', 'done'])
  assert.deepEqual(paid.steps.map((step) => step.state), ['done', 'done', 'done'])
  assert.deepEqual(paid.settledRows.map((row) => row.value), ['¥25.00', '¥1.00', '¥24.00'])
  assert.deepEqual([paid.invoices.length, paid.invoices[0].isImage, paid.proofs[0].isImage], [1, false, true])

  const rejected = view.buildApplicationDetail({ id: 3, settle_type: 'cash', status: 'rejected', reject_reason: '发票抬头不对', reward_amount: 8, files: [] })
  assert.equal(rejected.steps[2].label, '已驳回')
  assert.equal(rejected.rejectReason, '发票抬头不对')
  const credits = view.buildApplicationDetail({ id: 2, settle_type: 'credits', status: 'completed', reward_amount: 20, credits_amount: 2000, exchange_snapshot: { credits_per_yuan: 100, expires_at: null } })
  assert.deepEqual([credits.heroValue, credits.amountRows[1].value, credits.amountRows[3].value], ['2000', '1 元 = 100 积分', '永久有效'])
})

// ---------- 奖励结算页 ----------

test('a partner lands on the cash tab and can submit only after agreeing (and uploading invoices when required)', async () => {
  const submitted = []
  const { page, calls } = loadPage(withdrawPath, { service: {
    loadSettlementCenter: async () => overview({ cash: { ...overview().cash, subject_type: 'company', invoice_required: true, tax: { rule: 'invoice', income: 25, tax: 0, net: 25 } } }),
    uploadSettlementInvoice: async ({ name }) => ({ fileId: '1050000000000777', name, format: 'pdf' }),
    submitSettlementWithdrawal: async (args) => { submitted.push(args); return { status: 'submitted', settlement: { id: 41 } } }
  } })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.activeTab, 'cash')
  assert.equal(page.data.canSubmit, false)
  assert.equal(page.data.submitHint, '请先上传发票')

  await page.uploadInvoices([{ path: '/tmp/invoice.pdf', name: '发票.pdf' }])
  assert.deepEqual(page.data.invoices.map((item) => [item.status, item.fileId, item.isImage]), [['done', '1050000000000777', false]])
  assert.equal(page.data.submitHint, '请先阅读并勾选同意《劳务费代扣代发协议》')
  page.handleToggleAgree()
  assert.equal(page.data.canSubmit, true)

  page.handleSubmit()
  await flush()
  assert.match(calls.modal[0].content, /尾号 5678/)
  assert.equal(submitted.length, 1)
  assert.deepEqual(submitted[0].invoices, [{ fileId: '1050000000000777', name: '发票.pdf', format: 'pdf' }])
  assert.match(submitted[0].idempotencyKey, /^settle-cash-/)
  assert.deepEqual(calls.navigate, ['/agent/settlement-application/index?id=41'])
  assert.deepEqual(page.data.invoices, [])
})

test('a timed-out withdrawal is retried with the same idempotency key', async () => {
  const keys = []
  let attempt = 0
  const { page } = loadPage(withdrawPath, { service: {
    loadSettlementCenter: async () => overview(),
    submitSettlementWithdrawal: async ({ idempotencyKey }) => {
      keys.push(idempotencyKey)
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('网络超时'), { code: undefined })
      return { status: 'submitted', settlement: { id: 42 } }
    }
  } })
  page.onLoad()
  await page.loadPage()
  page.handleToggleAgree()
  await page.submitWithdrawal()
  await page.submitWithdrawal()
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
})

test('an ordinary user lands on credits, sees why cash is locked, and can exchange', async () => {
  const exchanged = []
  const { page, calls } = loadPage(withdrawPath, { service: {
    loadSettlementCenter: async () => overview({ promoter: { id: 3, status: 'inactive', active: false }, cash: { state: 'not_promoter', amount: 25 } }),
    exchangeSettlementCredits: async (args) => { exchanged.push(args); return { status: 'completed', credits: 2000, settlement: { id: 50, credits_amount: 2000 } } }
  } })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.activeTab, 'credits')
  page.handleTab({ currentTarget: { dataset: { id: 'cash' } } })
  assert.equal(page.data.cash.notice.title, '提现需开通推广伙伴')
  assert.equal(page.data.cash.notice.actionLabel, '申请成为推广伙伴')
  page.handleSwitchToCredits()
  assert.equal(page.data.activeTab, 'credits')
  page.handleExchange()
  await flush()
  assert.match(calls.modal[0].content, /2000 积分/)
  assert.equal(exchanged.length, 1)
  assert.match(calls.toast[0], /已兑换 2000 积分/)
  assert.deepEqual(calls.navigate, ['/agent/settlement-application/index?id=50'])
})

test('the agreement PDF is downloaded and opened as a document', async () => {
  const { page, calls } = loadPage(withdrawPath, { service: { loadSettlementCenter: async () => overview() } })
  page.onLoad()
  await page.loadPage()
  page.handleOpenAgreement()
  assert.deepEqual(calls.downloads, ['https://fz-zion-static.functorz.com/a.pdf'])
  assert.deepEqual(calls.documents.map((doc) => [doc.filePath, doc.fileType]), [['/tmp/doc.pdf', 'pdf']])
})

test('a failed first read shows a retryable state, not an empty page', async () => {
  const { page } = loadPage(withdrawPath, { service: { loadSettlementCenter: async () => { throw new Error('结算功能暂未开放，请稍后再试。') } } })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'failed')
  assert.match(page.data.loadError, /暂未开放/)
})

// ---------- 我的结算记录 / 结算详情 ----------

test('my settlement records list, filter and open the detail', async () => {
  const { page, calls } = loadPage(applicationsPath, { service: {
    loadSettlementApplications: async () => [
      { id: 2, request_no: 'DH1', settle_type: 'credits', status: 'completed', reward_amount: 20, credits_amount: 2000 },
      { id: 1, request_no: 'TX1', settle_type: 'cash', status: 'processing', reward_amount: 25 }
    ]
  } })
  page.onLoad()
  assert.equal(page.data.loadState, 'loading')
  await page.loadPage()
  assert.equal(page.data.items.length, 2)
  page.handleTab({ currentTarget: { dataset: { id: 'pending' } } })
  assert.deepEqual(page.data.items.map((item) => item.requestNo), ['TX1'])
  page.handleOpen({ currentTarget: { dataset: { id: '1' } } })
  assert.deepEqual(calls.navigate, ['/agent/settlement-application/index?id=1'])
})

test('the detail page loads by id and opens images and PDFs', async () => {
  let askedId = null
  const { page, calls } = loadPage(applicationPath, { service: {
    loadSettlementApplication: async (id) => {
      askedId = id
      return { id: 1, request_no: 'TX1', settle_type: 'cash', status: 'paid', reward_amount: 25, settled_amount: 25, tax_amount: 0, paid_amount: 25, files: [
        { id: 7, kind: 'invoice', name: '发票.pdf', format: 'pdf', url: 'https://x/a.pdf' },
        { id: 8, kind: 'payment_proof', name: '回单.png', format: 'png', url: 'https://x/b.png' }
      ] }
    }
  } })
  page.onLoad({ id: '1' })
  await page.loadPage()
  assert.equal(askedId, '1')
  assert.equal(page.data.detail.statusLabel, '已打款')
  page.handleOpenFile({ currentTarget: { dataset: { id: '8', group: 'proofs' } } })
  assert.deepEqual(calls.preview[0].urls, ['https://x/b.png'])
  page.handleOpenFile({ currentTarget: { dataset: { id: '7', group: 'invoices' } } })
  assert.deepEqual(calls.downloads, ['https://x/a.pdf'])
  page.handleCopyNo()
  assert.deepEqual(calls.clipboard, ['TX1'])
})

// ---------- 服务层 ----------

function loadService(flowId, invoke) {
  delete require.cache[servicePath]
  const config = require(configPath)
  const previous = config.ACTION_FLOWS.PROMOTION_SETTLEMENT_CENTER
  config.ACTION_FLOWS.PROMOTION_SETTLEMENT_CENTER = { id: flowId }
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: {
    invokeActionFlow: invoke, parseActionFlowResult: (value) => value, uploadPrivateFile: async () => ({ fileId: '9' })
  } }
  const service = require(servicePath)
  delete require.cache[identityPath]
  delete require.cache[servicePath]
  return { service, restore: () => { config.ACTION_FLOWS.PROMOTION_SETTLEMENT_CENTER = previous } }
}

test('the service refuses to call a placeholder flow and maps backend statuses to plain messages', async () => {
  const placeholder = loadService('__AF49__', async () => ({ status: 'ready' }))
  await assert.rejects(placeholder.service.loadSettlementCenter(), /暂未开放/)
  placeholder.restore()

  const sent = []
  const live = loadService('0e3b2a44-1111-2222-3333-444455556666', async (flow, args) => { sent.push(args.payload); return { status: 'invoice_required' } })
  await assert.rejects(live.service.submitSettlementWithdrawal({ invoices: [{ fileId: '12', name: 'a.pdf', format: 'pdf' }], idempotencyKey: 'settle-cash-abcdefgh12345' }), /请先上传发票/)
  assert.deepEqual(sent[0], { operation: 'withdraw', agree: true, idempotency_key: 'settle-cash-abcdefgh12345', invoices: [{ file_id: 12, name: 'a.pdf', format: 'pdf' }] })
  assert.equal(Object.keys(sent[0]).some((key) => /amount|credits|tax/.test(key)), false, '不提交任何金额')
  live.restore()
})

test('config keeps the AF49 placeholder until the Zion deploy script writes the real id', () => {
  const text = fs.readFileSync(path.join(__dirname, '../config/index.js'), 'utf8')
  assert.match(text, /PROMOTION_SETTLEMENT_CENTER: \{\s*id: "(__AF49__|[0-9a-f-]{36})"/)
})

// 2026-09-29 起推广伙伴在小程序申请（基础核验 → 刷脸 → 提交，后台审核），不再先查实名再找客服
test('「申请成为推广伙伴」 opens the application page; other notices go straight to customer service', async () => {
  const notPartner = loadPage(withdrawPath, {
    service: { loadSettlementCenter: async () => overview({ promoter: { id: 3, status: 'inactive', active: false }, cash: { state: 'not_promoter', amount: 25 } }) }
  })
  notPartner.page.onLoad()
  await notPartner.page.loadPage()
  await notPartner.page.handleNoticeAction()
  assert.equal(notPartner.calls.customerService.length, 0)
  assert.deepEqual(notPartner.calls.navigate, ['/agent/partner-apply/index'])

  const pending = loadPage(withdrawPath, {
    service: { loadSettlementCenter: async () => overview({ cash: { state: 'profile_pending', amount: 25 } }) }
  })
  pending.page.onLoad()
  await pending.page.loadPage()
  assert.equal(pending.page.data.cash.notice.title, '签约资料复核中')
  await pending.page.handleNoticeAction()
  assert.equal(pending.calls.customerService.length, 1)
})
