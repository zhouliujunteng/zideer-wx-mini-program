const { loadShippingAddress, saveShippingAddress } = require('../../services/identity')
const { rpxToPx } = require('../../utils/screen')

// 收货地址（2026-11-14 用户要求）：自己手填收件人、手机号、省市区、详细地址，存课程服务（一人一条，/api/learn/shipping-address）。
// 原来直接调微信的收货地址（wx.chooseAddress），那个接口要在公众平台单独申请权限，没有权限时 app.json 的声明会挡住提审，
// 所以改成手填；省市区用小程序自带的地区选择器，不需要权限。存的字段名沿用微信地址那一套，课程服务不用改。
const PHONE = /^1\d{10}$/

function trim(value) { return String(value == null ? '' : value).trim() }

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    // 第一次读到前画骨架；读不到也照常给表单（自己填的东西不挡着），只提示可以重新读取
    loaded: false,
    loadFailed: false,
    hasAddress: false,
    userName: '',
    telNumber: '',
    region: [],
    regionText: '',
    detail: '',
    saving: false,
    canSave: false
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight, navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375)
    })
    this.load()
  },
  async load() {
    try {
      const address = await loadShippingAddress()
      const patch = { loaded: true, loadFailed: false, hasAddress: !!address }
      if (address && !this._edited) {
        const region = [address.province, address.city, address.county].map(trim)
        Object.assign(patch, {
          userName: trim(address.userName), telNumber: trim(address.telNumber),
          region: region[0] && region[1] ? region : [], regionText: region.filter(Boolean).join(' '),
          detail: [address.street, address.detail].map(trim).filter(Boolean).join('')
        })
      }
      this.setData(patch, () => this.updateCanSave())
    } catch (error) {
      this.setData({ loaded: true, loadFailed: true }, () => this.updateCanSave())
    }
  },
  retry() {
    this.setData({ loadFailed: false })
    return this.load()
  },
  updateCanSave() {
    const d = this.data
    const canSave = !d.saving && !!trim(d.userName) && PHONE.test(trim(d.telNumber)) && d.region.length >= 2 && !!trim(d.detail)
    if (canSave !== d.canSave) this.setData({ canSave })
  },
  handleInput(event) {
    const field = event.currentTarget.dataset.field
    if (['userName', 'telNumber', 'detail'].indexOf(field) < 0) return
    this._edited = true
    this.setData({ [field]: event.detail.value }, () => this.updateCanSave())
  },
  handleRegion(event) {
    const region = (event.detail.value || []).map(trim)
    this._edited = true
    this.setData({ region, regionText: region.filter(Boolean).join(' ') }, () => this.updateCanSave())
  },
  async handleSave() {
    if (this.data.saving) return
    const userName = trim(this.data.userName)
    const telNumber = trim(this.data.telNumber)
    const detail = trim(this.data.detail)
    const [provinceName, cityName, countyName] = this.data.region
    // 灰掉的按钮照样能点：缺什么说什么
    const missing = !userName ? '请填写收件人姓名' : !PHONE.test(telNumber) ? '请填写 11 位手机号' : !(provinceName && cityName) ? '请选择所在地区' : !detail ? '请填写详细地址' : ''
    if (missing) return wx.showToast({ title: missing, icon: 'none' })
    this.setData({ saving: true }, () => this.updateCanSave())
    try {
      await saveShippingAddress({ userName, telNumber, provinceName, cityName, countyName: countyName || '', detailInfo: detail })
      wx.showToast({ title: '收货地址已保存', icon: 'success' })
      setTimeout(() => this.handleBack(), 600)
    } catch (error) {
      wx.showToast({ title: error.message || '收货地址没有保存成功，请稍后重试。', icon: 'none', duration: 2600 })
      this.setData({ saving: false }, () => this.updateCanSave())
    }
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack()
    wx.switchTab({ url: '/pages/me/index' })
  }
})
