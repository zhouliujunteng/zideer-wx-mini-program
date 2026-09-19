const config = require('../config/index')

// 界面图片一律由后端下发（2026-09-19 用户规则）：小程序包内不放图片，只保留微信原生 tabBar 必需的本地图标。
// 素材存在 Zion 表 ui_asset（素材键 asset_key + 图片 image），游客与已登录用户均只读，
// 所以这里不带登录凭证直接查询，启动页、登录页在登录前也能显示图片。
// 图片地址是带时效的签名链接（约两天），因此每次启动都重新拉取；本地缓存只用于先显示、12 小时内有效。
// 模板侧用 utils/ui-asset.wxs 按路径取地址，素材键 = 路径中 "assets/" 之后的部分。

const STORAGE_KEY = 'ui_assets_v1'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const QUERY = 'query LoadUiAssets { ui_asset(where: {enabled: {_eq: true}}) { asset_key image { url } } }'

let memoryMap = null
let fetchedThisLaunch = false
let inFlight = null

function readStoredMap(now = Date.now()) {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY)
    if (stored && stored.map && now - Number(stored.fetchedAt) < CACHE_TTL_MS) return stored
  } catch (error) {}
  return null
}

function toMap(rows) {
  const map = {}
  for (const row of rows || []) {
    const key = String(row && row.asset_key || '')
    const url = row && row.image && row.image.url
    if (key && url) map[key] = String(url)
  }
  return map
}

function requestAssets() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.GRAPHQL_URL,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { query: QUERY },
      timeout: 15000,
      success: (response) => {
        const body = response && response.data
        if (response.statusCode !== 200 || !body || !body.data || !Array.isArray(body.data.ui_asset)) {
          reject(new Error('界面素材加载失败'))
          return
        }
        resolve(toMap(body.data.ui_asset))
      },
      fail: () => reject(new Error('界面素材加载失败'))
    })
  })
}

// 当前可用的素材表：内存 → 未过期的本地缓存 → 空表。
function getUiAssets() {
  if (memoryMap) return memoryMap
  const stored = readStoredMap()
  if (stored) memoryMap = stored.map
  return memoryMap || {}
}

// 拉取最新素材表：每次启动的第一次调用必定请求后端，之后本次启动内复用；并发调用共用同一个请求。
// 失败时保留已有的表（内存或本地缓存）并把错误抛给调用方，下次调用会重试。
function loadUiAssets({ force = false } = {}) {
  if (!force && fetchedThisLaunch) return Promise.resolve(memoryMap)
  if (inFlight) return inFlight
  inFlight = requestAssets().then((map) => {
    memoryMap = map
    fetchedThisLaunch = true
    try { wx.setStorageSync(STORAGE_KEY, { map, fetchedAt: Date.now() }) } catch (error) {}
    return map
  }).finally(() => { inFlight = null })
  return inFlight
}

// 页面 / 组件在 onLoad（或 attached）里调用：先用手头的表渲染，本次启动的最新表到达后再刷新一次。
function attachUiAssets(target) {
  const current = getUiAssets()
  target.setData({ ui: current })
  return loadUiAssets().then((map) => {
    if (map !== current) target.setData({ ui: map })
    return map
  }).catch(() => current)
}

module.exports = { getUiAssets, loadUiAssets, attachUiAssets, _toMap: toMap }
