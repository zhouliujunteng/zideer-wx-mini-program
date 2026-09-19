// 页面 onLoad 会通过 services/ui-assets 拉取界面素材（一次 wx.request）。
// 只关心页面业务请求的测试引入本文件，把素材服务换成不发请求的空实现，避免打乱请求计数与顺序。
const servicePath = require.resolve('../../services/ui-assets.js')

require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    attachUiAssets: () => Promise.resolve({}),
    loadUiAssets: () => Promise.resolve({}),
    getUiAssets: () => ({})
  }
}
