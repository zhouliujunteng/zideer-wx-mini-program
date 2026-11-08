const { hasSession } = require('../../services/identity')
const { openLogin } = require('../../utils/access-gate')
const { getNavigationMetrics } = require('../../utils/navigation')
const diagnostics = require('../../utils/support-diagnostics')
const { createSubmission, uploadFeedback } = require('../../services/support-feedback')
Page({
  data: { statusBarHeight:20, navigationBarHeight:44, contentTop:64, categoryLabels:['显示异常','播放异常','其他问题'], categories:['显示或横竖屏异常','课程播放异常','其他问题'], categoryIndex:0, description:'', includeDiagnostics:true, uploading:false, error:'', receipt:'', device:'', helpOpen:false },
  onLoad() {
    this.updateNavigation()
    diagnostics.record('page')
    const env=diagnostics.report().environment
    this.setData({device:[env.brand,env.model,env.system].filter(Boolean).join(' · ') || '上传时将附带当前窗口信息'})
  },
  updateNavigation() { this.setData(getNavigationMetrics()) },
  onResize() { this.updateNavigation() },
  handleBack() { wx.navigateBack({delta:1,fail:()=>wx.switchTab({url:'/pages/me/index'})}) },
  selectCategory(e) { this.categoryChanged({detail:{value:e.currentTarget.dataset.index}}) },
  categoryChanged(e) { if(this.data.uploading)return; this._submission=null; this.setData({categoryIndex:Number(e.detail.value),receipt:'',error:''}) },
  descriptionChanged(e) { if(this.data.uploading)return; this._submission=null; this.setData({description:e.detail.value,receipt:'',error:''}) },
  diagnosticsChanged(e) { if(this.data.uploading)return; this._submission=null; this.setData({includeDiagnostics:e.detail.value,receipt:'',error:''}) },
  toggleHelp() { this.setData({helpOpen:!this.data.helpOpen}) },
  async submit() {
    if(this.data.uploading || this.data.receipt)return
    if(!hasSession()) { openLogin(); return }
    if(!this.data.includeDiagnostics && !this.data.description.trim()) { this.setData({error:'请描述问题，或选择附带诊断日志。'}); return }
    this._submission=this._submission || createSubmission(['display','playback','other'][this.data.categoryIndex],this.data.description,this.data.includeDiagnostics)
    this.setData({uploading:true,error:''})
    try { const id=await uploadFeedback(this._submission); this.setData({receipt:id}); this._submission=null }
    catch(error) { this.setData({error:error.message || '上传未成功，请重试。'}); if(error.code==='LOGIN_REQUIRED') openLogin() }
    finally { this.setData({uploading:false}) }
  },
  copyReceipt() { if(this.data.receipt)wx.setClipboardData({data:this.data.receipt}) }
})
