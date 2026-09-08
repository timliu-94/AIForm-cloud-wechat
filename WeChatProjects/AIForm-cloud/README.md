# AIForm-cloud

这是 AIForm 的云开发版本。小程序业务代码位于 `miniprogram/`，云函数位于 `cloudfunctions/`。

表单预览图和 PDF 等模板资源通过云存储文件 ID 读取，公共路径在 `miniprogram/utils/cloudAssets.js` 中维护。

## 首页国家与版本配置

首页支持的国家以 `miniprogram/config/countryConfig.js` 为发布白名单，
申请表版本在用户选择国家后，从云存储的 `country_forms/<country>/` 目录按需读取；
云端查询失败时会回退到本地配置。新增或下线国家时需要修改该配置，并同步
`cloudfunctions/picture_acroforms_merge_function/pdf/templateAssets.js` 的服务端国家白名单。
测试会校验两边是否一致，以及模板 ID、PDF、Schema 和预览图路径是否完整。
每次发布配置时也应递增 `COUNTRY_CATALOG_VERSION`，便于核对线上目录版本。

```bash
cd cloudfunctions/picture_acroforms_merge_function
npm test
```

云函数中的目录查询接口是首页版本列表的运行时数据源。

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
