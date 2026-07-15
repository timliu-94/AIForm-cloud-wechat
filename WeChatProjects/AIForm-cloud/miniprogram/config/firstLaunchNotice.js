const firstLaunchNotice = {
  storageKey: 'first_launch_notice_accepted_v1',
  iconText: '!',
  title: '使用前请知晓',
  confirmText: '已阅读并知晓',
  sections: [
    {
      title: '关于本小程序',
      paragraphs: [
        '本小程序非政府、使领馆或签证中心官方平台，不提供预约、递交、审批或结果查询服务。',
        '表格来源及申请要求请以各国领事馆官方网站或官方机构发布信息为准。',
        '你应自行核对填写内容、申请材料、递交方式和最新政策，本小程序仅提供表格填写辅助。',
      ],
    },
    {
      title: '隐私政策',
      updatedAt: '2026年7月4日',
      paragraphs: [
        '本小程序用于辅助填写和管理签证申请表。我们会在本地保存你主动填写的表格内容、反馈内容以及表格记录数量，用于继续编辑、预览和导出表格。',
        '表格数据和反馈记录主要保存在你的微信本地存储中。除你主动提交、导出或使用相关功能外，我们不会主动向第三方共享这些内容。',
        '当你生成或预览 PDF 等文件时，小程序可能会调用云函数处理必要的表格数据，仅用于完成当前文件生成任务。',
        '如需查询、更正或删除相关信息，可通过 QQ 84173943 或邮箱 84173942@qq.com 联系我们。',
      ],
    },
  ],
};

const privacyPolicy = firstLaunchNotice.sections.find((section) => section.title === '隐私政策');

module.exports = {
  firstLaunchNotice,
  privacyPolicy,
};
