const { avatarPresets } = require('../../services/identity')

// 换头像弹层（2026-11-14 用户要求，移植学生网页端的默认头像）：上面是知鹿默认头像（与网页端 / 平板同一套图，
// 课程服务 public/portal-avatars/<id>.png），下面保留微信自带的「用微信头像 / 相册 / 拍照」（open-type="chooseAvatar"）。
// 组件只负责选：选了默认头像发 preset { id }，选了微信头像发 wechat { avatarUrl }，关掉发 close；下载、上传、保存由页面做。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // 页面正在保存时为 true：不让再选
    busy: { type: Boolean, value: false }
  },
  data: { presets: [], picked: '' },
  observers: {
    visible(value) {
      if (!value) return
      let presets = []
      try { presets = avatarPresets() } catch (error) { presets = [] }
      this.setData({ presets, picked: '' })
    }
  },
  methods: {
    pickPreset(event) {
      if (this.data.busy) return
      const id = event.currentTarget.dataset.id
      if (!id) return
      this.setData({ picked: id })
      this.triggerEvent('preset', { id })
    },
    chooseWechat(event) {
      if (this.data.busy) return
      const avatarUrl = event.detail && event.detail.avatarUrl
      if (avatarUrl) this.triggerEvent('wechat', { avatarUrl })
    },
    close() {
      if (this.data.busy) return
      this.triggerEvent('close')
    },
    stopTap() {}
  }
})
