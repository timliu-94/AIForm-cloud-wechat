# AIForm-cloud

这是 AIForm 的云开发版本。小程序业务代码位于 `miniprogram/`，云函数位于 `cloudfunctions/`。

表单预览图和 PDF 等模板资源通过云存储文件 ID 读取，公共路径在 `miniprogram/utils/cloudAssets.js` 中维护。

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
