const { loadUiAssets, getUiAssets } = require('./ui-assets')
const { COVER_WIDTH, COVER_HEIGHT, COVER_SCALE, coverAssetKeys, drawShareCover } = require('../utils/share-cover')

// 分享卡片封面的画法见 utils/share-cover.js；这里负责在页面里真正画出来：
// 页面放一块藏起来的 2d 画布（<canvas type="2d" id="share-cover-canvas" class="share-cover-canvas">，样式在 app.wxss），
// 先把后端素材下到本地，画好导出成本地图片，交给 onShareAppMessage 的 imageUrl。
// 同一张封面（按 key）只画一次；一块画布同时只画一张，排队画。画失败返回空串，下次分享再试，
// 这时卡片用微信默认的页面截图，不拿别的图顶替。

const DEFAULT_CANVAS_ID = 'share-cover-canvas'

// 画布不能直接画网络图片：先 getImageInfo 下到本地（素材域名已在 downloadFile 合法域名里，打卡页海报同样这么做）
function downloadAssets(keys) {
  const read = () => loadUiAssets().catch(() => getUiAssets())
  return read().then((map) => Promise.all(Object.keys(keys).map((name) => new Promise((resolve) => {
    const url = map && keys[name] && map[keys[name]]
    if (!url || !wx.getImageInfo) return resolve([name, ''])
    wx.getImageInfo({ src: url, success: (info) => resolve([name, info.path || '']), fail: () => resolve([name, '']) })
  })))).then((pairs) => pairs.reduce((all, [name, path]) => ({ ...all, [name]: path }), {}))
}

function canvasImage(canvas, path) {
  return new Promise((resolve) => {
    if (!path || typeof canvas.createImage !== 'function') return resolve(null)
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = path
  })
}

// options：{ iconKey（图标的包内路径 /assets/…），text: { kicker, title, label }, canvasId }
function renderShareCover(page, options = {}) {
  const canvasId = options.canvasId || DEFAULT_CANVAS_ID
  return new Promise((resolve) => {
    if (!page || typeof page.createSelectorQuery !== 'function') return resolve('')
    page.createSelectorQuery().select(`#${canvasId}`).fields({ node: true, size: true }).exec(async (result) => {
      const canvas = result && result[0] && result[0].node
      if (!canvas) return resolve('')
      try {
        const paths = await downloadAssets(coverAssetKeys(options.iconKey))
        const [background, logo, icon] = await Promise.all([paths.background, paths.logo, paths.icon].map((path) => canvasImage(canvas, path)))
        canvas.width = COVER_WIDTH * COVER_SCALE
        canvas.height = COVER_HEIGHT * COVER_SCALE
        const ctx = canvas.getContext('2d')
        ctx.scale(COVER_SCALE, COVER_SCALE)
        drawShareCover(ctx, options.text || {}, { background, logo, icon })
      } catch (error) {
        return resolve('')
      }
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        success: (file) => resolve((file && file.tempFilePath) || ''),
        fail: () => resolve('')
      })
    })
  })
}

function coverKey(options = {}) {
  const text = options.text || {}
  return [options.iconKey || '', text.kicker || '', text.title || '', text.label || ''].join('|')
}

// 画（或取已画好的）封面，返回本地图片路径；画不出来时返回空串
function prepareShareCover(page, options = {}) {
  const key = coverKey(options)
  const covers = page._shareCovers || (page._shareCovers = {})
  if (covers[key]) return covers[key].task
  const entry = { path: '' }
  const queue = page._shareCoverQueue || Promise.resolve()
  entry.task = queue.then(() => renderShareCover(page, options)).then((path) => {
    entry.path = path
    // 画失败的不记，下次再试
    if (!path && covers[key] === entry) delete covers[key]
    return path
  })
  page._shareCoverQueue = entry.task
  covers[key] = entry
  return entry.task
}

// 已经画好的封面路径（还没画好就是空串）
function readyShareCover(page, options = {}) {
  const entry = page._shareCovers && page._shareCovers[coverKey(options)]
  return (entry && entry.path) || ''
}

// onShareAppMessage 的返回值：封面画好了直接带上；还没画好交给 promise，
// 微信等它 3 秒，画好就用，超时用 share 本身（默认页面截图）
function shareWithCover(page, share, options = {}) {
  const ready = readyShareCover(page, options)
  if (ready) return { ...share, imageUrl: ready }
  return { ...share, promise: prepareShareCover(page, options).then((imageUrl) => (imageUrl ? { ...share, imageUrl } : share)) }
}

module.exports = { renderShareCover, prepareShareCover, readyShareCover, shareWithCover }
