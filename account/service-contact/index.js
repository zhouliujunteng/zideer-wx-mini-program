const { loadCurrentServiceContacts } = require('../../services/identity')
const { isEnterpriseWechatContact, openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')

Page({
  data: {
    loading: true,
    failed: false,
    profileIncomplete: false,
    contacts: [],
    openingContactId: ''
  },

  onShow() {
    this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false, profileIncomplete: false, openingContactId: '' })
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

  async openContact(event) {
    if (this.data.openingContactId) return
    const id = String(event.currentTarget.dataset.id || '')
    const contact = this.data.contacts.find((item) => item.id === id)
    if (!isEnterpriseWechatContact(contact)) {
      wx.showToast({ title: '该服务入口已失效，请刷新后重试', icon: 'none' })
      return
    }
    this.setData({ openingContactId: id })
    try {
      await openCustomerServiceChat(contact)
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this.setData({ openingContactId: '' })
    }
  }
})
