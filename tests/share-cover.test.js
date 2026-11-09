// 分享卡片封面（2026-10-04 用户要求）：老师发给学生的专属诊断会议、海报 / 小程序链接页的邀请好友卡片，
// 都照操作指南分享封面的样子画（utils/share-cover.js），诊断会议要打上学生的名字。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const { drawShareCover, coverAssetKeys } = require('../utils/share-cover')
const { buildInviteCoverText, inviteCoverOptions } = require('../services/agent-invite-view')
const { inviteFriendCover } = require('../services/promotion-view')

function recordingContext() {
  const calls = []
  const noop = () => {}
  const ctx = new Proxy({
    font: '',
    measureText: (text) => ({ width: String(text).length * 30 }),
    fillText(text, x, y) { calls.push(['text', text, x, y, this.font]) },
    drawImage: (image, x, y, width, height) => calls.push(['image', image.name, x, y, width, height]),
    createLinearGradient: () => ({ addColorStop: noop })
  }, { get: (target, key) => (key in target ? target[key] : noop), set: (target, key, value) => { target[key] = value; return true } })
  return { ctx, calls }
}

test('the meeting cover leads with the student name, then 专属诊断会议 and the grade, subject and an absolute start time', () => {
  const at = new Date(2026, 9, 5, 19, 30).toISOString()
  assert.deepEqual(buildInviteCoverText({ studentName: ' 张小明 ', grade: 8, subject: '数学', scheduledOnlineAt: at }), {
    kicker: '张小明同学', title: '专属诊断会议', label: '初二数学 · 10月5日 周一 19:30'
  })
  // 已经叫「某同学」的不再加；没有名字、年级、时间的就省掉那一段，不用占位词
  assert.equal(buildInviteCoverText({ studentName: '李同学', subject: '英语' }).kicker, '李同学')
  assert.deepEqual(buildInviteCoverText({ subject: '物理' }), { kicker: '', title: '专属诊断会议', label: '物理' })
  assert.doesNotMatch(buildInviteCoverText({ studentName: '小鹿', subject: '数学', scheduledOnlineAt: at }).label, /今天|明天|后天/)
  assert.equal(inviteCoverOptions({ studentName: '小鹿' }).iconKey, '/assets/help/share-meeting.png')
})

test('the invite-a-friend cover shows the invite code only when it is a real one', () => {
  assert.deepEqual(inviteFriendCover('zlk7m2x4qp'), {
    iconKey: '/assets/help/guide-invite.png',
    text: { kicker: '好友邀请你', title: '一起来知鹿学习', label: '邀请码 ZLK7M2X4QP' }
  })
  assert.equal(inviteFriendCover('').text.label, '')
  assert.equal(inviteFriendCover('not-a-code').text.label, '')
})

test('a cover with a kicker stacks logo, icon, name, title and pill in the middle, all centred and inside the card', () => {
  const { ctx, calls } = recordingContext()
  const images = { background: { name: 'bg' }, logo: { name: 'logo', width: 480, height: 190 }, icon: { name: 'icon' } }
  drawShareCover(ctx, { kicker: '张小明同学', title: '专属诊断会议', label: '初二数学 · 10月5日 周一 19:30' }, images)
  assert.deepEqual(calls.filter((call) => call[0] === 'image').map((call) => call[1]), ['bg', 'logo', 'icon'])
  const texts = calls.filter((call) => call[0] === 'text')
  assert.deepEqual(texts.map((call) => call[1]), ['张小明同学', '专属诊断会议', '初二数学 · 10月5日 周一 19:30'])
  assert.ok(texts.every((call) => call[2] === 250), 'all text is centred')
  assert.ok(texts[0][3] < texts[1][3] && texts[1][3] < texts[2][3], 'name above title above pill')
  const icon = calls.find((call) => call[1] === 'icon')
  assert.ok(icon[4] < 116, 'the icon shrinks a little to make room for the name')
  assert.ok(calls.find((call) => call[1] === 'logo')[3] > 20 && texts[2][3] < 380, 'everything stays inside the 500×400 card')

  // 没有名字的那一行就不画，也不留空
  calls.length = 0
  drawShareCover(ctx, { title: '专属诊断会议' }, { background: null, logo: null, icon: null })
  assert.deepEqual(calls.filter((call) => call[0] === 'text').map((call) => call[1]), ['专属诊断会议'])
  assert.deepEqual(calls.filter((call) => call[0] === 'image'), [])
})

test('cover assets are written as package paths so verify-ui-assets sees them, and the meeting icon is in the upload script', () => {
  assert.deepEqual(coverAssetKeys('/assets/help/share-meeting.png'), {
    background: 'help/share-cover.jpg', logo: 'home/brand-logo.png', icon: 'help/share-meeting.png'
  })
  assert.match(read('utils/share-cover.js'), /'\/assets\/help\/share-cover\.jpg'/)
  assert.match(read('utils/share-cover.js'), /'\/assets\/home\/brand-logo\.png'/)
  assert.match(read('../scripts/ui-assets/upload-help-center-assets.mjs'), /key: 'help\/share-meeting\.png', file: 'help-center\/share-meeting\.png'/)
  assert.ok(fs.existsSync(path.join(root, '../scripts/ui-assets/help-center/share-meeting.png')))
})

function loadShareCoverService({ assets = {}, canvasNode = true, exportPath = 'wxfile://cover.png' } = {}) {
  const log = { exports: 0, downloads: [], drawn: [] }
  const canvas = canvasNode ? {
    width: 0,
    height: 0,
    createImage() {
      const image = {}
      Object.defineProperty(image, 'src', { set(value) { image.name = value; setTimeout(() => image.onload(), 0) } })
      return image
    },
    getContext: () => new Proxy({ measureText: (text) => ({ width: String(text).length * 30 }), createLinearGradient: () => ({ addColorStop() {} }), fillText: (text) => log.drawn.push(text) }, { get: (target, key) => (key in target ? target[key] : () => {}), set: () => true })
  } : null
  const sandbox = {
    module: { exports: {} },
    setTimeout,
    wx: {
      getImageInfo: ({ src, success }) => { log.downloads.push(src); success({ path: `local:${src}` }) },
      canvasToTempFilePath: ({ success }) => { log.exports += 1; success({ tempFilePath: exportPath }) }
    },
    require(name) {
      if (name === './ui-assets') return { loadUiAssets: async () => assets, getUiAssets: () => assets }
      if (name === '../utils/share-cover') return require('../utils/share-cover')
      throw new Error(`Unexpected import ${name}`)
    }
  }
  vm.runInNewContext(read('services/share-cover.js'), sandbox)
  const page = {
    createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: (callback) => setTimeout(() => callback([{ node: canvas }]), 0) }) }) })
  }
  return { service: sandbox.module.exports, page, log }
}

test('a cover is drawn once per text, handed to the share card, and a failed draw is retried next time', async () => {
  const assets = { 'help/share-cover.jpg': 'https://cdn/bg.jpg', 'home/brand-logo.png': 'https://cdn/logo.png', 'help/share-meeting.png': 'https://cdn/meeting.png' }
  const { service, page, log } = loadShareCoverService({ assets })
  const options = inviteCoverOptions({ studentName: '小鹿', grade: 8, subject: '数学' })
  const share = { title: '【小鹿】初二数学专属诊断会议', path: '/learning/agent-invite/index?token=tk1' }

  const pending = service.shareWithCover(page, share, options)
  assert.equal(pending.imageUrl, undefined)
  assert.deepEqual({ ...(await pending.promise) }, { ...share, imageUrl: 'wxfile://cover.png' })
  assert.deepEqual(log.downloads.sort(), ['https://cdn/bg.jpg', 'https://cdn/logo.png', 'https://cdn/meeting.png'])
  assert.deepEqual(log.drawn, ['小鹿同学', '专属诊断会议', '初二数学'])

  // 画好之后直接带图，不再重画
  assert.deepEqual({ ...service.shareWithCover(page, share, options) }, { ...share, imageUrl: 'wxfile://cover.png' })
  await service.prepareShareCover(page, options)
  assert.equal(log.exports, 1)

  // 文字变了（比如改了时间）是另一张封面
  await service.prepareShareCover(page, inviteCoverOptions({ studentName: '小鹿', grade: 8, subject: '英语' }))
  assert.equal(log.exports, 2)

  // 页面里拿不到画布：返回空串、不记下，下次分享再试；卡片退回微信默认截图
  const broken = loadShareCoverService({ assets, canvasNode: false })
  assert.equal(await broken.service.prepareShareCover(broken.page, options), '')
  assert.equal(broken.service.readyShareCover(broken.page, options), '')
  assert.deepEqual({ ...(await broken.service.shareWithCover(broken.page, share, options).promise) }, share)
})

test('every page that shares a meeting or an invite carries the off-screen canvas and draws its own cover', () => {
  assert.match(read('app.wxss'), /\.share-cover-canvas \{ position: fixed; top: -9999px; left: -9999px; width: 500px; height: 400px;/)
  for (const page of ['teacher/student-detail', 'learning/agent-invite', 'agent/share-link', 'agent/poster-detail', 'account/help-guide']) {
    const wxml = read(`${page}/index.wxml`)
    assert.equal((wxml.match(/<canvas type="2d" id="share-cover-canvas" class="share-cover-canvas"/g) || []).length, 1, `${page} needs exactly one cover canvas`)
    // 画布在页面最外层，不能被 wx:if 包住：数据读到之前也要拿得到节点
    assert.match(wxml, /<canvas type="2d" id="share-cover-canvas"[^>]*><\/canvas>\n<dev-reset-fab \/>|<canvas type="2d" id="share-cover-canvas" class="share-cover-canvas"><\/canvas>\n\n  <view wx:if="\{\{guide\}\}" class="hg-bar">/, `${page} canvas sits outside the conditional blocks`)
  }
  for (const page of ['teacher/student-detail', 'learning/agent-invite', 'agent/share-link', 'agent/poster-detail']) {
    assert.match(read(`${page}/index.js`), /return (code \? )?shareWithCover\(this, share, /, `${page} hands the cover to its share card`)
  }
  assert.match(read('teacher/student-detail/index.js'), /inviteCoverOptions\(\{\n\s+studentName: this\.data\.profile\.displayName,/)
  // 海报卡片不再拿海报原图当封面
  assert.doesNotMatch(read('agent/poster-detail/index.js').match(/onShareAppMessage\(\) \{[\s\S]*?\n  \},/)[0], /coverSrc/)
})

test('the teacher share card for an invite carries the named meeting cover once it is drawn', async () => {
  let definition
  const invites = [{ inviteId: 'i1', token: 'tk1', subject: '数学', scheduledOnlineAt: new Date(2026, 9, 5, 19, 30).toISOString(), status: 'pending', isLatest: true, effective: true, hasVoice: true }]
  const prepared = []
  vm.runInNewContext(read('teacher/student-detail/index.js'), {
    Page: (page) => { definition = page },
    getCurrentPages: () => [{}, {}],
    setTimeout, clearTimeout,
    wx: { getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }), getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32 }), showToast() {} },
    require(name) {
      if (name.endsWith('/identity')) return { loadTeacherStudentProfile: async () => ({ profile: { displayName: '小鹿', grade: 8 }, invites }), loadTeacherStudentAgentCourses: async () => ({ courses: [] }), loadTeacherStudentAssessments: async () => [] }
      if (name.endsWith('/agent-invite-view')) return require('../services/agent-invite-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/study-plan-view')) return require('../utils/study-plan-view')
      if (name.endsWith('/daily-learning-view')) return require('../utils/daily-learning-view')
      if (name.endsWith('/services/share-cover')) {
        return {
          prepareShareCover: (page, options) => { prepared.push(options.text) },
          shareWithCover: (page, share, options) => ({ ...share, imageUrl: `cover:${options.text.kicker}|${options.text.label}` })
        }
      }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = value
    }
  } }
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  // 读到能分享的预约就先把封面画上
  assert.deepEqual(prepared, [{ kicker: '小鹿同学', title: '专属诊断会议', label: '初二数学 · 10月5日 周一 19:30' }])
  const share = page.onShareAppMessage({ target: { dataset: { token: 'tk1', subject: '数学', scheduledAt: invites[0].scheduledOnlineAt } } })
  assert.equal(share.path, '/learning/agent-invite/index?token=tk1')
  assert.equal(share.imageUrl, 'cover:小鹿同学|初二数学 · 10月5日 周一 19:30')
})
