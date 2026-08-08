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
      updatedAt: '2026年8月8日',
      paragraphs: [
        '你填写的表格内容主要保存在当前设备的微信中，方便你继续编辑、预览和导出。',
        '只有当你主动生成、预览、导出或分享表格时，我们才会处理完成该功能所需的信息。我们不会将你的表格内容用于其他用途或主动分享给他人。',
        '如需查询、更正或删除相关信息，请前往“我的”页面，点击“微信客服”联系作者。',
      ],
    },
  ],
};

const privacyPolicy = firstLaunchNotice.sections.find((section) => section.title === '隐私政策');

module.exports = {
  firstLaunchNotice,
  privacyPolicy,
};
