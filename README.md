# LDtools

关卡设计工具集。首个工具 **shot** 是一个可交互的关卡历程分析网页原型。

## 启动 shot

需要 Node.js 20 或更新版本。应用没有运行时依赖，不需要数据库、账号或 API 密钥。

```bash
git clone https://github.com/alexyankq/LDtools.git
cd LDtools
npm start
```

在运行机器的浏览器打开 `http://127.0.0.1:3000`。默认只监听本机；需要在支持端口转发的开发环境访问时，可以用 `HOST=0.0.0.0 PORT=3000 npm start`。

## 使用

1. 选择 Portal 2 的标准、重复或错序示例，选择玩家画像和分析时元。
2. 点击时间轴、事件表或诊断中的「定位事件」，在右侧编辑事件，保存后重新计算。
3. 点击「设为对比基线」，再调整事件、玩家或规则，比较曲线和平均参与意愿的预测差异。
4. 从「模型配置」导出规则或画像 JSON，编辑参数后导入。导入项目可以恢复整套配置。
5. 项目自动保存在此浏览器的 localStorage；请导出 JSON 以便跨设备使用和备份。基线仅保留在当前页面，刷新后需重新设置。切换示例时，自定义流程会自动导出备份。

示例事件是假想设计输入。模型结果和诊断均为实验性预测，参数尚未通过真实玩家数据校准，不能视为实测体验或设计缺陷的证明。

## 验证

```bash
npm test
```

模型测试覆盖时元一致性、教学顺序、重复疲劳、瞬时与小数时间、重叠事件、延迟影响、休整、玩家差异和输入校验。

浏览器测试会自行启动临时服务器，验证交互、导入导出、本地保存和移动端布局：

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

如已安装系统 Chromium，可跳过浏览器下载，用 `SHOT_BROWSER_PATH=/usr/bin/chromium npm run test:browser`。受限环境中可以通过 `npm --cache /workspace/.cache/npm ci` 将 npm 缓存放在可写目录。

完整需求见 [shot 需求](docs/shot-requirements.md)，配置与计算约定见 [模型说明](docs/shot-model.md)。
