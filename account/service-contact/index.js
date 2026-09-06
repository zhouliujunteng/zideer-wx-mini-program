const { loadCurrentServiceContacts } = require('../../services/identity')

function safeUrl(value) {
  const url = String(value || '').trim()
  return url.length > 0 && url.length <= 2048 && /^https:\/\/[^\s]+$/i.test(url)
}

Page({
  data: {
    loading: true,
    failed: false,
    profileIncomplete: false,
    contacts: [],
    selectedUrl: '',
    selectedTitle: ''
  },

  onShow() {
    if (!this.data.selectedUrl) this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false, profileIncomplete: false, selectedUrl: '', selectedTitle: '' })
    try {
      const result = await loadCurrentServiceContacts()
      this.setData({ contacts: result.contacts, profileIncomplete: result.status === 'profile_incomplete' })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '服务入口加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openContact(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const contact = this.data.contacts.find((item) => item.id === id)
    if (!contact || !safeUrl(contact.targetRef)) {
      wx.showToast({ title: '该服务入口已失效，请刷新后重试', icon: 'none' })
      return
    }
    this.setData({ selectedUrl: contact.targetRef, selectedTitle: contact.title })
  },

  closeWebView() {
    this.setData({ selectedUrl: '', selectedTitle: '' })
  }
})
