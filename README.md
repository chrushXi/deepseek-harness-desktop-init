# DeepSeek Harness Desktop

DeepSeekHarness的桌面版，兼容有或者没有Harness的用户，并且     **支持软件内更新Harness与安装其他插件**   ，来保证软件的实用性和适配性。

> 界面即官方 `dsh --profile web` 前端，功能与网页版完全一致；本应用只是把「Node 运行时 + dsh + 前端」打包成一个桌面程序，并加上原生窗口与增强插件。

---
## 下载与发布（GitHub Releases）

- [前往Release下载](https://github.com/chrushXi/deepseek-harness-desktop-init/releases)

## 特色功能

### 🚀 双击即用，免安装环境
- 无需 cmd、无需 `npx @deepseek-ai/dsh web`、无需手动安装 Node / npm。
- 捆绑 Node 24 运行时与 dsh 完整依赖树（约 300MB），打包后断网也可启动（登录/会话数据仍在 `~/.dsh`）。

### 🔄 直接更新 Harness（一键 / 按版本）
<img width="662" height="509" alt="屏幕截图 2026-08-21 152656" src="https://github.com/user-attachments/assets/0b08fb6c-1ad1-4fc1-9dfc-b137979192c7" />


### 💰 余额监控 + 峰谷计费

在这里要感谢余额插件制作者[@wssfk12138](https://github.com/wssfk12138)的余额插件，我在此加入了改动并融合进了本软件当中。 项目地址：[dsh-damage-pulse](https://github.com/wssfk12138/dsh-damage-pulse)

- 标题栏右侧常驻显示 **DeepSeek 账户余额**（可用余额 = 官方余额 − 本地待扣费），扣费时有金额变动动画。
- 缓存未命中产生暴击，命中缓存正常扣费
- 
  <img width="213" height="42" alt="屏幕截图 2026-08-21 152937" src="https://github.com/user-attachments/assets/074ffb18-b563-4e57-a378-61af28ea6046" />
  <img width="171" height="43" alt="屏幕截图 2026-08-21 153801" src="https://github.com/user-attachments/assets/ce02c95e-0895-4626-a085-69a523a602dd" />

- **右键余额** → 打开**余额详情面板**：可用余额 / 赠送余额 / 峰谷时段 / 打印小票。
- 
    <img width="283" height="207" alt="屏幕截图 2026-08-20 214003" src="https://github.com/user-attachments/assets/7de3b1bb-f8d1-4bd4-8c69-c279c15d5e43" />


### 🧾 会话小票
- 余额详情面板 → 「**打印小票**」（白色浮起按钮），生成当前会话的**超市小票风格清单**：按模型汇总调用次数、输入/输出/缓存 Token、金额、耗时、缓存命中率、峰谷费用。
  <img width="1414" height="878" alt="屏幕截图 2026-08-21 153333" src="https://github.com/user-attachments/assets/8035501e-724d-4de3-9dae-275531300955" />

- 可在「软件设置 → 通用 → **会话小票**」中关闭该入口（默认开启）。

### llama 启动器（本地模型服务）

在「软件设置 → **llama 启动器**」中管理本机 llama.cpp（`llama-server.exe`），无需命令行即可在软件内运行本地 GGUF 模型：

- **一键启停**：启动 / 停止 llama-server，状态徽标实时显示（已停止 / 启动中 / 运行中 / 错误），运行后提供 **OpenAI 兼容接口**（`http://127.0.0.1:8080/v1`）。
- **选择模型**：自动扫描 llama.cpp 目录及其 `models/` 文件夹中的 `.gguf` 文件（显示文件大小），可分别选择**主模型**与**视觉模型**（mmproj，可选）。
- **详细参数**：监听端口、上下文长度 `-c`、GPU 层数 `-ngl`、线程数 `-t`、并行会话 `-np`、API Key、附加参数（如 `--no-mmap`）。
- **跟随软件启动**：开启后软件启动时**先拉起 llama-server 再启动 Harness**，真实进度实时写入启动页进度条；退出软件时自动停止。
- 运行日志：`%APPDATA%\DeepSeek Harness\logs\llama.log`（大模型加载可能需要数分钟，请耐心等待）。

### 峰谷计费（日期 + 自定义时段）

余额插件设置支持 **峰谷日期**（周一至周日圆形开关，蓝色=当天执行峰谷计费；DeepSeek 周六日取消峰谷，默认周一至周五）与 **自定义峰谷时段**（可增删任意多段，时间组件按 5 分钟步进，结束 00:00 表示次日零点），标题栏「峰 / 谷」指示与扣费计价均同步生效。

### 🖥️ 命令行直接使用 dsh

- 安装完成（或版本切换）后，会自动生成 `dsh.cmd` 启动器并写入**用户 PATH**（`%APPDATA%\DeepSeek Harness\bin`）。
- 之后在 **cmd / PowerShell / 终端**里直接输入 `dsh` 即可使用官方 CLI（如 `dsh --version`、`dsh web`），无需手动装环境。
- 提示：PATH 变更通过系统环境广播生效，新开的终端立即可用；已打开的终端重启一下即可。
- 若不再需要，可在「系统环境变量 → Path」中删除 `%APPDATA%\DeepSeek Harness\bin`。

---

## 使用方法

1. **安装**：运行 `DeepSeekHarness-Setup-<版本>-x64.exe`，可自选安装目录。

   > 首次安装需要下载 Node 运行时并安装 dsh 完整依赖树，**耗时几分钟属正常现象**（见下文「关于安装慢」）。
2. **启动**：双击桌面/开始菜单的「DeepSeek Harness」。
3. **首次使用**：若本机缺少环境，安装向导会自动完成；安装完成后点击「**开始使用**」进入主界面。
4. **日常操作**：
   - 查看/打印余额：鼠标**右键**标题栏余额 → 余额详情 → 打印小票。
   - 更新 Harness：左上角「软件设置」→「Harness 版本」→ 选择版本「安装」。
   - 配置计费：软件设置 → 通用 → 余额插件设置 → 修改价格/峰谷时段 → 保存。
   - 运行本地模型：软件设置 → llama 启动器 → 选择模型（可加视觉模型）→ 启动服务（或开启「跟随软件启动」）。

---

## 关于安装慢（正常现象）

首次安装「慢」是**预期行为**，请耐心等待，不要中途关闭：

| 阶段 | 内容 | 耗时参考 |
| --- | --- | --- |
| 下载 Node.js | 约 30MB 运行时 | 视网络 10s–2min |
| 安装 DeepSeek Harness | npm 安装 dsh **完整依赖树（数百 MB，含 node-pty 等原生模块）** | 通常 1–5 分钟 |
| 打包装配 | electron-builder 组装约 300MB 应用 | 十数分钟 |

- 若长时间停留在「**正在解析安装包**」并显示小圆点动画，说明 npm 正在解析依赖（国内网络下常见），**不是卡死**。
- 安装完成后会停留在「开始使用」页，点击后才会启动服务。
- 更新版本时同理：会切换到安装视图执行下载/替换，可随时**取消**并自动恢复旧版本。

---

## 目录结构

```
DeepSeekHarness/
├─ main.js                Electron 主进程（启动服务器、窗口、更新、安装）
├─ preload.js             注入毛玻璃标题栏、软件设置弹窗、余额面板、小票与安装视图
├─ package.json           应用清单 + electron-builder 配置
├─ internal/damage-pulse  内置余额监控插件（余额/计费/小票 API，打包进 resources）
├─ runtime/               运行时（构建脚本生成，打包进 resources/runtime）
│  ├─ node.exe            捆绑 Node 24
│  ├─ node_modules/       完整依赖树（dsh 及其全部依赖）
│  └─ package.json        npm 更新入口
├─ assets/                图标 + 启动页 + 前端静态资源（harness-web）
├─ scripts/
│  ├─ prepare-runtime.ps1 构建 runtime（复制依赖 + 下载 Node）
│  └─ make-icon.mjs       生成图标
└─ dist/                  electron-builder 产物
```

## 构建（开发者）

```powershell
# 1. 安装内置余额监控插件的依赖（首次，克隆后必做）
cd internal\damage-pulse && npm install && cd ..\..

# 2. 准备运行时（首次；本地 npx 缓存不存在时会自动改用 npm install 构建依赖树）
powershell -ExecutionPolicy Bypass -File scripts\prepare-runtime.ps1

# 3. 安装 electron / electron-builder（已装过可跳过）
npm install

# 4. 开发运行（本地调试）
npm start

# 5. 打包（NSIS 安装版，输出到 dist/）
npm run dist
```

> - `internal/damage-pulse` 的 `node_modules` 不入库（见 .gitignore），克隆后需先执行第 1 步。
> - 国内网络建议先设置镜像环境变量：
>   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
>   `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

## 打包产物

- `dist/DeepSeekHarness-Setup-<version>-x64.exe` —— NSIS 安装版：可自选安装目录，自动创建桌面/开始菜单快捷方式，卸载干净。
- `dist/win-unpacked/` —— 免安装的完整目录（双击 `DeepSeek Harness.exe` 即可运行，用于快速分发/内测）。


## 数据与日志

- 用户数据（会话、设置、凭据）仍在 `~/.dsh`（即 `C:\Users\<你>\\.dsh`），与官方 CLI 完全共享。
- 桌面设置（余额插件 / 会话小票 / 更新频道等）：`%APPDATA%\DeepSeek Harness\settings.json`。
- 运行日志：`%APPDATA%\DeepSeek Harness\logs\server.log`。

## 更新说明

- **更新源**：npm 官方源（默认 `registry.npmmirror.com`，失败自动回退 `registry.npmjs.org`）；可用环境变量 `DSH_UPDATE_REGISTRY=https://你的内网镜像` 自定义。
- **监控频道**：静默监控 Next 频道（取全部 dist-tags 与版本中 semver 最高者），每个新版本只通过设置弹窗提示一次。
- **更新流程**：停服 → `npm install @deepseek-ai/dsh@指定版本` → 重启服务 → 自动返回主界面；失败自动恢复旧版本。

## 异常自愈

若 `~/.dsh/profiles/node_modules` 中的条目被外部工具（如手动复制、其他安装）改成了普通文件夹，
DSH 会拒绝启动并提示 "exists and is not a symlink"。本应用检测到该错误时会弹窗提供**一键自动修复**
（仅删除 `$DSH_HOME/profiles/node_modules` 内的异常条目，该目录由 DSH 自动维护，可安全重建），修复后自动重启服务器。
<img width="1437" height="900" alt="屏幕截图 2026-08-20 211007" src="https://github.com/user-attachments/assets/6c35adaf-34e9-473c-afa5-dcc6482b1710" />
<img width="1442" height="901" alt="屏幕截图 2026-08-20 213912" src="https://github.com/user-attachments/assets/b4a7b3a5-f1b5-45bc-8213-ba0272a2033a" />
<img width="1438" height="898" alt="屏幕截图 2026-08-20 213919" src="https://github.com/user-attachments/assets/9d36bc7a-7775-45b9-8367-2ebc7bc31e90" />

