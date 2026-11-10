const assert = require('node:assert/strict')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const view = require('../services/promotion-view')
const workbenchPath = require.resolve('../agent/promotion/index.js')
const detailPath = require.resolve('../agent/poster-detail/index.js')
const identityPath = require.resolve('../services/identity.js')

const NOW = Date.parse('2026-09-20T12:00:00+08:00')

function asset(overrides = {}) {
  return {
    id: '71',
    title: '开学季学习礼包',
    campaignKey: '开学季活动',
    copyText: '邀请好友一起开启高效学习。',
    coverImage: { id: '81', url: 'https://assets.example/poster.png' },
    assetFile: { id: '82', url: 'https://assets.example/poster-full.png' },
    expiresAt: '',
    ...overrides
  }
}

// setData 支持 a[0][1].b 形式的路径键，和小程序一致。
function applyData(target, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!key.includes('.') && !key.includes('[')) {
      target[key] = value
      continue
    }
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (const part of parts.slice(0, -1)) cursor = cursor[part]
    cursor[parts[parts.length - 1]] = value
  }
}

function loadPage(pagePath, identityStub, { options = {}, pageStack = [{}, {}], launchScene = 1001 } = {}) {
  delete require.cache[pagePath]
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: identityStub }
  let definition = null
  const calls = { navigate: [], switchTab: [], redirect: [], reLaunch: [], toast: [], modal: [], clipboard: [], downloads: [], saved: [], copyUrl: [] }
  const storage = {}
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pageStack
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 283, top: 50, width: 87, height: 32 }),
    showShareMenu: () => {},
    navigateTo: (opts) => calls.navigate.push(opts.url),
    navigateBack: () => calls.navigate.push('back'),
    redirectTo: (opts) => calls.redirect.push(opts.url),
    switchTab: (opts) => calls.switchTab.push(opts.url),
    showToast: (opts) => calls.toast.push(opts.title),
    showModal: (opts) => calls.modal.push(opts.title),
    setClipboardData: (opts) => { calls.clipboard.push(opts.data); if (opts.success) opts.success() },
    downloadFile: (opts) => {
      calls.downloads.push(opts.url)
      opts.success({ statusCode: 200, tempFilePath: 'wxfile://poster.png' })
    },
    saveImageToPhotosAlbum: (opts) => { calls.saved.push(opts.filePath); opts.success() },
    reLaunch: (opts) => calls.reLaunch.push(opts.url),
    getLaunchOptionsSync: () => ({ scene: launchScene, query: {} }),
    onCopyUrl: (handler) => calls.copyUrl.push(handler),
    offCopyUrl: (handler) => { calls.copyUrl = calls.copyUrl.filter((item) => item !== handler) },
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  }
  require(pagePath)
  delete require.cache[identityPath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, callback) { applyData(this.data, values); if (callback) callback() }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls, options, storage }
}

test('rewards split into available and locked cash amounts', () => {
  const now = Date.parse('2026-09-26T12:00:00+08:00')
  const balance = view.buildBalance([
    { status: 'available', amount: '12.50' },
    { status: 'available', amount: 7.5 },
    { status: 'cash_available', amount: '5' },
    { status: 'locked', amount: '30', locked_until: '2026-09-30T12:00:00+08:00' },
    { status: 'locked', amount: '4', locked_until: '2026-09-25T12:00:00+08:00' },
    { status: 'settled', amount: '99' },
    { status: 'recovered', amount: '5' }
  ], now)
  assert.equal(balance.availableValue, '29.00', '提现被驳回退回的现金、已过锁定期的都算可用')
  assert.equal(balance.lockedValue, '30.00')
})

test('the balance card drops the available hint and spells out the lock rule in two full lines', () => {
  const balance = view.buildBalance([])
  assert.equal(balance.availableHint, undefined)
  assert.deepEqual(balance.lockedHintLines, ['锁定期7天', '7天之后可提现'])
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../agent/promotion/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../agent/promotion/index.wxss'), 'utf8')
  assert.equal(wxml.includes('availableHint'), false)
  assert.match(wxml, /wx:for="\{\{balance\.lockedHintLines\}\}"/)
  const hintRule = /\.promotion-balance-metric-hint \{([^}]*)\}/.exec(wxss)[1]
  assert.equal(/ellipsis|nowrap/.test(hintRule), false, '锁定规则不能再被截成省略号')
})

test('poster validity and status come from the real expiry time', () => {
  const [forever, endingSoon, ended] = view.buildPosters([
    asset({ id: '1', expiresAt: '' }),
    asset({ id: '2', expiresAt: '2026-09-22T12:00:00+08:00' }),
    asset({ id: '3', expiresAt: '2026-09-19T12:00:00+08:00' })
  ], NOW)
  assert.deepEqual([forever.statusLabel, forever.validityLabel], ['进行中', '长期有效'])
  assert.deepEqual([endingSoon.statusLabel, endingSoon.statusTone], ['即将结束', 'warning'])
  assert.deepEqual([ended.statusLabel, ended.validityLabel], ['已结束', '2026.09.19'])
})

test('a poster without an original file falls back to the cover for saving', () => {
  const [withFile, coverOnly] = view.buildPosters([
    asset({ id: '1' }),
    asset({ id: '2', assetFile: null })
  ], NOW)
  assert.equal(withFile.fileSrc, 'https://assets.example/poster-full.png')
  assert.equal(coverOnly.fileSrc, 'https://assets.example/poster.png')
})

test('image dimensions pick the closest card ratio', () => {
  assert.equal(view.matchRatioClass(1080, 1920), 'ratio-9-16')
  assert.equal(view.matchRatioClass(1200, 1200), 'ratio-1-1')
  assert.equal(view.matchRatioClass(900, 1200), 'ratio-3-4')
  assert.equal(view.matchRatioClass(0, 0), 'ratio-3-4')
})

test('the workbench shows real rewards and splits posters into two columns', async () => {
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({
      promoter: { id: 1, status: 'active', promotion_code: 'pm04_demo' },
      rewards: [{ status: 'available', amount: '18' }, { status: 'locked', amount: '2' }]
    }),
    loadPublishedPromotionAssets: async () => ({
      status: 'ready',
      assets: [asset({ id: '1' }), asset({ id: '2' }), asset({ id: '3' })]
    })
  })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.balance.availableValue, '18.00')
  assert.equal(page.data.balance.lockedValue, '2.00')
  assert.equal(page.data.statusNotice.visible, false)
  assert.equal(page.data.posterState, 'ready')
  assert.deepEqual(page.data.posterColumns.map((column) => column.length), [2, 1])
})

test('an account without a promoter profile sees the posters and no eligibility notice', async () => {
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({ promoter: null, rewards: [] }),
    loadPublishedPromotionAssets: async () => ({ status: 'ready', assets: [asset({ id: '1' }), asset({ id: '2' })] })
  })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.statusNotice.visible, false)
  assert.equal(page.data.posterState, 'ready')
  assert.deepEqual(page.data.posterColumns.map((column) => column.length), [1, 1])
})

test('an old backend that still gates materials degrades to an empty poster shelf, not an upsell', async () => {
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({ promoter: null, rewards: [] }),
    loadPublishedPromotionAssets: async () => ({ status: 'promoter_inactive', assets: [] })
  })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.statusNotice.visible, false)
  assert.equal(page.data.posterState, 'empty')
  assert.equal(page.data.posterEmptyTitle, '暂无已发布海报')
})

test('the settlement centre still tells an account without a promoter profile to open one first', () => {
  const notice = view.buildPartnerNotice(null, 'settlement')
  assert.equal(notice.visible, true)
  assert.equal(notice.title, '提现需开通推广伙伴')
  assert.match(notice.copy, /申请成为推广伙伴/)
  assert.equal(notice.copy.includes('推广海报人人可用'), false)
  // 2026-09-29 起推广伙伴在小程序申请（基础核验 → 刷脸 → 提交，后台审核开通）
  assert.deepEqual([notice.action, notice.url], ['apply', '/agent/partner-apply/index'])
  assert.equal('gate' in notice, false)
  assert.equal(view.buildPartnerNotice(null, 'promotion').visible, false)
  assert.equal(view.buildPartnerNotice({ status: 'inactive' }, 'promotion').visible, false)
  assert.equal(view.buildPartnerNotice({ status: 'suspended' }, 'promotion').visible, false)
  assert.equal(view.buildPartnerNotice({ status: 'inactive' }, 'settlement').title, '提现需开通推广伙伴')
  assert.equal(view.buildPartnerNotice({ status: 'suspended' }, 'settlement').title, '推广资格暂不可用')
  assert.equal(view.buildPartnerNotice({ status: 'active' }, 'settlement').visible, false)
})

test('a poster cover load updates only that card ratio', async () => {
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({ promoter: { status: 'active' }, rewards: [] }),
    loadPublishedPromotionAssets: async () => ({ status: 'ready', assets: [asset({ id: '1' }), asset({ id: '2' })] })
  })
  page.onLoad()
  await page.loadPage()
  page.handlePosterLoad({ currentTarget: { dataset: { column: 1, index: 0 } }, detail: { width: 1080, height: 1920 } })
  assert.equal(page.data.posterColumns[1][0].ratioClass, 'ratio-9-16')
  assert.equal(page.data.posterColumns[0][0].ratioClass, 'ratio-3-4')
})

test('returning to the workbench keeps measured poster ratios and the loaded cover address', async () => {
  // 回到本页 onShow 会重新读取：每次读取签名地址都不同；封面文件没变时不能退回 3:4 再重新撑开。
  let round = 0
  let materialsFail = false
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({ promoter: { status: 'active' }, rewards: [] }),
    loadPublishedPromotionAssets: async () => {
      if (materialsFail) throw new Error('网络异常')
      round += 1
      return {
        status: 'ready',
        assets: [
          asset({ id: '1', coverImage: { id: '81', url: `https://assets.example/a.png?sign=${round}` } }),
          asset({ id: '2', coverImage: { id: round === 1 ? '82' : '92', url: `https://assets.example/b.png?sign=${round}` } })
        ]
      }
    }
  })
  page.onLoad()
  await page.onShow()
  page.handlePosterLoad({ currentTarget: { dataset: { column: 0, index: 0 } }, detail: { width: 1080, height: 1920 } })
  page.handlePosterLoad({ currentTarget: { dataset: { column: 1, index: 0 } }, detail: { width: 1080, height: 1920 } })

  await page.onShow()
  const [[kept], [replaced]] = page.data.posterColumns
  assert.equal(kept.ratioClass, 'ratio-9-16')
  assert.equal(kept.coverSrc, 'https://assets.example/a.png?sign=1')
  // 后台换了封面文件：按新图重新量
  assert.equal(replaced.ratioClass, 'ratio-3-4')
  assert.equal(replaced.coverSrc, 'https://assets.example/b.png?sign=2')

  // 刷新时海报读取失败：保留已显示的海报，不换成错误提示
  materialsFail = true
  await page.onShow()
  assert.equal(page.data.posterState, 'ready')
  assert.equal(page.data.posterColumns[0][0].ratioClass, 'ratio-9-16')
})

test('a cover address older than the reuse window is swapped for the fresh one without losing the ratio', async () => {
  let round = 0
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({ promoter: { status: 'active' }, rewards: [] }),
    loadPublishedPromotionAssets: async () => {
      round += 1
      return { status: 'ready', assets: [asset({ id: '1', coverImage: { id: '81', url: `https://assets.example/a.png?sign=${round}` } })] }
    }
  })
  page.onLoad()
  await page.onShow()
  page.handlePosterLoad({ currentTarget: { dataset: { column: 0, index: 0 } }, detail: { width: 1080, height: 1920 } })
  page._coverSrcSince -= 13 * 60 * 60 * 1000
  await page.onShow()
  assert.equal(page.data.posterColumns[0][0].coverSrc, 'https://assets.example/a.png?sign=2')
  assert.equal(page.data.posterColumns[0][0].ratioClass, 'ratio-9-16')
})

test('the workbench surfaces a material read failure without losing the rewards card', async () => {
  const { page } = loadPage(workbenchPath, {
    loadCurrentGrowthCenter: async () => ({ promoter: { status: 'active' }, rewards: [{ status: 'available', amount: '3' }] }),
    loadPublishedPromotionAssets: async () => { throw new Error('宣传素材暂时无法读取，请稍后重试。') }
  })
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.balance.availableValue, '3.00')
  assert.equal(page.data.posterState, 'failed')
})

function loadDetail(overrides = {}, pageOptions = {}) {
  const invitations = []
  const composeCalls = []
  const stub = {
    loadPublishedPromotionAssets: async () => ({ status: 'ready', assets: [asset({ id: '71' })] }),
    loadCurrentGrowthCenter: async () => ({ promoter: { status: 'active', promotion_code: 'pm04_demo' }, rewards: [] }),
    createCurrentPromoterInvitation: async (input) => {
      invitations.push(input)
      return { invitation: { code: 'INV-1' }, sharePath: '/pages/referral-entry/index?token=abcdefghijklmnop' }
    },
    loadCurrentPromotionPosterParts: async (assetId) => {
      composeCalls.push({ assetId })
      return {
        posterUrl: 'https://assets.example/poster-full.png',
        qrUrl: 'https://assets.example/my-qr.png',
        promotionCode: 'ZLK7M2X4QP'
      }
    },
    ...overrides
  }
  const loaded = loadPage(detailPath, stub, pageOptions)
  return { ...loaded, invitations, composeCalls }
}

test('the mini-program code sits in a white circle at the bottom-right corner', () => {
  // 微信小程序码最小 280×280，贴在 1024 宽的海报上占 27%；改由前端画成 14%，正好小一半。
  // 白色圆底比码大一圈（扫码安静区），码画在圆心；整块距右/下边缘各 5%。
  const layout = view.posterQrLayout(1024, 1360)
  assert.equal(layout.size, 143, '码占宽度 14%')
  assert.equal(layout.badge, 174, '白底圆直径 = 码 × 1.22')
  assert.equal(1024 - (layout.badgeX + layout.badge), 51, '距右边缘 5%')
  assert.equal(1360 - (layout.badgeY + layout.badge), 51, '距下边缘 5%')
  // 尺寸取整后居中最多差半像素（码 143 是奇数、圆底 174 是偶数），视觉上无差别
  assert.ok(Math.abs(layout.x + layout.size / 2 - layout.centerX) <= 1, '码在白底圆的正中')
  assert.ok(Math.abs(layout.y + layout.size / 2 - layout.centerY) <= 1)
  assert.equal(layout.radius, 87)
  // 生成海报时要求模型留白的右下角 25% 区域，必须罩得住实际占用的这一带
  assert.ok(layout.badgeX > 1024 * 0.75, '白底圆不能越过留白区左边界')

  assert.equal(view.posterQrLayout(2048, 2720).size, 287, '比例随海报尺寸走')
  assert.equal(view.posterQrLayout(0, 100), null)
  assert.equal(view.posterQrLayout('x', 'y'), null)
})

test('promoting composes my own mini-program code into the poster and saves that composed image', async () => {
  const { page, calls, composeCalls } = loadDetail()
  await page.onLoad({ id: '71' })
  const drawn = []
  page.drawShareImage = async (parts) => { drawn.push(parts); return 'wxfile://composed.png' }
  await page.handlePromoteAction()
  assert.deepEqual(composeCalls, [{ assetId: 71 }])
  assert.deepEqual(drawn, [{
    posterUrl: 'https://assets.example/poster-full.png',
    qrUrl: 'https://assets.example/my-qr.png',
    promotionCode: 'ZLK7M2X4QP'
  }])
  assert.equal(page.data.shareImageSrc, 'wxfile://composed.png')
  assert.equal(page.data.promotionCode, 'ZLK7M2X4QP', '邀请码以后端下发的为准')
  assert.equal(page.data.composeFailed, false)
  // 2026-11-10 起分享不带邀请码，好友点开直接进小程序
  assert.equal(page.onShareTimeline().query, '')

  // 合成图已经是本地文件，保存时不该再走一次下载
  await page.handleSavePoster()
  assert.deepEqual(calls.downloads, [])
  assert.deepEqual(calls.saved, ['wxfile://composed.png'])
})

test('a failed composition still lets the user share and save the plain poster', async () => {
  const { page, calls } = loadDetail({
    loadCurrentPromotionPosterParts: async () => { throw new Error('小程序码生成失败，请稍后重试。') }
  })
  await page.onLoad({ id: '71' })
  await page.handlePromoteAction()
  assert.equal(page.data.composeFailed, true)
  assert.equal(page.data.showPromoteSheet, true)
  await page.handleSavePoster()
  assert.deepEqual(calls.downloads, ['https://assets.example/poster-full.png'], '退回素材原图')
})

test('the detail page renders the requested poster with the real promotion code', async () => {
  const { page } = loadDetail()
  await page.onLoad({ id: '71' })
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.poster.label, '开学季学习礼包')
  assert.equal(page.data.poster.campaignLabel, '开学季活动')
  assert.equal(page.data.promotionCode, 'pm04_demo')
  assert.match(page.data.posterPreviewStyle, /^width: \d+px; height: \d+px;$/)
})

test('a viewer without a promoter profile still opens the poster detail and can share it', async () => {
  const { page } = loadDetail({
    loadCurrentGrowthCenter: async () => ({ promoter: null, rewards: [] }),
    createCurrentPromoterInvitation: async () => { throw new Error('当前推广伙伴资格不可用。') }
  })
  await page.onLoad({ id: '71' })
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.promotionCode, '')
  await page.handlePromoteAction()
  assert.equal(page.data.showPromoteSheet, true)
  assert.equal(page.onShareAppMessage().path, '/pages/home/index')
})

test('an unknown or withdrawn poster id fails instead of showing another poster', async () => {
  const { page } = loadDetail()
  await page.onLoad({ id: '999' })
  assert.equal(page.data.loadState, 'failed')
  assert.match(page.data.loadError, /已下架/)
})

test('the moments card and copied link never carry the poster id', async () => {
  const { page, calls } = loadDetail({
    loadCurrentGrowthCenter: async () => ({ promoter: { status: 'active', promotion_code: 'zlk7m2x4qp' }, rewards: [] })
  })
  await page.onLoad({ id: '71' })
  assert.equal(page.onShareTimeline().query, '')
  page.onShow()
  assert.equal(calls.copyUrl.length, 1)
  assert.deepEqual(calls.copyUrl[0](), { query: '' })
  page.onShow()
  assert.equal(calls.copyUrl.length, 1, '回到页面不重复注册')
  page.onHide()
  assert.equal(calls.copyUrl.length, 0, '离开页面就注销，不影响别的页面复制链接')
})

test('a friend opening the shared page from moments sees an invitation note instead of an error', async () => {
  let loaded = 0
  const { page, calls, storage } = loadDetail({
    loadPublishedPromotionAssets: async () => { loaded += 1; return { status: 'ready', assets: [] } },
    loadCurrentGrowthCenter: async () => { loaded += 1; return null }
  }, { launchScene: 1154 })
  await page.onLoad({ pc: 'ZLK7M2X4QP' })
  assert.equal(page.data.loadState, 'timeline')
  assert.equal(loaded, 0, '单页模式不能登录，不读要登录的推广数据')
  assert.deepEqual(calls.reLaunch, [], '单页模式不能跳页')
  assert.equal(storage.pending_referral_context, undefined, '2026-11-10 起不再记推荐人线索')
  assert.equal(page.onShareTimeline().query, '')
})

test('opening the shared page inside the full mini program goes home', async () => {
  const { page, calls, storage } = loadDetail({}, { launchScene: 1155 })
  await page.onLoad({ token: 'abcdefghijklmnop' })
  assert.deepEqual(calls.reLaunch, ['/pages/home/index'])
  assert.equal(storage.pending_referral_context, undefined)
  assert.notEqual(page.data.loadState, 'failed')
})

test('a failed invitation still opens the share sheet and shares the plain home path', async () => {
  const { page } = loadDetail({ createCurrentPromoterInvitation: async () => { throw new Error('当前推广伙伴资格不可用。') } })
  await page.onLoad({ id: '71' })
  await page.handlePromoteAction()
  assert.equal(page.data.showPromoteSheet, true)
  assert.equal(page.onShareAppMessage().path, '/pages/home/index')
})

test('saving the poster downloads the backend file and writes it to the album', async () => {
  const { page, calls } = loadDetail()
  await page.onLoad({ id: '71' })
  await page.handleSavePoster()
  assert.deepEqual(calls.downloads, ['https://assets.example/poster-full.png'])
  assert.deepEqual(calls.saved, ['wxfile://poster.png'])
  assert.deepEqual(calls.toast, ['已保存到相册'])
  assert.equal(page.data.savingPoster, false)
})

test('copying the promotion code and the material copy uses the clipboard', async () => {
  const { page, calls } = loadDetail()
  await page.onLoad({ id: '71' })
  page.handleCopyPromotionCode()
  page.handleCopyText()
  assert.deepEqual(calls.clipboard, ['pm04_demo', '邀请好友一起开启高效学习。'])
  assert.equal(page.data.promotionCodeCopied, true)
})
