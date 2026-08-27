"use strict";

/**
 * DeepSeek Harness Desktop —— preload。
 *
 * 在页面中注入自绘的毛玻璃半透明窗体标头（拖拽区 + 最小化/最大化/关闭 + 左上角设置按钮），
 * 并通过 contextBridge 暴露窗口控制、设置与版本管理能力。DSH 页面本身（功能与界面）不做任何改动，
 * 仅在其顶部为窗体标头预留 44px 高度。
 *
 * 软件设置弹窗（设置按钮打开）：
 *   - Harness版本：Latest / Next 频道滑块 + 全部版本列表（按版本号安装），静默监控 Next，
 *     每个新版本只通过该弹窗提示一次（设置按钮红点）；
 *   - 通用：余额插件开关 / 余额插件设置（峰谷计费，表单始终可见）/ 会话小票开关。
 *
 * 标题栏余额组件支持右键菜单：余额详情 / 收缩宽度 / 打印小票。
 */

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const TITLEBAR_HEIGHT = 44;

/** 内置暴击 PNG：读取本地资源并转成 data URL（懒加载，避免同步读 1.2MB 文件阻塞启动页首帧渲染）。 */
let criticalIconData = null;
function criticalIconDataURL() {
  if (criticalIconData === null) {
    try {
      criticalIconData = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "assets", "Boom.png")).toString("base64")}`;
    } catch {
      criticalIconData = "";
    }
  }
  return criticalIconData;
}

/** 设置按钮图标：读取 assets/setting.svg（灰齿轮），将填充色改为 currentColor 以跟随主题。 */
const SETTING_ICON_SVG = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "assets", "setting.svg"), "utf8");
    return raw
      .replace(/<\?xml[^>]*\?>\s*/i, "")
      .replace(/<!DOCTYPE[^>]*>\s*/i, "")
      .replace(/fill="#707070"/g, 'fill="currentColor"')
      .replace(/width="200"/, 'width="18"')
      .replace(/height="200"/, 'height="18"');
  } catch {
    return "";
  }
})();

/** DeepSeek 官方品牌标识路径（viewBox 0 0 24 24）。 */
const OFFICIAL_MARK_PATH = "M23.0584 4.95203C22.8129 4.83203 22.7074 5.06103 22.5639 5.17704C22.5149 5.21454 22.4734 5.26354 22.4319 5.30854C22.0734 5.69155 21.6543 5.94306 21.1073 5.91306C20.3073 5.86806 19.6243 6.11957 19.0203 6.73158C18.8918 5.97706 18.4652 5.52655 17.8162 5.23754C17.4767 5.08753 17.1332 4.93703 16.8952 4.61052C16.7292 4.37801 16.6837 4.11901 16.6007 3.8635C16.5477 3.70949 16.4952 3.55199 16.3177 3.52549C16.1252 3.49549 16.0497 3.65699 15.9742 3.792C15.6722 4.34401 15.5552 4.95203 15.5667 5.56805C15.5932 6.95359 16.1782 8.05712 17.3407 8.84215C17.4727 8.93215 17.5067 9.02215 17.4652 9.15366C17.3857 9.42416 17.2917 9.68667 17.2087 9.95718C17.1557 10.1297 17.0767 10.1677 16.8917 10.0922C16.2537 9.82568 15.7027 9.43117 15.2156 8.95465C14.3891 8.15513 13.6416 7.2726 12.7096 6.58158C12.4906 6.42007 12.2716 6.27007 12.045 6.12707C11.094 5.20354 12.1696 4.44502 12.4186 4.35501C12.6791 4.26101 12.5091 3.938 11.6675 3.942C10.826 3.9455 10.056 4.22751 9.07446 4.60302C8.93096 4.65952 8.77995 4.70052 8.62545 4.73452C7.73492 4.56552 6.80989 4.52802 5.84386 4.63702C4.02481 4.83953 2.57177 5.69955 1.50373 7.1676C0.220694 8.93215 -0.0813148 10.9372 0.288196 13.0283C0.676708 15.2323 1.80174 17.0569 3.53029 18.4834C5.32285 19.9625 7.38741 20.6875 9.74298 20.5485C11.1735 20.466 12.7661 20.2745 14.5626 18.7539C15.0156 18.9795 15.4912 19.0695 16.2797 19.137C16.8872 19.1935 17.4722 19.107 17.9252 19.013C18.6347 18.8629 18.5857 18.2059 18.3292 18.0854C16.2497 17.1169 16.7062 17.5109 16.2912 17.1919C17.3477 15.9419 18.9618 13.7198 19.4598 10.6942C19.5088 10.3602 19.5713 9.88968 19.5638 9.61917C19.5598 9.45417 19.5978 9.39016 19.7863 9.37116C20.3073 9.31116 20.8128 9.16866 21.2773 8.91315C22.6249 8.17713 23.1684 6.96809 23.2964 5.51905C23.3154 5.29754 23.2924 5.06853 23.0584 4.95203ZM11.3165 17.9954C9.30097 16.4109 8.32344 15.8894 7.91992 15.9119C7.54241 15.9344 7.61042 16.3664 7.69342 16.6479C7.78042 16.9259 7.89342 17.1174 8.05193 17.3614C8.16143 17.5229 8.23694 17.7629 7.94243 17.9434C7.29341 18.3449 6.16487 17.8084 6.11187 17.7819C4.79833 17.0084 3.7003 15.9874 2.92628 14.5908C2.17875 13.2468 1.74474 11.8047 1.67324 10.2657C1.65424 9.89418 1.76374 9.76267 2.13375 9.69517C2.62077 9.60517 3.12278 9.58617 3.6093 9.65767C5.66636 9.95818 7.41741 10.8777 8.88545 12.3348C9.72348 13.1643 10.3575 14.1558 11.0105 15.1243C11.705 16.1529 12.4521 17.1329 13.4036 17.9364C13.7396 18.2179 14.0076 18.4319 14.2641 18.5899C13.4906 18.6764 12.1996 18.6949 11.3165 17.9964V17.9954ZM12.2826 11.7817C12.2826 11.6167 12.4146 11.4852 12.5806 11.4852C12.6181 11.4852 12.6521 11.4927 12.6826 11.5037C12.7241 11.5187 12.7621 11.5412 12.7921 11.5752C12.8451 11.6277 12.8751 11.7027 12.8751 11.7817C12.8751 11.9467 12.7431 12.0782 12.5771 12.0782C12.4111 12.0782 12.2826 11.9467 12.2826 11.7817ZM15.2831 13.3208C15.0906 13.3998 14.8981 13.4673 14.7131 13.4748C14.4261 13.4898 14.1131 13.3733 13.9431 13.2308C13.6791 13.0093 13.4901 12.8853 13.4111 12.4988C13.3771 12.3338 13.3961 12.0782 13.4261 11.9317C13.4941 11.6162 13.4186 11.4137 13.1961 11.2297C13.0151 11.0797 12.7846 11.0382 12.5316 11.0382C12.4371 11.0382 12.3506 10.9967 12.2861 10.9632C12.1806 10.9107 12.0936 10.7792 12.1766 10.6177C12.2031 10.5652 12.3316 10.4377 12.3616 10.4152C12.7051 10.2197 13.1011 10.2837 13.4676 10.4302C13.8071 10.5692 14.0641 10.8242 14.4336 11.1847C14.8111 11.6202 14.8791 11.7402 15.0941 12.0672C15.2641 12.3228 15.4186 12.5853 15.5247 12.8858C15.5887 13.0733 15.5057 13.2268 15.2831 13.3208Z";

const TITLEBAR_CSS = `
#dsh-titlebar {
  --tb-height: ${TITLEBAR_HEIGHT}px;
  position: fixed;
  top: 0; left: 0; right: 0;
  height: var(--tb-height);
  z-index: 2147483646;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding-left: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(128,128,128,.25)) 60%, transparent);
  /* 毛玻璃半透明：半透明底色 + 背景模糊 */
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #171a21) 62%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(170%);
  backdrop-filter: blur(22px) saturate(170%);
  -webkit-app-region: drag;
  user-select: none;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
#dsh-titlebar .dsh-tb-spacer { flex: 1; }
#dsh-titlebar .dsh-tb-balance {
  position: relative; display: inline-flex; align-items: center; gap: 7px;
  flex: none; height: 34px; margin-right: 12px; padding: 0;
  overflow: visible; white-space: nowrap; pointer-events: auto; -webkit-app-region: no-drag;
  color: var(--dsw-alias-label-secondary, #aeb3bd);
  font-size: 12px; line-height: 1; font-variant-numeric: tabular-nums;
}
#dsh-titlebar .dsh-tb-balance-label,
#dsh-titlebar .dsh-tb-balance-amount {
  color: var(--dsw-alias-label-secondary, #aeb3bd); font-size: 12px; font-weight: 500;
  letter-spacing: 0; font-variant-numeric: tabular-nums;
}
#dsh-titlebar .dsh-tb-balance-delta {
  display: inline-flex; align-items: center; gap: 2px; min-width: 34px;
  color: var(--dsw-alias-label-secondary, #aeb3bd); font-size: 12px; font-weight: 500;
  font-variant-numeric: tabular-nums; transition: color .18s ease, opacity .18s ease;
}
#dsh-titlebar .dsh-tb-balance-delta.dsh-tb-delta-red { color: #e45555; }
#dsh-titlebar .dsh-tb-balance-delta.dsh-tb-delta-green { color: #3ba96b; }
#dsh-titlebar .dsh-tb-balance-season { display: inline-flex; align-items: center; font-size: 12px; font-weight: 600; }
#dsh-titlebar .dsh-tb-balance-season.dsh-tb-season-peak { color: #e45555; }
#dsh-titlebar .dsh-tb-balance-season.dsh-tb-season-valley { color: #3ba96b; }
#dsh-titlebar .dsh-tb-panel-season.dsh-tb-season-peak { color: #e45555; }
#dsh-titlebar .dsh-tb-panel-season.dsh-tb-season-valley { color: #3ba96b; }
#dsh-titlebar .dsh-tb-balance-panel {
  position: absolute; top: 39px; right: 0; z-index: 2147483647;
  display: none; width: 236px; max-width: calc(100vw - 20px); padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  border-radius: 12px; background: var(--dsw-alias-bg-module-platform, #171b24);
  box-shadow: 0 12px 32px rgba(0,0,0,.22); color: var(--dsw-alias-label-primary, #e8eaf0);
  font-size: 12px; line-height: 1.6; pointer-events: auto;
}
#dsh-titlebar .dsh-tb-balance-panel.dsh-tb-panel-open { display: block; }
#dsh-titlebar .dsh-tb-panel-title { margin: 0 0 6px 10px; font-size: 12px; font-weight: 600; }
#dsh-titlebar .dsh-tb-panel-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-left: 10px; }
#dsh-titlebar .dsh-tb-panel-row + .dsh-tb-panel-row { margin-top: 4px; }
#dsh-titlebar .dsh-tb-panel-muted { color: var(--dsw-alias-label-tertiary, #8a8f98); }
#dsh-titlebar .dsh-tb-panel-action {
  -webkit-app-region: no-drag;
  appearance: none; border: none; cursor: pointer;
  width: 100%; margin-top: 6px; padding: 8px 10px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  border-radius: 9px; background: transparent; color: inherit;
  font: inherit; text-align: left;
  transition: background .12s ease, color .12s ease;
}
#dsh-titlebar .dsh-tb-panel-action:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));
}
/* 相邻操作行（打印小票 → 计费设置）纵向间隔与上方信息行一致（4px） */
#dsh-titlebar .dsh-tb-panel-action + .dsh-tb-panel-action {
  margin-top: 4px;
}
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-panel-action-on {
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
#dsh-titlebar .dsh-tb-panel-action-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
/* 打印小票：白色浮起按钮（白底 + 细边框 + 下方柔和阴影，像悬浮在面板之上；hover 上浮更高） */
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-receipt-btn {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(125, 136, 162, .35);
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, .20);
  color: #1f2430;
  transition: transform .14s ease, box-shadow .16s ease, border-color .14s ease, background .16s ease;
}
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-receipt-btn .dsh-tb-receipt-ico {
  flex: none; display: block;
  color: #1f2430;
  transition: transform .14s ease;
}
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-receipt-btn:hover {
  transform: translateY(-2px);
  border-color: rgba(125, 136, 162, .55);
  background: #f7f9fc;
  box-shadow: 0 6px 16px rgba(15, 23, 42, .26);
}
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-receipt-btn:hover .dsh-tb-receipt-ico { transform: scale(1.08); }
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-receipt-btn:active {
  transform: translateY(0) scale(.99);
  box-shadow: 0 1px 3px rgba(15, 23, 42, .18);
}
.dsh-tb-action-caret {
  display: block; flex: none;
  transition: transform .15s ease;
}
#dsh-titlebar .dsh-tb-panel-action.dsh-tb-panel-action-on .dsh-tb-action-caret {
  transform: rotate(90deg);
}
#dsh-titlebar .dsh-tb-panel-pricing {
  display: none;
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  /* 内嵌面板用主题底色（跟随明暗主题） */
  background: var(--dsw-alias-bg-base, #171b24);
}
#dsh-titlebar .dsh-tb-panel-pricing.dsh-tb-pricing-open { display: block; }
.dsh-tb-price-head {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px;
}
.dsh-tb-price-select,
.dsh-tb-price-input {
  -webkit-app-region: no-drag;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, #171b24);
  color: var(--dsw-alias-label-primary, #e8eaf0);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
/* 模型下拉框：圆角 + 去掉原生外观 + 自绘箭头 */
.dsh-tb-price-select {
  appearance: none;
  -webkit-appearance: none;
  min-width: 118px; height: 28px; padding: 0 26px 0 8px;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5 L5 6.5 L8 3.5' fill='none' stroke='%23888f98' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}
.dsh-tb-price-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 1.35fr 1fr 1fr;
  gap: 6px;
  align-items: center;
}
.dsh-tb-price-grid span {
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  white-space: nowrap;
}
.dsh-tb-price-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  outline: none;
}
.dsh-tb-price-input:focus {
  border-color: #4d6bfe;
  box-shadow: 0 0 0 3px rgba(77,107,254,.16);
}
.dsh-tb-price-actions {
  margin-top: 10px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.dsh-tb-price-status {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
}
.dsh-tb-price-buttons { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.dsh-tb-price-btn {
  -webkit-app-region: no-drag;
  appearance: none; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  cursor: pointer; height: 28px; padding: 0 12px; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary, #aeb3bd);
  font: inherit;
}
.dsh-tb-price-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
.dsh-tb-price-btn.dsh-tb-price-btn-primary {
  border-color: #4d6bfe;
  background: #4d6bfe;
  color: #fff;
}
.dsh-tb-price-btn.dsh-tb-price-btn-primary:hover {
  background: #5b77ff;
  color: #fff;
}
/* 扣费分类标注：缓存命中用琥珀色区分普通扣费红 / 充值绿 */
#dsh-titlebar .dsh-tb-balance-delta.dsh-tb-delta-hit { color: #e8a33d; }
/* 计费设置状态：保存成功绿色加粗、失败红色加粗，突出反馈 */
.dsh-tb-price-status.dsh-tb-price-status-ok {
  color: #3ba96b;
  font-weight: 600;
}
.dsh-tb-price-status.dsh-tb-price-status-err {
  color: #e45555;
  font-weight: 600;
}
/* 金额变动反馈：仅未命中暴击保留跳动；其余走数字转轮（滚筒）效果 */
#dsh-titlebar .dsh-tb-balance-amount.dsh-tb-balance-miss {
  animation: dsh-tb-balance-miss 1.62s cubic-bezier(.2,.86,.25,1);
}
#dsh-titlebar .dsh-tb-critical-icon { width: 12px; height: 12px; flex: none; display: block; object-fit: contain; }
/* 数字转轮：整段数字向上滚动（旧值上翻、新值入场）；￥ 与数字分离，不参与动画、位置固定 */
#dsh-titlebar .dsh-tb-amt-cur { font-variant-numeric: tabular-nums; }
#dsh-titlebar .dsh-tb-amt-num {
  display: inline-block; overflow: hidden; height: 1em; vertical-align: bottom;
}
#dsh-titlebar .dsh-tb-amt-reel {
  display: flex; flex-direction: column;
  animation: dsh-tb-amt-roll 280ms cubic-bezier(.2,.7,.3,1) forwards;
  will-change: transform;
}
#dsh-titlebar .dsh-tb-amt-reel-cell {
  display: block; height: 1em; line-height: 1; white-space: nowrap;
}
@keyframes dsh-tb-amt-roll {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
@keyframes dsh-tb-balance-miss {
  0% { transform: translate(0, 0) scale(1); }
  18% { transform: translate(-2px, 2px) scale(.95); }
  34% { transform: translate(2px, 0) scale(1.05); }
  52% { transform: translate(-1px, 0) scale(1.02); }
  100% { transform: translate(0, 0) scale(1); }
}
#dsh-titlebar .dsh-tb-btn {
  -webkit-app-region: no-drag;
  appearance: none; border: none; cursor: pointer;
  height: 100%; min-width: 46px; padding: 0 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #aeb3bd);
  font-size: 12px;
  transition: background .12s ease, color .12s ease;
}
#dsh-titlebar .dsh-tb-btn svg { display: block; }
#dsh-titlebar .dsh-tb-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); color: var(--dsw-alias-label-primary, #e8eaf0); }
#dsh-titlebar .dsh-tb-btn:active { background: rgba(255,255,255,.05); }
#dsh-titlebar .dsh-tb-btn.dsh-tb-close:hover { background: #e81123; color: #fff; }
/* 设置按钮：左上角距边框 20px，图标 + 「设置」文字，hover 呈现按下去的矩形样式 */
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings {
  min-width: 36px; height: 30px; padding: 0 10px; gap: 5px;
  margin: 0 0 0 20px;
  border-radius: 8px;
  position: relative;
  font-size: 12px; font-weight: 500;
  transition: background .12s ease, box-shadow .12s ease, transform .06s ease;
}
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings .dsh-tb-settings-icon {
  display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-secondary, #aeb3bd);
  transition: color .12s ease;
}
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings .dsh-tb-settings-icon svg { display: block; }
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings .dsh-tb-settings-label {
  letter-spacing: .04em;
  color: var(--dsw-alias-label-secondary, #aeb3bd);
  transition: color .12s ease;
}
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));
  box-shadow: inset 0 -1px 0 rgba(0,0,0,.22), 0 1px 2px rgba(0,0,0,.20);
  transform: translateY(1px);
}
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings:hover .dsh-tb-settings-icon,
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings:hover .dsh-tb-settings-label { color: var(--dsw-alias-label-primary, #e8eaf0); }
#dsh-titlebar .dsh-tb-btn.dsh-tb-settings:active {
  transform: translateY(2px) scale(.97);
  box-shadow: inset 0 2px 4px rgba(0,0,0,.28);
}
/* 新版本提示小红点（只提示一次） */
#dsh-titlebar .dsh-tb-settings-dot {
  position: absolute; top: 4px; right: 4px;
  width: 7px; height: 7px; border-radius: 50%;
  background: #f04438;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-bg-base, #171a21) 85%, transparent);
}
#dsh-titlebar .dsh-tb-settings-dot[hidden] { display: none; }
html, body { height: 100%; }
#root { box-sizing: border-box; height: 100%; padding-top: ${TITLEBAR_HEIGHT}px !important; }
/* 余额由桌面标题栏承载，隐藏内置插件的右下角承载层，避免重复显示。 */
body [data-token-monitor-balance] { display: none !important; }
`;

function injectTitlebar() {
  if (document.getElementById("dsh-titlebar")) return;

  const style = document.createElement("style");
  style.id = "dsh-titlebar-style";
  style.textContent = TITLEBAR_CSS;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.id = "dsh-titlebar";
  bar.innerHTML = `
    <button class="dsh-tb-btn dsh-tb-settings" id="dsh-tb-settings" title="软件设置" type="button">
      <span class="dsh-tb-settings-icon">${SETTING_ICON_SVG}</span>
      <span class="dsh-tb-settings-label">软件设置</span>
      <span class="dsh-tb-settings-dot" id="dsh-tb-settings-dot" hidden></span>
    </button>
    <div class="dsh-tb-spacer"></div>
    <div class="dsh-tb-balance" id="dsh-tb-balance" title="DeepSeek 账户余额">
      <span class="dsh-tb-balance-label">当前余额</span>
      <span class="dsh-tb-balance-amount" id="dsh-tb-balance-amount"><span class="dsh-tb-amt-cur">￥&#160;</span><span class="dsh-tb-amt-num" id="dsh-tb-amt-num">--</span></span>
      <span class="dsh-tb-balance-season dsh-tb-season-valley" id="dsh-tb-balance-season">谷</span>
      <div class="dsh-tb-balance-panel" id="dsh-tb-balance-panel" role="dialog" aria-label="余额详情">
        <div class="dsh-tb-panel-title">DeepSeek 余额</div>
        <div class="dsh-tb-panel-row"><span class="dsh-tb-panel-muted">可用余额</span><strong id="dsh-tb-panel-total">--</strong></div>
        <div class="dsh-tb-panel-row"><span class="dsh-tb-panel-muted">赠送余额</span><span id="dsh-tb-panel-granted">--</span></div>
        <div class="dsh-tb-panel-row"><span class="dsh-tb-panel-muted">峰谷时段</span><span class="dsh-tb-panel-season dsh-tb-season-valley" id="dsh-tb-panel-season">谷</span></div>
        <button class="dsh-tb-panel-action dsh-tb-receipt-btn" id="dsh-tb-receipt-btn" type="button">
          <span class="dsh-tb-panel-action-title">
            <svg class="dsh-tb-receipt-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>
            <span>打印小票</span>
          </span>
        </button>
      </div>
      <span class="dsh-tb-balance-delta" id="dsh-tb-balance-delta">±&#160;0.00</span>
    </div>
    <button class="dsh-tb-btn" id="dsh-tb-min" title="最小化" type="button">
      <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.2"/></svg>
    </button>
    <button class="dsh-tb-btn" id="dsh-tb-max" title="最大化" type="button">
      <svg class="dsh-tb-max-ico" width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
    </button>
    <button class="dsh-tb-btn dsh-tb-close" id="dsh-tb-close" title="关闭" type="button">
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" stroke-width="1.2"/></svg>
    </button>
  `;
  document.body.appendChild(bar);

  const $ = (id) => bar.querySelector("#" + id);

  $("dsh-tb-min").addEventListener("click", () => api.minimize());
  $("dsh-tb-close").addEventListener("click", () => api.close());
  const maxBtn = $("dsh-tb-max");
  maxBtn.addEventListener("click", () => api.toggleMaximize());
  api.onMaximizedChange((maximized) => {
    maxBtn.title = maximized ? "还原" : "最大化";
    maxBtn.querySelector("svg").innerHTML = maximized
      ? '<rect x="3" y="3" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 3 V2 a1 1 0 0 1 1 -1 h4 a1 1 0 0 1 1 1 v4 a1 1 0 0 1 -1 1 h-1" fill="none" stroke="currentColor" stroke-width="1.2"/>'
      : '<rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>';
  });

  // 设置按钮：打开软件设置弹窗；有新版本时显示小红点（每个版本只提示一次）
  const settingsBtn = $("dsh-tb-settings");
  const settingsDot = $("dsh-tb-settings-dot");
  settingsBtn.addEventListener("click", () => openSettingsDialog());
  updateSettingsDot();

  // 内置 damage-pulse 标题栏读数。标题栏是唯一可见承载，右键余额打开详情面板。
  const balance = $("dsh-tb-balance");
  const amount = $("dsh-tb-balance-amount");
  const numSpan = $("dsh-tb-amt-num");
  const delta = $("dsh-tb-balance-delta");
  const season = $("dsh-tb-balance-season");
  const balancePanel = $("dsh-tb-balance-panel");
  const panelTotal = $("dsh-tb-panel-total");
  const panelGranted = $("dsh-tb-panel-granted");
  const panelSeason = $("dsh-tb-panel-season");
  const receiptBtn = $("dsh-tb-receipt-btn");
  let balanceValue = null;
  let remoteBalanceValue = null;
  let chargeSeq = 0;
  let chargeSeeded = false;
  let chargeTimer = null;
  let balanceTimer = null;
  let deltaTimer = null;
  let chargePollInFlight = false;

  const fmtMoney = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? `￥\u00a0${n.toFixed(2)}` : "￥\u00a0--";
  };
  const fmtDelta = (value, sign) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    // 缓存命中金额极小，保留 4 位小数，避免显示成 -0.00 而“看不见”
    const text = Math.abs(n) < 0.01 ? n.toFixed(4) : n.toFixed(2);
    return `${sign}${text}`;
  };
  /** 峰谷判断跟随计费设置里保存的时段与日期（未加载/未保存时用默认：周一至周五）。 */
  const isPeakNow = () => {
    const zhParts = (field) => {
      try {
        return new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit", hour12: false,
          ...(field === "weekday" ? { weekday: "short" } : {}),
        }).formatToParts(new Date()).find((part) => part.type === field)?.value;
      } catch {
        return undefined;
      }
    };
    const hour = Number(zhParts("hour"));
    const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const day = dayMap[zhParts("weekday")];
    const weekdays = Array.isArray(priceTable && priceTable.weekdays)
      ? priceTable.weekdays
      : DEFAULT_PRICE_TABLE.weekdays;
    if (!Number.isFinite(hour)) return false;
    // 日期未激活（或全部关闭）则全天按谷价，不执行峰谷计费
    if (weekdays.length === 0 || !weekdays.includes(day)) return false;
    const peaks = Array.isArray(priceTable && priceTable.peakHours)
      ? priceTable.peakHours
      : DEFAULT_PRICE_TABLE.peakHours;
    return peaks.some(([start, end]) => hour >= Number(start) && hour < Number(end));
  };
  const updateSeason = () => {
    const peak = isPeakNow();
    season.textContent = peak ? "峰" : "谷";
    season.classList.toggle("dsh-tb-season-peak", peak);
    season.classList.toggle("dsh-tb-season-valley", !peak);
    panelSeason.textContent = peak ? "峰" : "谷";
    panelSeason.classList.toggle("dsh-tb-season-peak", peak);
    panelSeason.classList.toggle("dsh-tb-season-valley", !peak);
  };
  // 供设置弹窗内保存价格表后刷新标题栏峰谷指示
  window.dshRefreshSeason = updateSeason;
  const criticalIcon = () => `
    <img class="dsh-tb-critical-icon" src="${criticalIconDataURL()}" alt="" aria-hidden="true">`;
  /** 扣费提示停留时长（原 1800ms，现定为 3300ms）。 */
  const DELTA_HOLD_MS = 3300;
  /** 连续扣费提示的错峰间隔：同一批事件各自获得展示机会，避免被覆盖。 */
  const DELTA_QUEUE_GAP_MS = 220;
  /** 展示队列上限：超出丢弃最旧（余额扣减已发生，仅提示展示被跳过）。 */
  const DELTA_QUEUE_MAX = 20;
  const deltaQueue = [];
  let deltaQueueTimer = null;
  /** 用 breakdown 识别本次扣费类型：miss（未命中暴击）/ hit（缓存命中）/ output / normal。 */
  const chargeKindOf = (event) => {
    const breakdown = event && event.breakdown ? event.breakdown : null;
    let kind = event && event.damageKind === "miss" ? "miss" : "normal";
    if (breakdown) {
      const hit = Number(breakdown.cacheHit && breakdown.cacheHit.cost) || 0;
      const miss = Number(breakdown.cacheMiss && breakdown.cacheMiss.cost) || 0;
      const output = Number(breakdown.output && breakdown.output.cost) || 0;
      if (hit > 0 || miss > 0 || output > 0) {
        if (miss >= hit && miss >= output) kind = "miss";
        else if (hit >= output) kind = "hit";
        else kind = "output";
      }
    }
    return kind;
  };
  const showDelta = (event, sign = "-") => {
    const kind = chargeKindOf(event);
    // 金额反馈：仅未命中暴击加跳动动画；其余由 renderBalance 走数字转轮
    amount.classList.remove("dsh-tb-balance-miss");
    if (kind === "miss" && sign === "-") {
      void amount.offsetWidth;
      amount.classList.add("dsh-tb-balance-miss");
    }
    const colorClass = sign === "+" ? "dsh-tb-delta-green" : kind === "hit" ? "dsh-tb-delta-hit" : "dsh-tb-delta-red";
    delta.className = `dsh-tb-balance-delta ${colorClass}`;
    const parts = [];
    if (kind === "miss" && sign === "-") parts.push(criticalIcon());
    parts.push(`<span>${fmtDelta(Number(event && event.cost), sign)}</span>`);
    delta.innerHTML = parts.join("");
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => {
      delta.textContent = "±\u00a00.00";
      delta.className = "dsh-tb-balance-delta";
    }, DELTA_HOLD_MS);
  };
  /** 将一次扣费提示加入展示队列，逐条错峰播放。 */
  const enqueueDelta = (event, sign = "-") => {
    if (deltaQueue.length >= DELTA_QUEUE_MAX) deltaQueue.shift();
    deltaQueue.push({ event, sign });
    if (deltaQueueTimer === null) drainDeltaQueue();
  };
  const drainDeltaQueue = () => {
    const next = deltaQueue.shift();
    if (next === undefined) {
      deltaQueueTimer = null;
      return;
    }
    showDelta(next.event, next.sign);
    deltaQueueTimer = setTimeout(drainDeltaQueue, DELTA_QUEUE_GAP_MS);
  };
  /** 上次渲染的余额文本（用于对比哪些数字需要滚动）。 */
  let lastAmountText = null;
  const escAmountChar = (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return ch;
  };
  /** 整段数字滚筒：旧值在上、新值在下，向上滚动一格（纯 CSS 动画，￥ 不参与）。 */
  const buildOdometer = (oldText, newText) => (
    `<span class="dsh-tb-amt-reel"><span class="dsh-tb-amt-reel-cell">${escAmountChar(oldText)}</span><span class="dsh-tb-amt-reel-cell">${escAmountChar(newText)}</span></span>`
  );
  const renderBalance = (mode = "none") => {
    const shown = balanceValue === null ? NaN : balanceValue;
    const numText = Number.isFinite(shown) ? shown.toFixed(2) : "--";
    panelTotal.textContent = fmtMoney(shown);
    if (mode === "miss") {
      // 未命中暴击：纯文本 + 跳动动画（由 showDelta 加类）
      numSpan.textContent = numText;
      lastAmountText = numText;
      return;
    }
    if (mode === "reel" && lastAmountText !== null && lastAmountText !== numText) {
      numSpan.innerHTML = buildOdometer(lastAmountText, numText);
      lastAmountText = numText;
      return;
    }
    numSpan.textContent = numText;
    lastAmountText = numText;
  };
  /**
  * 合并调度余额渲染：同一批事件/短时间内的多次变动只滚动一次，
  * 避免连续重建 DOM、反复重启滚筒动画导致的卡顿。
  * 批内只要含未命中暴击就按 miss 渲染（跳动），否则走转轮。
  */
  let balanceRenderTimer = null;
  let balanceRenderMode = "none";
  const scheduleBalanceRender = (mode) => {
    if (mode === "miss") balanceRenderMode = "miss";
    else if (balanceRenderMode !== "miss") balanceRenderMode = mode;
    if (balanceRenderTimer !== null) return;
    balanceRenderTimer = setTimeout(() => {
      balanceRenderTimer = null;
      renderBalance(balanceRenderMode);
    }, 60);
  };
  const setReceiptVisibility = () => {
    receiptBtn.hidden = !appSettings.receiptEnabled;
  };
  receiptBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openReceipt();
  });
  // 右键余额 → 直接打开/收起余额详情面板（面板内含 打印小票 入口）
  balance.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    balancePanel.classList.toggle("dsh-tb-panel-open");
  });
  document.addEventListener("pointerdown", (event) => {
    if (!balance.contains(event.target)) balancePanel.classList.remove("dsh-tb-panel-open");
  });
  // 应用桌面设置（余额插件 / 小票开关），并跟随设置变更实时刷新
  settingsDotEl = settingsDot;
  updateSettingsDot();
  applySettings(appSettings);
  setReceiptVisibility();
  api.getSettings().then((settings) => { if (settings) applySettings(settings); }).catch(() => {});
  api.onSettingsChanged((settings) => { if (settings) applySettings(settings); });

  const pollCharges = async () => {
    if (chargePollInFlight) return;
    chargePollInFlight = true;
    try {
      const res = await fetch(`/api/token-monitor/charge-events?since=${chargeSeq}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!chargeSeeded) {
        chargeSeq = typeof data.seq === "number" ? data.seq : chargeSeq;
        chargeSeeded = true;
        return;
      }
      if (Array.isArray(data.events)) {
        for (const event of data.events) {
          if (typeof event.seq === "number") chargeSeq = Math.max(chargeSeq, event.seq);
          // 余额由服务端按「官方余额 - 待扣扣费」统一计算（持久化，重启不丢），
          // 这里只展示扣费提示，不再本地递减。
          enqueueDelta(event, "-");
        }
      }
      if (typeof data.seq === "number") chargeSeq = Math.max(chargeSeq, data.seq);
    } catch { /* server may not be ready during page navigation */ }
    finally { chargePollInFlight = false; }
  };
  const pollBalance = async () => {
    try {
      const res = await fetch("/api/token-monitor/balance", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !Number.isFinite(Number(data.totalBalance))) {
        numSpan.textContent = "--";
        lastAmountText = "--";
        panelTotal.textContent = "--";
        panelGranted.textContent = "--";
        balance.title = "DeepSeek 账户余额同步中…";
        return;
      }
      // 展示余额 = 官方余额 - 官方尚未反映的本地扣费（pendingCost 由服务端持久化计算），允许为负
      const next = Number(data.totalBalance) - (Number(data.pendingCost) || 0);
      const remoteDelta = remoteBalanceValue === null ? 0 : next - remoteBalanceValue;
      remoteBalanceValue = next;
      if (balanceValue === null || Math.abs(remoteDelta) > 1e-9) balanceValue = next;
      scheduleBalanceRender("reel");
      panelGranted.textContent = fmtMoney(Number(data.grantedBalance) || 0);
      balance.title = `DeepSeek 账户余额：${fmtMoney(next)}${data.grantedBalance > 0 ? `，赠送 ${fmtMoney(data.grantedBalance)}` : ""}`;
      if (Math.abs(remoteDelta) > 1e-9) showDelta({ cost: Math.abs(remoteDelta), damageKind: "normal" }, remoteDelta > 0 ? "+" : "-");
    } catch { /* keep the last known titlebar value */ }
  };
  void pollBalance();
  void pollCharges();
  updateSeason();
  // 启动即拉取价格表：峰谷指示（峰/谷）跟随已保存的时段
  void loadPricingTable().then(() => updateSeason());
  // 每秒读取本地余额缓存；Host 余额服务本身仍按其轮询周期访问官方接口。
  balanceTimer = setInterval(pollBalance, 1000);
  // 扣费事件由 Host 在 usage 到达后立即入队；短轮询让标题栏尽快反映结果。
  chargeTimer = setInterval(pollCharges, 250);
  setInterval(updateSeason, 30000);
}

// ---------- 软件设置弹窗（Harness版本 / 通用设置） ----------

/** 桌面设置本地缓存（与主进程 settings.json 同步）。 */
let appSettings = { balancePlugin: true, receiptEnabled: true, updateChannel: "latest" };
/** 设置按钮新版本小红点元素。 */
let settingsDotEl = null;
/** 待提示的新版本信息（每个版本只提示一次）。 */
let updateNoticeInfo = null;
/** 设置弹窗元素与状态。 */
let settingsDialogEl = null;
let settingsPanelName = "versions";
let versionListData = null;
let installingVersion = null;
let pricingControls = null;
/** 版本安装模式：当前正在安装的版本号（启动页安装视图使用）。 */
let pendingInstallVersionLocal = null;

let priceTable = null;
const DEFAULT_PRICE_TABLE = {
  version: "2026-08-17",
  // 执行峰谷计费的星期：1=周一 … 7=周日（DeepSeek 周六日取消峰谷，默认周一至周五）
  weekdays: [1, 2, 3, 4, 5],
  peakHours: [[9, 12], [14, 18]],
  models: {
    "deepseek-v4-flash": {
      offPeak: { input: 1.5, cacheHit: 0.05, output: 4.5 },
      peak: { input: 3, cacheHit: 0.1, output: 9 },
    },
    "deepseek-v4-pro": {
      offPeak: { input: 4.5, cacheHit: 0.15, output: 13.5 },
      peak: { input: 9, cacheHit: 0.3, output: 27 },
    },
  },
};
const clonePriceTable = (table) => JSON.parse(JSON.stringify(table));

const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 简易 semver 比较（与主进程回退实现一致）。 */
function compareVersionsPreload(a, b) {
  const parse = (v) => {
    const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    if (!m) return [0, 0, 0, ""];
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ""];
  };
  const [ma, pa, ra, prea] = parse(a);
  const [mb, pb, rb, preb] = parse(b);
  for (const [x, y] of [[ma, mb], [pa, pb], [ra, rb]]) {
    if (x !== y) return x > y ? 1 : -1;
  }
  if (prea === preb) return 0;
  if (prea === "") return 1;
  if (preb === "") return -1;
  return prea < preb ? -1 : 1;
}

/** 应用桌面设置到界面（余额插件开关 / 小票开关 / llama 配置）。 */
function applySettings(s) {
  if (!s || typeof s !== "object") return;
  appSettings = { ...appSettings, ...s };
  const balance = document.getElementById("dsh-tb-balance");
  if (balance) {
    balance.style.display = appSettings.balancePlugin ? "" : "none";
  }
  const receiptBtn = document.getElementById("dsh-tb-receipt-btn");
  if (receiptBtn) receiptBtn.hidden = !appSettings.receiptEnabled;
  // llama 配置变更（保存后主进程会广播）：同步面板数据并轻量刷新
  if (s.llama && typeof s.llama === "object" && llamaData) {
    llamaData.config = s.llama;
    renderLlamaPanel();
  }
  syncSettingsSwitches();
}

/** 设置按钮新版本红点。 */
function updateSettingsDot() {
  if (!settingsDotEl) return;
  settingsDotEl.hidden = !updateNoticeInfo;
  const btn = settingsDotEl.closest(".dsh-tb-settings");
  if (btn) btn.title = updateNoticeInfo ? `发现新版本 v${updateNoticeInfo.latest}，点击查看` : "软件设置";
}

// ---------- 计费设置（峰谷价格表，迁移至设置弹窗的"余额插件设置"下拉内） ----------

function ensurePriceTable() {
  if (priceTable === null) priceTable = clonePriceTable(DEFAULT_PRICE_TABLE);
  if (!priceTable.models) priceTable.models = {};
  for (const model of Object.keys(DEFAULT_PRICE_TABLE.models)) {
    if (!priceTable.models[model]) priceTable.models[model] = clonePriceTable(DEFAULT_PRICE_TABLE.models[model]);
    for (const scope of ["offPeak", "peak"]) {
      if (!priceTable.models[model][scope]) priceTable.models[model][scope] = {};
      for (const key of ["input", "cacheHit", "output"]) {
        const value = Number(priceTable.models[model][scope][key]);
        if (!Number.isFinite(value) || value < 0) {
          priceTable.models[model][scope][key] = DEFAULT_PRICE_TABLE.models[model][scope][key];
        }
      }
    }
  }
  if (!Array.isArray(priceTable.peakHours)) priceTable.peakHours = clonePriceTable(DEFAULT_PRICE_TABLE.peakHours);
  if (!Array.isArray(priceTable.weekdays)) priceTable.weekdays = clonePriceTable(DEFAULT_PRICE_TABLE.weekdays);
  if (typeof priceTable.version !== "string") priceTable.version = DEFAULT_PRICE_TABLE.version;
  return priceTable;
}

/** 从服务端拉取价格表；失败回退默认值。 */
async function loadPricingTable() {
  try {
    const res = await fetch("/api/token-monitor/pricing", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    priceTable = await res.json();
    return priceTable;
  } catch {
    priceTable = clonePriceTable(DEFAULT_PRICE_TABLE);
    return priceTable;
  }
}

/** 在指定容器内绑定计费设置表单（模型 / 价格 / 峰谷日期 / 峰谷时段 / 默认 / 保存）。 */
function attachPricingForm(root) {
  const priceModel = root.querySelector("#dsh-tb-price-model");
  const priceStatus = root.querySelector("#dsh-tb-price-status");
  const priceReset = root.querySelector("#dsh-tb-price-reset");
  const priceSave = root.querySelector("#dsh-tb-price-save");
  const priceInputs = Array.from(root.querySelectorAll(".dsh-tb-price-input:not(.dsh-tb-time-input)"));
  const weekdayWrap = root.querySelector("#dsh-tb-price-weekdays");
  const segmentWrap = root.querySelector("#dsh-tb-price-segments");
  const addSegmentBtn = root.querySelector("#dsh-tb-price-add");
  const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
  let priceStatusTimer = null;

  const activePriceModel = () => (priceModel && priceModel.value ? priceModel.value : "deepseek-v4-flash");
  const setPriceStatus = (text, opts = {}) => {
    if (!priceStatus) return;
    priceStatus.textContent = text;
    priceStatus.classList.toggle("dsh-tb-price-status-ok", !!opts.ok);
    priceStatus.classList.toggle("dsh-tb-price-status-err", !!opts.err);
    if (priceStatusTimer !== null) {
      clearTimeout(priceStatusTimer);
      priceStatusTimer = null;
    }
    if (opts.ok || opts.err) {
      priceStatusTimer = setTimeout(() => {
        priceStatus.classList.remove("dsh-tb-price-status-ok", "dsh-tb-price-status-err");
        priceStatusTimer = null;
      }, 3500);
    }
  };
  /** 数字小时 → "HH:MM"（24 → "00:00"，表示次日零点）。 */
  const hoursToTime = (value) => {
    const h = Number(value);
    if (!Number.isFinite(h)) return "09:00";
    const total = Math.max(0, Math.min(24, h));
    const hh = Math.floor(total);
    const mm = Math.round((total - hh) * 60);
    if (mm === 60) {
      return hoursToTime(hh + 1);
    }
    if (hh === 24) return "00:00";
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  /** "HH:MM" → 数字小时（"00:00" 且 start>0 时视为 24）。 */
  const timeToHours = (text, isEnd) => {
    const m = String(text || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    if (mm % 5 !== 0) return null;
    if (hh === 24) hh = 24;
    if (hh === 0 && mm === 0 && isEnd) return 24;
    if (hh > 23 && hh !== 24) return null;
    if (hh === 24 && mm !== 0) return null;
    return hh + mm / 60;
  };
  /** 渲染星期圆圈（一 ～ 日），蓝色=激活。 */
  const renderWeekdays = () => {
    if (!weekdayWrap) return;
    ensurePriceTable();
    const active = Array.isArray(priceTable.weekdays) ? priceTable.weekdays : DEFAULT_PRICE_TABLE.weekdays;
    weekdayWrap.innerHTML = WEEKDAY_LABELS.map((label, index) => {
      const day = index + 1;
      const on = active.includes(day);
      return `<button class="dsh-tb-price-day${on ? " dsh-tb-price-day-on" : ""}" data-day="${day}" type="button" title="${on ? "已激活（执行峰谷）" : "未激活（全天谷价）"}">${label}</button>`;
    }).join("");
    weekdayWrap.querySelectorAll(".dsh-tb-price-day").forEach((btn) => {
      btn.addEventListener("click", () => {
        const day = Number(btn.dataset.day);
        const next = priceTable.weekdays.includes(day)
          ? priceTable.weekdays.filter((d) => d !== day)
          : [...priceTable.weekdays, day].sort((a, b) => a - b);
        priceTable.weekdays = next;
        renderWeekdays();
      });
    });
  };
  /** 渲染动态时段行（每条：开始时间 – 结束时间 + 删除）。 */
  const renderSegments = () => {
    if (!segmentWrap) return;
    ensurePriceTable();
    const peaks = Array.isArray(priceTable.peakHours) ? priceTable.peakHours : DEFAULT_PRICE_TABLE.peakHours;
    segmentWrap.innerHTML = peaks.map((pair, index) => {
      const start = hoursToTime(pair[0]);
      const end = hoursToTime(pair[1]);
      return `<div class="dsh-tb-price-segment" data-seg-index="${index}">
        <input type="time" class="dsh-tb-time-input" data-seg-role="start" step="300" value="${start}">
        <span class="dsh-tb-time-dash">–</span>
        <input type="time" class="dsh-tb-time-input" data-seg-role="end" step="300" value="${end}">
        <button class="dsh-tb-price-seg-del" data-seg-del type="button" title="删除该时段">×</button>
      </div>`;
    }).join("") || `<div class="dsh-tb-panel-muted">暂未设置时段（将始终按谷价计费）</div>`;
    segmentWrap.querySelectorAll("[data-seg-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".dsh-tb-price-segment");
        const index = Number(row && row.dataset.segIndex);
        if (Number.isInteger(index) && Array.isArray(priceTable.peakHours)) {
          priceTable.peakHours.splice(index, 1);
          renderSegments();
        }
      });
    });
  };
  const renderPriceForm = () => {
    ensurePriceTable();
    const model = activePriceModel();
    const modelTable = (priceTable.models && priceTable.models[model]) || DEFAULT_PRICE_TABLE.models[model];
    for (const input of priceInputs) {
      const scope = input.dataset.rateScope;
      const key = input.dataset.rateKey;
      input.value = String(modelTable[scope][key]);
    }
    renderWeekdays();
    renderSegments();
  };
  /** 读取表单：价格 + 星期 + 时段，返回可保存的完整价格表。 */
  const readPriceForm = () => {
    ensurePriceTable();
    const model = activePriceModel();
    for (const input of priceInputs) {
      const scope = input.dataset.rateScope;
      const key = input.dataset.rateKey;
      const value = Number(input.value.trim());
      if (!Number.isFinite(value) || value < 0) throw new Error("价格必须是非负数字");
      priceTable.models[model][scope][key] = value;
    }
    // 星期：读取当前圆圈激活态（不要求至少一天，全关=全天谷价）
    priceTable.weekdays = Array.from(weekdayWrap.querySelectorAll(".dsh-tb-price-day.dsh-tb-price-day-on"))
      .map((btn) => Number(btn.dataset.day))
      .sort((a, b) => a - b);
    // 时段：读取每行时间输入
    const peakHours = [];
    for (const row of segmentWrap.querySelectorAll(".dsh-tb-price-segment")) {
      const startText = row.querySelector('[data-seg-role="start"]').value;
      const endText = row.querySelector('[data-seg-role="end"]').value;
      const start = timeToHours(startText, false);
      const end = timeToHours(endText, true);
      if (start === null || end === null) throw new Error("时段时间格式不正确（HH:MM，分钟按 5 分钟步进）");
      if (start >= end) throw new Error("时段开始必须早于结束");
      peakHours.push([start, end]);
    }
    priceTable.peakHours = peakHours;
    priceTable.version = "desktop-custom";
    return priceTable;
  };
  const savePricing = async (table) => {
    const res = await fetch("/api/token-monitor/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(table),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    priceTable = await res.json();
    renderPriceForm();
  };
  const refreshSeason = () => {
    if (typeof window.dshRefreshSeason === "function") window.dshRefreshSeason();
  };
  for (const input of priceInputs) {
    input.addEventListener("input", () => {
      ensurePriceTable();
      const value = Number(input.value.trim());
      if (!Number.isFinite(value) || value < 0) return;
      priceTable.models[activePriceModel()][input.dataset.rateScope][input.dataset.rateKey] = value;
    });
  }
  if (priceModel) priceModel.addEventListener("change", () => renderPriceForm());
  if (addSegmentBtn) {
    addSegmentBtn.addEventListener("click", () => {
      ensurePriceTable();
      if (!Array.isArray(priceTable.peakHours)) priceTable.peakHours = [];
      // 默认新增 09:00 – 12:00 一段，可即时编辑
      priceTable.peakHours.push([9, 12]);
      renderSegments();
    });
  }
  if (priceReset) {
    priceReset.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      priceTable = clonePriceTable(DEFAULT_PRICE_TABLE);
      renderPriceForm();
      try {
        setPriceStatus("保存中");
        await savePricing(priceTable);
        setPriceStatus("已恢复默认，立即生效", { ok: true });
        refreshSeason();
      } catch {
        setPriceStatus("保存失败", { err: true });
      }
    });
  }
  if (priceSave) {
    priceSave.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        setPriceStatus("保存中");
        await savePricing(readPriceForm());
        setPriceStatus("已保存，立即生效", { ok: true });
        refreshSeason();
      } catch (error) {
        setPriceStatus(error instanceof Error ? error.message : "保存失败", { err: true });
      }
    });
  }
  const refresh = async () => {
    await loadPricingTable();
    renderPriceForm();
    setPriceStatus("已读取");
  };
  void refresh();
  return { refresh };
}

// ---------- 设置弹窗 UI ----------

const SETTINGS_DIALOG_CSS = `
#dsh-settings-dialog {
  --dsh-set-accent: #4d6bfe;
  position: fixed; inset: 0; z-index: 2147483647;
  display: none; align-items: center; justify-content: center;
  background: rgba(8, 10, 16, 0.34);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  /* 字体与 dsh 一致（页面已加载 DM Sans 等字体文件） */
  font-family: var(--ds-font-sans, "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif);
}
#dsh-settings-dialog.dsh-set-open { display: flex; }
#dsh-settings-dialog.dsh-set-open .dsh-set-card { animation: dsh-set-in .2s cubic-bezier(.2,.7,.3,1) both; }
@keyframes dsh-set-in {
  from { opacity: 0; transform: translateY(10px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.dsh-set-card {
  width: 660px; max-width: calc(100vw - 40px);
  height: 620px; max-height: calc(100vh - 60px);
  display: flex; flex-direction: column;
  border-radius: 16px; overflow: hidden;
  background: var(--dsw-alias-bg-module-platform, #171b24);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  box-shadow: 0 16px 48px rgba(0,0,0,.34);
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
.dsh-set-head {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 14px; flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
}
.dsh-set-mark { color: var(--dsh-set-accent); flex: none; display: block; }
.dsh-set-title { font-size: 14px; font-weight: 400; flex: 1; letter-spacing: .04em; }
.dsh-set-close {
  -webkit-app-region: no-drag;
  appearance: none; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  width: 26px; height: 26px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .12s ease, color .12s ease;
}
.dsh-set-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-set-body { flex: 1; display: flex; min-height: 0; }
/* 左侧导航：dsh 风格，带字间距与活动药丸 */
.dsh-set-sidebar {
  width: 140px; flex: none;
  padding: 14px 10px;
  border-right: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));
  display: flex; flex-direction: column; gap: 4px;
}
.dsh-set-nav {
  -webkit-app-region: no-drag;
  appearance: none; border: none; background: transparent; cursor: pointer;
  text-align: left; width: 100%;
  padding: 9px 12px; border-radius: 9px;
  font: inherit; font-size: 12.5px; font-weight: 400;
  letter-spacing: .06em;
  color: var(--dsw-alias-label-secondary, #aeb3bd);
  transition: background .14s ease, color .14s ease, transform .08s ease;
}
.dsh-set-nav:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.07)); color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-set-nav:active { transform: scale(.98); }
.dsh-set-nav:focus { outline: none; }
.dsh-set-nav:focus-visible { outline: none; }
.dsh-set-nav.dsh-set-nav-on {
  background: color-mix(in srgb, var(--dsh-set-accent) 15%, transparent);
  color: var(--dsh-set-accent);
  font-weight: 400;
}
.dsh-set-content { flex: 1; min-width: 0; padding: 16px 18px 26px; overflow-y: auto; display: flex; flex-direction: column; }
.dsh-set-panel { display: none; flex-direction: column; min-height: 0; flex: 1; }
.dsh-set-panel.dsh-set-panel-on { display: flex; }
.dsh-set-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.dsh-set-panel-title { font-size: 15px; font-weight: 400; letter-spacing: .05em; }
.dsh-set-panel-sub { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #8a8f98); font-variant-numeric: tabular-nums; }
/* 频道滑块：滑动药丸 */
.dsh-set-channel { display: flex; align-items: center; gap: 14px; margin: 2px 0 12px; }
.dsh-set-channel-label { font-size: 12px; letter-spacing: .04em; color: var(--dsw-alias-label-secondary, #aeb3bd); }
.dsh-set-seg {
  position: relative;
  display: inline-flex; padding: 3px; gap: 2px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  border-radius: 10px; background: var(--dsw-alias-bg-base, #171b24);
}
.dsh-set-seg-pill {
  position: absolute; top: 3px; bottom: 3px; left: 3px;
  width: calc(50% - 3px);
  border-radius: 7px;
  background: var(--dsh-set-accent);
  box-shadow: 0 2px 6px rgba(77,107,254,.35);
  transition: transform .22s cubic-bezier(.2,.7,.3,1);
}
.dsh-set-seg[data-channel="next"] .dsh-set-seg-pill { transform: translateX(100%); }
.dsh-set-seg-btn {
  -webkit-app-region: no-drag;
  appearance: none; border: none; cursor: pointer;
  position: relative; z-index: 1;
  padding: 5px 18px; border-radius: 7px;
  font: inherit; font-size: 12px; font-weight: 400;
  letter-spacing: .05em;
  color: var(--dsw-alias-label-secondary, #aeb3bd);
  background: transparent;
  transition: color .16s ease;
}
.dsh-set-seg-btn.dsh-set-seg-on { color: #fff; }
.dsh-set-seg-btn:focus { outline: none; }
.dsh-set-seg-btn:focus-visible { outline: none; }
/* 版本列表 */
.dsh-set-version-list {
  flex: 1; min-height: 120px; overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, #171b24);
}
.dsh-set-version-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; font-size: 12px;
  transition: background .12s ease;
}
.dsh-set-version-row + .dsh-set-version-row { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.16)); }
.dsh-set-version-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.05)); }
.dsh-set-version-name {
  font-family: var(--ds-font-mono, ui-monospace, "Fragment Mono", Consolas, monospace);
  font-weight: 400;
  color: var(--dsw-alias-label-primary, #e8eaf0); flex: 1; min-width: 0;
}
.dsh-set-version-tag { flex: none; font-size: 11px; padding: 2px 8px; border-radius: 6px; letter-spacing: .02em; }
.dsh-set-version-tag.dsh-set-tag-current { background: color-mix(in srgb, #2ea043 18%, transparent); color: #34c56b; }
.dsh-set-version-tag.dsh-set-tag-latest { background: color-mix(in srgb, var(--dsh-set-accent) 16%, transparent); color: var(--dsh-set-accent); }
/* 底部静态状态栏：固定不动，不随状态变化产生布局跳动 */
.dsh-set-version-foot {
  flex: none;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 34px; margin-top: 10px; padding: 6px 10px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-base, #171b24);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));
}
.dsh-set-version-foot-status {
  flex: 1; min-width: 0;
  font-size: 12px; line-height: 1.4;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-set-version-foot-status.dsh-set-foot-ok { color: #34c56b; }
.dsh-set-version-foot-status.dsh-set-foot-new { color: var(--dsh-set-accent); font-weight: 400; }
.dsh-set-version-foot-status.dsh-set-foot-err { color: #e45555; }
.dsh-set-version-foot-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; }
/* 按钮 */
.dsh-set-btn {
  -webkit-app-region: no-drag;
  appearance: none; border: none; cursor: pointer;
  padding: 6px 14px; border-radius: 9px;
  font: inherit; font-size: 12px; font-weight: 400;
  letter-spacing: .03em;
  transition: filter .14s ease, background .14s ease, transform .06s ease;
}
.dsh-set-btn:active { transform: scale(.97); }
.dsh-set-btn:focus { outline: none; }
.dsh-set-btn:focus-visible { outline: none; }
.dsh-set-btn-primary { background: var(--dsh-set-accent); color: #fff; }
.dsh-set-btn-primary:hover { filter: brightness(1.08); }
.dsh-set-btn-primary:disabled { opacity: .55; cursor: default; }
.dsh-set-btn-ghost {
  background: transparent; color: var(--dsw-alias-label-secondary, #b4b9c2);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
}
.dsh-set-btn-ghost:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.07)); color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-set-btn-ghost:focus { outline: none; }
.dsh-set-btn-ghost:focus-visible { outline: none; }
.dsh-set-btn-sm { padding: 3px 12px; font-size: 11.5px; }
/* 通用设置 */
.dsh-set-section {
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, #171b24);
  transition: border-color .15s ease;
}
.dsh-set-section:hover { border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.34)); }
.dsh-set-section + .dsh-set-section { margin-top: 10px; }
.dsh-set-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.dsh-set-row-text { min-width: 0; }
.dsh-set-row-title { font-size: 13px; font-weight: 400; letter-spacing: .04em; }
.dsh-set-row-sub { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #8a8f98); margin-top: 7px; letter-spacing: .01em; line-height: 1.5; }
/* 开关：带弹性动效 */
.dsh-set-switch { position: relative; display: inline-block; flex: none; width: 40px; height: 23px; }
.dsh-set-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 2; }
.dsh-set-switch-track {
  position: absolute; inset: 0; border-radius: 12px;
  background: var(--dsw-alias-border-l2, rgba(128,128,128,.32));
  transition: background .18s ease;
  pointer-events: none;
}
.dsh-set-switch-track::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 19px; height: 19px; border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.32);
  transition: transform .2s cubic-bezier(.34,1.56,.64,1);
}
.dsh-set-switch input:checked + .dsh-set-switch-track { background: var(--dsh-set-accent); }
.dsh-set-switch input:checked + .dsh-set-switch-track::after { transform: translateX(17px); }
/* 余额插件设置：白色可折叠表单（收起时仍可看到下方填写项预览） */
.dsh-set-subsection { margin-top: 16px; }
.dsh-set-subsection-head {
  -webkit-app-region: no-drag;
  appearance: none; border: none; background: transparent; cursor: pointer;
  width: 100%;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border-radius: 9px;
  font: inherit; text-align: left;
  transition: background .14s ease;
}
.dsh-set-subsection-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06)); }
.dsh-set-subsection-head:focus { outline: none; }
.dsh-set-subsection-head:focus-visible { outline: none; }
.dsh-set-subsection-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 400; letter-spacing: .06em;
  color: var(--dsw-alias-label-secondary, #b4b9c2);
}
.dsh-set-subsection-title::before {
  content: ""; width: 3px; height: 12px; border-radius: 2px;
  background: linear-gradient(180deg, var(--dsh-set-accent), #8fa3ff);
}
.dsh-set-subsection-head .dsh-tb-action-caret {
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  transition: transform .18s ease;
}
.dsh-set-subsection-head.dsh-set-subsection-on .dsh-tb-action-caret { transform: rotate(90deg); }
/* 收起：完全隐藏（不留预览）；展开：显示完整表单 */
.dsh-set-subsection-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height .22s cubic-bezier(.2,.7,.3,1);
}
.dsh-set-subsection-body.dsh-set-subsection-open { max-height: 760px; }
/* 白色表单卡片（紧凑：小号控件 + 宽松间距，避免挤压感） */
.dsh-set-subsection-inner {
  margin-top: 8px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e3e7f0;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, .08);
}
.dsh-tb-panel-muted { color: var(--dsw-alias-label-tertiary, #8a8f98); }

/* ===== 计费表单（白色纸面质感：白底 + 浅灰输入框 + 品牌蓝焦点 + 峰谷配色） ===== */
#dsh-settings-dialog .dsh-set-subsection-inner .dsh-tb-panel-muted { color: #5b6478; font-size: 11px; }
#dsh-settings-dialog .dsh-tb-price-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
#dsh-settings-dialog .dsh-tb-price-select {
  appearance: none; -webkit-appearance: none;
  min-width: 128px; height: 26px; padding: 0 24px 0 8px;
  border: 1px solid #d9dfeb;
  border-radius: 8px;
  background-color: #f7f9fc;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5 L5 6.5 L8 3.5' fill='none' stroke='%234d6bfe' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  color: #1f2430;
  font: inherit; font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: border-color .14s ease, box-shadow .14s ease;
}
#dsh-settings-dialog .dsh-tb-price-select:hover { border-color: color-mix(in srgb, #4d6bfe 55%, #d9dfeb); }
#dsh-settings-dialog .dsh-tb-price-select:focus {
  outline: none; border-color: #4d6bfe;
  box-shadow: 0 0 0 3px rgba(77,107,254,.18);
}
#dsh-settings-dialog .dsh-tb-price-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 6px 8px;
  align-items: center;
}
#dsh-settings-dialog .dsh-tb-price-grid > span {
  font-size: 11px; letter-spacing: .03em; color: #5b6478;
}
#dsh-settings-dialog .dsh-tb-price-grid > span:nth-child(2) { color: #16a34a; font-weight: 400; }
#dsh-settings-dialog .dsh-tb-price-grid > span:nth-child(3) { color: #d97706; font-weight: 400; }
#dsh-settings-dialog .dsh-tb-price-input {
  width: 100%; height: 26px; padding: 0 8px;
  border: 1px solid #d9dfeb;
  border-radius: 8px;
  background: #f7f9fc;
  color: #1f2430;
  font: inherit; font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  outline: none;
  transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
}
#dsh-settings-dialog .dsh-tb-price-input:hover { border-color: color-mix(in srgb, #4d6bfe 45%, #d9dfeb); }
#dsh-settings-dialog .dsh-tb-price-input:focus {
  border-color: #4d6bfe;
  box-shadow: 0 0 0 3px rgba(77,107,254,.18);
  background: #ffffff;
}
#dsh-settings-dialog .dsh-tb-price-input::placeholder { color: #9aa3b5; }
#dsh-settings-dialog .dsh-tb-price-peak-title {
  margin-top: 12px;
  font-size: 11px; letter-spacing: .03em;
  color: #5b6478;
}
/* 峰谷日期：圆形切换按钮（一 ～ 日，蓝色=激活） */
#dsh-settings-dialog .dsh-tb-price-weekdays {
  margin-top: 8px;
  display: flex; align-items: center; gap: 6px;
}
#dsh-settings-dialog .dsh-tb-price-day {
  -webkit-app-region: no-drag;
  appearance: none; cursor: pointer;
  width: 30px; height: 30px; border-radius: 50%;
  border: 1px solid #d9dfeb; background: #f7f9fc; color: #5b6478;
  font: inherit; font-size: 12px; letter-spacing: .02em;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .06s ease;
}
#dsh-settings-dialog .dsh-tb-price-day:hover { border-color: color-mix(in srgb, #4d6bfe 55%, #d9dfeb); color: #4d6bfe; }
#dsh-settings-dialog .dsh-tb-price-day:active { transform: scale(.94); }
#dsh-settings-dialog .dsh-tb-price-day.dsh-tb-price-day-on {
  background: linear-gradient(135deg, #4d6bfe, #6f8bff);
  border-color: transparent; color: #fff;
  box-shadow: 0 2px 8px rgba(77, 107, 254, .35);
}
/* 峰谷时段：动态行 + 时间输入 + 删除 */
#dsh-settings-dialog .dsh-tb-price-segments {
  margin-top: 8px;
  display: flex; flex-direction: column; gap: 6px;
}
#dsh-settings-dialog .dsh-tb-price-segment {
  display: flex; align-items: center; gap: 7px;
}
#dsh-settings-dialog .dsh-tb-time-input {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px;
  border: 1px solid #d9dfeb; border-radius: 8px;
  background: #f7f9fc; color: #1f2430;
  font: inherit; font-size: 12px;
  font-variant-numeric: tabular-nums;
  outline: none; color-scheme: light;
  transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
}
#dsh-settings-dialog .dsh-tb-time-input:hover { border-color: color-mix(in srgb, #4d6bfe 45%, #d9dfeb); }
#dsh-settings-dialog .dsh-tb-time-input:focus {
  border-color: #4d6bfe;
  box-shadow: 0 0 0 3px rgba(77, 107, 254, .18);
  background: #ffffff;
}
#dsh-settings-dialog .dsh-tb-time-dash { color: #9aa3b5; flex: none; }
#dsh-settings-dialog .dsh-tb-price-seg-del {
  -webkit-app-region: no-drag;
  appearance: none; cursor: pointer; flex: none;
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid #d9dfeb; background: transparent; color: #9aa3b5;
  font: inherit; font-size: 14px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  transition: border-color .14s ease, color .14s ease, background .14s ease;
}
#dsh-settings-dialog .dsh-tb-price-seg-del:hover { border-color: #dc2626; color: #dc2626; background: rgba(220, 38, 38, .06); }
#dsh-settings-dialog .dsh-tb-price-add {
  -webkit-app-region: no-drag;
  appearance: none; cursor: pointer;
  margin-top: 8px; height: 27px; padding: 0 12px; border-radius: 8px;
  border: 1px dashed #c6cede; background: transparent; color: #5b6478;
  font: inherit; font-size: 11.5px; letter-spacing: .02em;
  transition: border-color .14s ease, color .14s ease;
}
#dsh-settings-dialog .dsh-tb-price-add:hover { border-color: #4d6bfe; color: #4d6bfe; }
#dsh-settings-dialog .dsh-tb-price-actions {
  margin-top: 10px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
#dsh-settings-dialog .dsh-tb-price-status {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: #5b6478;
}
#dsh-settings-dialog .dsh-tb-price-status.dsh-tb-price-status-ok { color: #16a34a; font-weight: 400; }
#dsh-settings-dialog .dsh-tb-price-status.dsh-tb-price-status-err { color: #dc2626; font-weight: 400; }
#dsh-settings-dialog .dsh-tb-price-buttons { display: inline-flex; align-items: center; gap: 6px; flex: none; }
#dsh-settings-dialog .dsh-tb-price-btn {
  -webkit-app-region: no-drag;
  appearance: none; cursor: pointer;
  height: 26px; padding: 0 12px; border-radius: 8px;
  border: 1px solid #d9dfeb;
  background: transparent; color: #334155;
  font: inherit; font-size: 11.5px; font-weight: 400;
  transition: background .14s ease, color .14s ease, transform .06s ease;
}
#dsh-settings-dialog .dsh-tb-price-btn:hover { background: #f1f5f9; color: #1f2430; }
#dsh-settings-dialog .dsh-tb-price-btn:active { transform: scale(.97); }
#dsh-settings-dialog .dsh-tb-price-btn.dsh-tb-price-btn-primary {
  border: none;
  background: linear-gradient(135deg, #4d6bfe, #6f8bff);
  color: #fff;
  box-shadow: 0 3px 10px rgba(77,107,254,.35);
}
#dsh-settings-dialog .dsh-tb-price-btn.dsh-tb-price-btn-primary:hover { filter: brightness(1.08); box-shadow: 0 4px 14px rgba(77,107,254,.42); }
/* ===== Llama 启动器 ===== */
.dsh-llama-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 400; letter-spacing: .02em;
  padding: 2px 8px; border-radius: 6px; vertical-align: 1px; margin-left: 6px;
}
.dsh-llama-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.dsh-llama-badge-stopped { background: rgba(128,128,128,.16); color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dsh-llama-badge-starting { background: rgba(217,119,6,.16); color: #e8a33d; }
.dsh-llama-badge-starting::before { animation: dsh-llama-pulse 1s ease-in-out infinite; }
.dsh-llama-badge-running { background: color-mix(in srgb, #2ea043 18%, transparent); color: #34c56b; }
.dsh-llama-badge-error { background: color-mix(in srgb, #e45555 18%, transparent); color: #e45555; }
@keyframes dsh-llama-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.dsh-llama-actions { display: inline-flex; align-items: center; gap: 8px; flex: none; }
.dsh-llama-title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dsh-llama-refresh {
  color: var(--dsh-set-accent, #4d6bfe);
  border-color: color-mix(in srgb, var(--dsh-set-accent, #4d6bfe) 35%, transparent);
}
.dsh-llama-refresh:hover {
  background: var(--dsh-set-accent, #4d6bfe);
  border-color: var(--dsh-set-accent, #4d6bfe);
  color: #fff;
}
.dsh-llama-mono {
  font-family: var(--ds-font-mono, ui-monospace, "Fragment Mono", Consolas, monospace);
  font-size: 11px; word-break: break-all;
}
.dsh-llama-select {
  -webkit-app-region: no-drag;
  appearance: none; -webkit-appearance: none;
  width: 100%; margin-top: 9px; height: 30px; padding: 0 28px 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  border-radius: 8px;
  background-color: var(--dsw-alias-bg-base, #171b24);
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5 L5 6.5 L8 3.5' fill='none' stroke='%238a8f98' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 9px center;
  color: var(--dsw-alias-label-primary, #e8eaf0);
  font: inherit; font-size: 12px;
  cursor: pointer; outline: none;
  transition: border-color .14s ease;
}
.dsh-llama-select:hover, .dsh-llama-select:focus { border-color: color-mix(in srgb, var(--dsh-set-accent) 55%, rgba(128,128,128,.3)); }
.dsh-llama-select-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.dsh-llama-select-row:first-of-type { margin-top: 9px; }
.dsh-llama-select-row .dsh-llama-select { margin-top: 0; flex: 1; min-width: 0; }
#dsh-settings-dialog .dsh-llama-param-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 9px 10px;
}
#dsh-settings-dialog .dsh-llama-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
#dsh-settings-dialog .dsh-llama-field > span { font-size: 11px; letter-spacing: .03em; color: #5b6478; }
#dsh-settings-dialog .dsh-llama-field-wide { grid-column: 1 / -1; }
#dsh-settings-dialog .dsh-llama-field input { width: 100%; }
`;

const PRICING_FORM_HTML = `
  <div class="dsh-tb-price-head">
    <span class="dsh-tb-panel-muted">模型</span>
    <select class="dsh-tb-price-select" id="dsh-tb-price-model">
      <option value="deepseek-v4-flash">deepseek-v4-flash</option>
      <option value="deepseek-v4-pro">deepseek-v4-pro</option>
    </select>
  </div>
  <div class="dsh-tb-price-grid">
    <span></span><span>谷</span><span>峰</span>
    <span>缓存命中</span>
    <input class="dsh-tb-price-input" data-rate-scope="offPeak" data-rate-key="cacheHit" inputmode="decimal">
    <input class="dsh-tb-price-input" data-rate-scope="peak" data-rate-key="cacheHit" inputmode="decimal">
    <span>缓存未命中</span>
    <input class="dsh-tb-price-input" data-rate-scope="offPeak" data-rate-key="input" inputmode="decimal">
    <input class="dsh-tb-price-input" data-rate-scope="peak" data-rate-key="input" inputmode="decimal">
    <span>输出</span>
    <input class="dsh-tb-price-input" data-rate-scope="offPeak" data-rate-key="output" inputmode="decimal">
    <input class="dsh-tb-price-input" data-rate-scope="peak" data-rate-key="output" inputmode="decimal">
  </div>
  <div class="dsh-tb-price-peak-title">峰谷日期（点击圆圈切换，蓝色=当天执行峰谷计费）</div>
  <div class="dsh-tb-price-weekdays" id="dsh-tb-price-weekdays"></div>
  <div class="dsh-tb-price-peak-title">峰谷时段（自定义，结束 00:00 表示次日零点）</div>
  <div class="dsh-tb-price-segments" id="dsh-tb-price-segments"></div>
  <button class="dsh-tb-price-add" id="dsh-tb-price-add" type="button">添加时段</button>
  <div class="dsh-tb-price-actions">
    <span class="dsh-tb-price-status" id="dsh-tb-price-status">读取中</span>
    <span class="dsh-tb-price-buttons">
      <button class="dsh-tb-price-btn" id="dsh-tb-price-reset" type="button">默认</button>
      <button class="dsh-tb-price-btn dsh-tb-price-btn-primary" id="dsh-tb-price-save" type="button">保存</button>
    </span>
  </div>
`;

/** Llama 启动器：运行参数表单（白色纸面，与计费表单同风格）。 */
const LLAMA_PARAMS_FORM_HTML = `
  <div class="dsh-llama-param-grid">
    <label class="dsh-llama-field"><span>监听端口</span><input class="dsh-tb-price-input" id="dsh-llama-port" inputmode="numeric" placeholder="8080"></label>
    <label class="dsh-llama-field"><span>上下文长度 -c</span><input class="dsh-tb-price-input" id="dsh-llama-ctx" inputmode="numeric" placeholder="4096"></label>
    <label class="dsh-llama-field"><span>GPU 层数 -ngl（0=纯 CPU）</span><input class="dsh-tb-price-input" id="dsh-llama-ngl" inputmode="numeric" placeholder="999"></label>
    <label class="dsh-llama-field"><span>线程数 -t（0=自动）</span><input class="dsh-tb-price-input" id="dsh-llama-threads" inputmode="numeric" placeholder="0"></label>
    <label class="dsh-llama-field"><span>并行会话 -np</span><input class="dsh-tb-price-input" id="dsh-llama-np" inputmode="numeric" placeholder="1"></label>
    <label class="dsh-llama-field"><span>API Key（可选）</span><input class="dsh-tb-price-input" id="dsh-llama-apikey" placeholder="留空不校验"></label>
    <label class="dsh-llama-field dsh-llama-field-wide"><span>附加参数（空格分隔，支持双引号）</span><input class="dsh-tb-price-input" id="dsh-llama-extra" placeholder="例如：--jinja --no-mmap"></label>
  </div>
  <div class="dsh-tb-price-actions">
    <span class="dsh-tb-price-status" id="dsh-llama-params-status"></span>
    <span class="dsh-tb-price-buttons">
      <button class="dsh-tb-price-btn" id="dsh-llama-params-reset" type="button">恢复默认</button>
      <button class="dsh-tb-price-btn dsh-tb-price-btn-primary" id="dsh-llama-params-save" type="button">保存参数</button>
    </span>
  </div>
`;

function ensureSettingsDialog() {
  if (settingsDialogEl) return settingsDialogEl;
  const style = document.createElement("style");
  style.id = "dsh-settings-dialog-style";
  style.textContent = SETTINGS_DIALOG_CSS;
  document.head.appendChild(style);
  settingsDialogEl = document.createElement("div");
  settingsDialogEl.id = "dsh-settings-dialog";
  settingsDialogEl.innerHTML = `
    <div class="dsh-set-card">
      <div class="dsh-set-head">
        <svg class="dsh-set-mark" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${OFFICIAL_MARK_PATH}"/></svg>
        <div class="dsh-set-title">软件设置</div>
        <button class="dsh-set-close" id="dsh-set-close" title="关闭" type="button">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
      <div class="dsh-set-body">
        <div class="dsh-set-sidebar">
          <button class="dsh-set-nav dsh-set-nav-on" data-panel="versions" type="button">Harness 版本</button>
          <button class="dsh-set-nav" data-panel="general" type="button">通用</button>
          <button class="dsh-set-nav" data-panel="llama" type="button">llama 启动器</button>
        </div>
        <div class="dsh-set-content">
          <section class="dsh-set-panel dsh-set-panel-on" data-panel="versions">
            <div class="dsh-set-panel-head">
              <div class="dsh-set-panel-title">Harness 版本</div>
              <div class="dsh-set-panel-sub" id="dsh-set-current-version">当前版本 v—</div>
            </div>
            <div class="dsh-set-channel">
              <span class="dsh-set-channel-label">版本频道</span>
              <div class="dsh-set-seg" id="dsh-set-channel-seg" data-channel="latest">
                <span class="dsh-set-seg-pill"></span>
                <button class="dsh-set-seg-btn dsh-set-seg-on" data-channel="latest" type="button">Latest</button>
                <button class="dsh-set-seg-btn" data-channel="next" type="button">Next</button>
              </div>
            </div>
            <div class="dsh-set-version-list" id="dsh-set-version-list"></div>
            <div class="dsh-set-version-foot">
              <span class="dsh-set-version-foot-status" id="dsh-set-update-status">打开即自动检查更新</span>
              <span class="dsh-set-version-foot-actions">
                <button class="dsh-set-btn dsh-set-btn-primary dsh-set-btn-sm" id="dsh-set-notice-install" type="button" hidden>立即更新</button>
                <button class="dsh-set-btn dsh-set-btn-ghost dsh-set-btn-sm" id="dsh-set-check-update" type="button">检查更新</button>
              </span>
            </div>
          </section>
          <section class="dsh-set-panel" data-panel="general">
            <div class="dsh-set-section">
              <div class="dsh-set-row">
                <div class="dsh-set-row-text">
                  <div class="dsh-set-row-title">余额插件</div>
                  <div class="dsh-set-row-sub">在标题栏显示 DeepSeek 账户余额与扣费提示</div>
                </div>
                <label class="dsh-set-switch"><input type="checkbox" id="dsh-set-balance-plugin"><span class="dsh-set-switch-track"></span></label>
              </div>
              <div class="dsh-set-subsection" id="dsh-set-pricing-wrap">
                <button class="dsh-set-subsection-head" id="dsh-set-pricing-toggle" type="button" aria-expanded="false">
                  <span class="dsh-set-subsection-title">余额插件设置</span>
                  <svg class="dsh-tb-action-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M3 1.5 L6.5 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <div class="dsh-set-subsection-body" id="dsh-set-pricing-body">
                  <div class="dsh-set-subsection-inner">${PRICING_FORM_HTML}</div>
                </div>
              </div>
            </div>
            <div class="dsh-set-section">
              <div class="dsh-set-row">
                <div class="dsh-set-row-text">
                  <div class="dsh-set-row-title">会话小票</div>
                  <div class="dsh-set-row-sub">在余额详情中提供「打印小票」入口</div>
                </div>
                <label class="dsh-set-switch"><input type="checkbox" id="dsh-set-receipt"><span class="dsh-set-switch-track"></span></label>
              </div>
            </div>
          </section>
          <section class="dsh-set-panel" data-panel="llama">
            <div class="dsh-set-panel-head">
              <div class="dsh-set-panel-title">llama 启动器</div>
              <div class="dsh-set-panel-sub" id="dsh-llama-head-sub">本地模型服务 llama-server</div>
            </div>
            <div class="dsh-set-section">
              <div class="dsh-set-row">
                <div class="dsh-set-row-text">
                  <div class="dsh-set-row-title">服务状态 <span class="dsh-llama-badge dsh-llama-badge-stopped" id="dsh-llama-badge">已停止</span></div>
                  <div class="dsh-set-row-sub" id="dsh-llama-state-detail">在软件内一键启动 llama-server，提供 OpenAI 兼容接口</div>
                </div>
                <span class="dsh-llama-actions">
                  <button class="dsh-set-btn dsh-set-btn-primary dsh-set-btn-sm" id="dsh-llama-start" type="button">启动服务</button>
                  <button class="dsh-set-btn dsh-set-btn-ghost dsh-set-btn-sm" id="dsh-llama-stop" type="button" disabled>停止</button>
                </span>
              </div>
            </div>
            <div class="dsh-set-section">
              <div class="dsh-set-row">
                <div class="dsh-set-row-text">
                  <div class="dsh-set-row-title">跟随软件启动</div>
                  <div class="dsh-set-row-sub">软件启动时自动拉起 llama-server，退出软件时自动停止</div>
                </div>
                <label class="dsh-set-switch"><input type="checkbox" id="dsh-llama-autostart"><span class="dsh-set-switch-track"></span></label>
              </div>
            </div>
            <div class="dsh-set-section">
              <div class="dsh-set-row">
                <div class="dsh-set-row-text">
                  <div class="dsh-set-row-title">llama.cpp 目录</div>
                  <div class="dsh-set-row-sub dsh-llama-mono" id="dsh-llama-dir-path">未设置</div>
                </div>
                <span class="dsh-llama-actions">
                  <button class="dsh-set-btn dsh-set-btn-ghost dsh-set-btn-sm" id="dsh-llama-browse-dir" type="button">浏览…</button>
                </span>
              </div>
            </div>
            <div class="dsh-set-section">
              <div class="dsh-set-row">
                <div class="dsh-set-row-text" style="flex: 1; min-width: 0;">
                  <div class="dsh-set-row-title dsh-llama-title-row">
                    <span>模型</span>
                    <button class="dsh-set-btn dsh-set-btn-ghost dsh-set-btn-sm dsh-llama-refresh" id="dsh-llama-model-refresh" type="button">刷新</button>
                  </div>
                  <div class="dsh-set-row-sub">主模型与视觉模型（mmproj，可选）</div>
                  <div class="dsh-llama-select-row">
                    <select class="dsh-llama-select" id="dsh-llama-model"></select>
                    <button class="dsh-set-btn dsh-set-btn-ghost dsh-set-btn-sm" id="dsh-llama-model-browse" type="button">浏览…</button>
                  </div>
                  <div class="dsh-llama-select-row">
                    <select class="dsh-llama-select" id="dsh-llama-mmproj"></select>
                    <button class="dsh-set-btn dsh-set-btn-ghost dsh-set-btn-sm" id="dsh-llama-mmproj-browse" type="button">浏览…</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="dsh-set-section">
              <div class="dsh-set-subsection" style="margin-top: 0;">
                <button class="dsh-set-subsection-head" id="dsh-llama-params-toggle" type="button" aria-expanded="false">
                  <span class="dsh-set-subsection-title">运行参数（高级）</span>
                  <svg class="dsh-tb-action-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M3 1.5 L6.5 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <div class="dsh-set-subsection-body" id="dsh-llama-params-body">
                  <div class="dsh-set-subsection-inner">${LLAMA_PARAMS_FORM_HTML}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
  document.body.appendChild(settingsDialogEl);

  settingsDialogEl.querySelector("#dsh-set-close").addEventListener("click", () => closeSettingsDialog());
  settingsDialogEl.addEventListener("pointerdown", (event) => {
    if (event.target === settingsDialogEl) closeSettingsDialog();
  });
  settingsDialogEl.querySelectorAll(".dsh-set-nav").forEach((btn) => {
    btn.addEventListener("click", () => selectSettingsPanel(btn.dataset.panel));
  });
  settingsDialogEl.querySelectorAll("#dsh-set-channel-seg .dsh-set-seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setUpdateChannel(btn.dataset.channel));
  });
  settingsDialogEl.querySelector("#dsh-set-check-update").addEventListener("click", () => {
    setUpdateFoot("正在检查更新…", "");
    api.checkUpdate(false);
  });
  settingsDialogEl.querySelector("#dsh-set-notice-install").addEventListener("click", () => {
    if (updateNoticeInfo) startInstallVersion(updateNoticeInfo.latest);
  });
  const balancePluginInput = settingsDialogEl.querySelector("#dsh-set-balance-plugin");
  balancePluginInput.addEventListener("change", () => api.saveSettings({ balancePlugin: balancePluginInput.checked }));
  const receiptInput = settingsDialogEl.querySelector("#dsh-set-receipt");
  receiptInput.addEventListener("change", () => api.saveSettings({ receiptEnabled: receiptInput.checked }));
  // 余额插件设置：白色可折叠表单（收起时保留填写项预览）；首次创建即绑定一次
  const pricingToggle = settingsDialogEl.querySelector("#dsh-set-pricing-toggle");
  const pricingBody = settingsDialogEl.querySelector("#dsh-set-pricing-body");
  pricingToggle.addEventListener("click", () => {
    const open = pricingBody.classList.contains("dsh-set-subsection-open");
    pricingBody.classList.toggle("dsh-set-subsection-open", !open);
    pricingToggle.classList.toggle("dsh-set-subsection-on", !open);
    pricingToggle.setAttribute("aria-expanded", String(!open));
    if (!open && pricingControls) pricingControls.refresh();
  });
  const pricingInner = pricingBody.querySelector(".dsh-set-subsection-inner");
  if (!pricingControls) {
    pricingControls = attachPricingForm(pricingInner);
  }
  // Llama 启动器：跟随启动开关 / 启停按钮 / 目录与模型选择 / 参数表单
  const llamaAutoInput = settingsDialogEl.querySelector("#dsh-llama-autostart");
  llamaAutoInput.addEventListener("change", () => api.llamaSave({ autoStart: llamaAutoInput.checked }));
  settingsDialogEl.querySelector("#dsh-llama-start").addEventListener("click", () => api.llamaStart());
  settingsDialogEl.querySelector("#dsh-llama-stop").addEventListener("click", () => api.llamaStop());
  settingsDialogEl.querySelector("#dsh-llama-browse-dir").addEventListener("click", async () => {
    const dir = await api.llamaBrowseDir();
    if (dir && typeof dir === "string") {
      api.llamaSave({ dir });
      setTimeout(refreshLlamaPanel, 250);
    }
  });
  const llamaModelSelect = settingsDialogEl.querySelector("#dsh-llama-model");
  llamaModelSelect.addEventListener("change", () => {
    if (llamaModelSelect.value) api.llamaSave({ modelPath: llamaModelSelect.value });
  });
  const llamaMmprojSelect = settingsDialogEl.querySelector("#dsh-llama-mmproj");
  llamaMmprojSelect.addEventListener("change", () => {
    api.llamaSave({ mmprojPath: llamaMmprojSelect.value || "" });
  });
  settingsDialogEl.querySelector("#dsh-llama-mmproj-browse").addEventListener("click", async () => {
    const file = await api.llamaBrowseModel();
    if (file && typeof file === "string") {
      api.llamaSave({ mmprojPath: file });
      setTimeout(refreshLlamaPanel, 250);
    }
  });
  settingsDialogEl.querySelector("#dsh-llama-model-refresh").addEventListener("click", () => { refreshLlamaPanel(); });
  settingsDialogEl.querySelector("#dsh-llama-model-browse").addEventListener("click", async () => {
    const file = await api.llamaBrowseModel();
    if (file && typeof file === "string") {
      api.llamaSave({ modelPath: file });
      setTimeout(refreshLlamaPanel, 250);
    }
  });
  // 运行参数（高级）：可折叠
  const llamaParamsToggle = settingsDialogEl.querySelector("#dsh-llama-params-toggle");
  const llamaParamsBody = settingsDialogEl.querySelector("#dsh-llama-params-body");
  llamaParamsToggle.addEventListener("click", () => {
    const open = llamaParamsBody.classList.contains("dsh-set-subsection-open");
    llamaParamsBody.classList.toggle("dsh-set-subsection-open", !open);
    llamaParamsToggle.classList.toggle("dsh-set-subsection-on", !open);
    llamaParamsToggle.setAttribute("aria-expanded", String(!open));
  });
  const llamaParamsStatus = (text, cls) => {
    const el = settingsDialogEl.querySelector("#dsh-llama-params-status");
    if (el) {
      el.textContent = text;
      el.className = "dsh-tb-price-status" + (cls ? " " + cls : "");
    }
  };
  settingsDialogEl.querySelector("#dsh-llama-params-save").addEventListener("click", () => {
    const num = (sel, fallback) => {
      const raw = String(settingsDialogEl.querySelector(sel).value || "").trim();
      if (raw === "") return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.floor(n) : fallback;
    };
    const patch = {
      port: num("#dsh-llama-port", 8080),
      ctxSize: num("#dsh-llama-ctx", 4096),
      gpuLayers: num("#dsh-llama-ngl", 999),
      threads: num("#dsh-llama-threads", 0),
      parallel: num("#dsh-llama-np", 1),
      apiKey: String(settingsDialogEl.querySelector("#dsh-llama-apikey").value || ""),
      extraArgs: String(settingsDialogEl.querySelector("#dsh-llama-extra").value || ""),
    };
    if (patch.port < 1 || patch.port > 65535) {
      llamaParamsStatus("端口需在 1–65535 之间", "dsh-tb-price-status-err");
      return;
    }
    api.llamaSave(patch);
    llamaParamsStatus("参数已保存（下次启动服务时生效）", "dsh-tb-price-status-ok");
  });
  settingsDialogEl.querySelector("#dsh-llama-params-reset").addEventListener("click", () => {
    api.llamaSave({ port: 8080, ctxSize: 4096, gpuLayers: 999, threads: 0, parallel: 1, apiKey: "", extraArgs: "" });
    llamaParamsStatus("已恢复默认参数", "dsh-tb-price-status-ok");
    setTimeout(refreshLlamaPanel, 250);
  });
  return settingsDialogEl;
}

function selectSettingsPanel(panel) {
  settingsPanelName = panel === "general" ? "general" : panel === "llama" ? "llama" : "versions";
  settingsDialogEl.querySelectorAll(".dsh-set-nav").forEach((btn) => {
    btn.classList.toggle("dsh-set-nav-on", btn.dataset.panel === settingsPanelName);
  });
  settingsDialogEl.querySelectorAll(".dsh-set-panel").forEach((sec) => {
    sec.classList.toggle("dsh-set-panel-on", sec.dataset.panel === settingsPanelName);
  });
  if (settingsPanelName === "versions") refreshVersionList();
  if (settingsPanelName === "llama") refreshLlamaPanel();
  syncSettingsSwitches();
}

function setUpdateChannel(channel) {
  if (channel !== "latest" && channel !== "next") return;
  appSettings.updateChannel = channel;
  api.saveSettings({ updateChannel: channel });
  syncSettingsSwitches();
  renderVersionList();
}

function openSettingsDialog() {
  const dlg = ensureSettingsDialog();
  dlg.classList.add("dsh-set-open");
  selectSettingsPanel(settingsPanelName);
  renderNoticeBanner();
  // 每次打开都重新拉取计费价格表（保持与标题栏峰谷指示一致）
  if (pricingControls) pricingControls.refresh();
  // 打开设置自动检测更新（状态显示在底部固定栏，不弹窗）
  setUpdateFoot("正在检查更新…", "");
  api.checkUpdate(false);
}

function closeSettingsDialog() {
  if (settingsDialogEl) settingsDialogEl.classList.remove("dsh-set-open");
}

function syncSettingsSwitches() {
  if (!settingsDialogEl) return;
  const balancePluginInput = settingsDialogEl.querySelector("#dsh-set-balance-plugin");
  const receiptInput = settingsDialogEl.querySelector("#dsh-set-receipt");
  if (balancePluginInput) balancePluginInput.checked = !!appSettings.balancePlugin;
  if (receiptInput) receiptInput.checked = !!appSettings.receiptEnabled;
  const seg = settingsDialogEl.querySelector("#dsh-set-channel-seg");
  const channel = appSettings.updateChannel || "latest";
  if (seg) seg.dataset.channel = channel;
  settingsDialogEl.querySelectorAll("#dsh-set-channel-seg .dsh-set-seg-btn").forEach((btn) => {
    btn.classList.toggle("dsh-set-seg-on", btn.dataset.channel === channel);
  });
  const llamaAuto = settingsDialogEl.querySelector("#dsh-llama-autostart");
  if (llamaAuto) llamaAuto.checked = !!(appSettings.llama && appSettings.llama.autoStart);
}

// ---------- Llama 启动器（面板渲染与状态联动） ----------

/** llama 面板数据缓存（来自主进程 dsh:llama-get）。 */
let llamaData = null;
/** llama-server 状态本地缓存（dsh:llama-status-changed 驱动）。 */
let llamaStatusLocal = { state: "stopped" };

const LLAMA_STATE_TEXT = {
  stopped: ["已停止", "dsh-llama-badge-stopped"],
  starting: ["启动中…", "dsh-llama-badge-starting"],
  running: ["运行中", "dsh-llama-badge-running"],
  error: ["错误", "dsh-llama-badge-error"],
};

function llamaModelLabel(model) {
  const size = model.sizeMB >= 1024 ? `${(model.sizeMB / 1024).toFixed(1)} GB` : `${model.sizeMB} MB`;
  return `${model.name}（${size}）`;
}

/** 拉取 llama 配置/模型列表/状态并渲染面板。 */
async function refreshLlamaPanel() {
  if (!settingsDialogEl) return;
  try {
    llamaData = await api.llamaGet();
  } catch {
    llamaData = null;
  }
  // 同步主进程当前状态：跟随启动等服务在启动页阶段就已就绪，
  // 状态推送事件可能早于主界面 preload 注册监听，这里以主进程状态为准回填
  if (llamaData && llamaData.status && typeof llamaData.status === "object") {
    llamaStatusLocal = llamaData.status;
  }
  renderLlamaPanel();
}

function renderLlamaPanel() {
  if (!settingsDialogEl) return;
  if (llamaData && typeof llamaData === "object") {
    const cfg = llamaData.config || {};
    const dirPath = settingsDialogEl.querySelector("#dsh-llama-dir-path");
    if (dirPath) {
      dirPath.textContent = llamaData.serverExe
        ? (cfg.dir || "未设置")
        : (cfg.dir ? `${cfg.dir}（未找到 llama-server.exe）` : "未设置");
      dirPath.style.color = llamaData.serverExe ? "" : "#e45555";
    }
    const select = settingsDialogEl.querySelector("#dsh-llama-model");
    const mmprojSelect = settingsDialogEl.querySelector("#dsh-llama-mmproj");
    if (select || mmprojSelect) {
      const models = Array.isArray(llamaData.models) ? llamaData.models : [];
      const current = typeof cfg.modelPath === "string" ? cfg.modelPath : "";
      const currentMm = typeof cfg.mmprojPath === "string" ? cfg.mmprojPath : "";
      // mmproj 文件：文件名以 mmproj 开头/包含（视觉投影）
      const isMmproj = (m) => /(^|[\\/_-]?)mmproj/i.test(m.name) || /mmproj/i.test(m.path);
      const mainModels = models.filter((m) => !isMmproj(m));
      const mmModels = models.filter((m) => isMmproj(m));
      if (select) {
        let options = mainModels.map((m) =>
          `<option value="${escHtml(m.path)}"${m.path === current ? " selected" : ""}>${escHtml(llamaModelLabel(m))}</option>`
        ).join("");
        if (mainModels.length === 0) {
          options = `<option value="">（未发现主模型，请将 .gguf 放入 models/ 或点击浏览）</option>`;
        }
        if (current && !mainModels.some((m) => m.path === current)) {
          options = `<option value="${escHtml(current)}" selected>${escHtml(current)}（自定义）</option>${options}`;
        }
        select.innerHTML = options;
      }
      if (mmprojSelect) {
        let options = `<option value="">不使用视觉模型</option>` + mmModels.map((m) =>
          `<option value="${escHtml(m.path)}"${m.path === currentMm ? " selected" : ""}>${escHtml(llamaModelLabel(m))}</option>`
        ).join("");
        if (currentMm && !mmModels.some((m) => m.path === currentMm)) {
          options = `<option value="${escHtml(currentMm)}" selected>${escHtml(currentMm)}（自定义）</option>${options}`;
        }
        mmprojSelect.innerHTML = options;
      }
    }
    const setVal = (id, value) => {
      const el = settingsDialogEl.querySelector(id);
      if (el) el.value = value === null || value === undefined ? "" : String(value);
    };
    setVal("#dsh-llama-port", cfg.port);
    setVal("#dsh-llama-ctx", cfg.ctxSize);
    setVal("#dsh-llama-ngl", cfg.gpuLayers);
    setVal("#dsh-llama-threads", cfg.threads);
    setVal("#dsh-llama-np", cfg.parallel);
    setVal("#dsh-llama-apikey", cfg.apiKey);
    setVal("#dsh-llama-extra", cfg.extraArgs);
  }
  updateLlamaStatusView();
}

/** 依据 llama-server 状态刷新徽标 / 详情 / 启停按钮。 */
function updateLlamaStatusView(status) {
  if (status && typeof status === "object") llamaStatusLocal = status;
  if (!settingsDialogEl) return;
  const st = llamaStatusLocal || {};
  const state = st.state || "stopped";
  const [badgeText, badgeCls] = LLAMA_STATE_TEXT[state] || LLAMA_STATE_TEXT.stopped;
  const badge = settingsDialogEl.querySelector("#dsh-llama-badge");
  if (badge) {
    badge.textContent = badgeText;
    badge.className = `dsh-llama-badge ${badgeCls}`;
  }
  const detail = settingsDialogEl.querySelector("#dsh-llama-state-detail");
  if (detail) {
    if (state === "running") {
      // 两行展示：先接口地址，再 OpenAI 兼容前缀；去掉内联括号
      detail.innerHTML = `接口就绪：${st.endpoint}<br>OpenAI 兼容前缀：${st.endpoint}/v1`;
    } else if (state === "starting") detail.textContent = `正在加载模型，大模型可能需要数分钟${st.lastLog ? `：${st.lastLog}` : ""}`;
    else if (state === "error") detail.textContent = st.error || "启动失败，请查看日志";
    else detail.textContent = "在软件内一键启动 llama-server，提供 OpenAI 兼容接口";
  }
  const startBtn = settingsDialogEl.querySelector("#dsh-llama-start");
  const stopBtn = settingsDialogEl.querySelector("#dsh-llama-stop");
  if (startBtn) startBtn.disabled = state === "running" || state === "starting";
  if (stopBtn) stopBtn.disabled = state === "stopped";
  const head = settingsDialogEl.querySelector("#dsh-llama-head-sub");
  if (head) head.textContent = state === "running" ? `运行中 · ${st.endpoint}` : "本地模型服务 llama-server";
}

/** 底部固定状态栏：状态文字固定不动（无布局跳动）。 */
function setUpdateFoot(text, cls = "", extra = null) {
  if (!settingsDialogEl) return;
  const statusEl = settingsDialogEl.querySelector("#dsh-set-update-status");
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = "dsh-set-version-foot-status";
  if (cls) statusEl.classList.add(cls);
  const installBtn = settingsDialogEl.querySelector("#dsh-set-notice-install");
  if (installBtn) {
    installBtn.hidden = !(cls === "dsh-set-foot-new" && extra);
  }
}

function renderNoticeBanner() {
  if (!settingsDialogEl) return;
  if (updateNoticeInfo) {
    setUpdateFoot(`发现新版本 v${updateNoticeInfo.latest}（当前 v${updateNoticeInfo.current}）`, "dsh-set-foot-new", true);
  }
}

async function refreshVersionList() {
  if (!settingsDialogEl) return;
  const list = settingsDialogEl.querySelector("#dsh-set-version-list");
  versionListData = await api.listVersions().catch(() => null);
  if (!versionListData) {
    list.innerHTML = `<div class="dsh-set-version-row" style="justify-content:center;color:var(--dsw-alias-label-tertiary,#8a8f98)">无法获取版本列表，请检查网络</div>`;
    return;
  }
  renderVersionList();
  const current = await api.getVersion().catch(() => null);
  const cur = settingsDialogEl.querySelector("#dsh-set-current-version");
  if (cur) cur.textContent = `当前版本 v${(current && current.dsh) || "—"}`;
}

function renderVersionList() {
  if (!settingsDialogEl || !versionListData) return;
  const list = settingsDialogEl.querySelector("#dsh-set-version-list");
  const channel = appSettings.updateChannel || "latest";
  const distTags = versionListData.distTags || {};
  const latestTag = distTags.latest || null;
  let versions = versionListData.versions || [];
  if (channel === "latest" && latestTag) {
    versions = versions.filter((v) => compareVersionsPreload(v, latestTag) <= 0);
  }
  if (versions.length === 0) {
    list.innerHTML = `<div class="dsh-set-version-row" style="justify-content:center;color:var(--dsw-alias-label-tertiary,#8a8f98)">该频道暂无版本</div>`;
    return;
  }
  api.getVersion().then((current) => {
    const currentVersion = current && current.dsh ? current.dsh : null;
    const highlight = channel === "latest" ? latestTag : (distTags.next || versions[0]);
    const rows = versions.map((v) => {
      const tags = [];
      if (currentVersion && v === currentVersion) tags.push('<span class="dsh-set-version-tag dsh-set-tag-current">当前</span>');
      if (highlight && v === highlight) tags.push('<span class="dsh-set-version-tag dsh-set-tag-latest">最新</span>');
      const isCurrent = currentVersion && v === currentVersion;
      const label = isCurrent ? "已安装" : "安装";
      return `<div class="dsh-set-version-row">
        <span class="dsh-set-version-name">v${escHtml(v)}</span>
        ${tags.join("")}
        <button class="dsh-set-btn dsh-set-btn-primary dsh-set-btn-sm" data-version="${escHtml(v)}" type="button" ${isCurrent ? "disabled" : ""}>${label}</button>
      </div>`;
    }).join("");
    list.innerHTML = rows;
    list.querySelectorAll("[data-version]").forEach((btn) => {
      btn.addEventListener("click", () => startInstallVersion(btn.dataset.version));
    });
  }).catch(() => {
    const rows = versions.map((v) => `<div class="dsh-set-version-row">
      <span class="dsh-set-version-name">v${escHtml(v)}</span>
      <button class="dsh-set-btn dsh-set-btn-primary dsh-set-btn-sm" data-version="${escHtml(v)}" type="button">安装</button>
    </div>`).join("");
    list.innerHTML = rows;
    list.querySelectorAll("[data-version]").forEach((btn) => {
      btn.addEventListener("click", () => startInstallVersion(btn.dataset.version));
    });
  });
}

/** 点击安装版本：主进程切换到启动页安装视图（真实进度 + 取消），完成后自动返回软件。 */
function startInstallVersion(version) {
  if (!version || installingVersion) return;
  installingVersion = version;
  api.installVersion(version);
}

/** 更新事件（新版本提示等）驱动设置弹窗底部状态栏。 */
function handleDesktopUpdateEvent(evt) {
  if (!evt || typeof evt !== "object") return;
  if (evt.type === "notice") {
    updateNoticeInfo = { current: evt.current, latest: evt.latest };
    updateSettingsDot();
    renderNoticeBanner();
    return;
  }
  if (evt.type === "no-update") {
    if (evt.detail) {
      setUpdateFoot(evt.detail, "dsh-set-foot-err");
    } else {
      setUpdateFoot(`已是最新版本（v${evt.latest || evt.current}）`, "dsh-set-foot-ok");
    }
    return;
  }
}

/** 更新状态（检查中/完成）驱动设置弹窗底部状态栏。 */
let updateStatusState = { state: "idle", current: null, latest: null };
function handleUpdateStatus(status) {
  updateStatusState = status || {};
  if (!settingsDialogEl) return;
  const state = updateStatusState.state;
  if (state === "checking") {
    setUpdateFoot(`正在检查更新…（当前 v${updateStatusState.current}）`, "");
  } else if (state === "available") {
    // 有更新时由 notice 事件驱动底部"立即更新"，这里仅提示
    setUpdateFoot(`发现新版本 v${updateStatusState.latest}`, "dsh-set-foot-new");
  }
}

/**
 * 会话小票弹窗：超市小票风格（米白纸面 + 等宽字体 + 灰色虚线分割）。
 * 由「打印小票」按钮打开，数据来自 /api/token-monitor/receipt。
 */
const RECEIPT_DIALOG_CSS = `
#dsh-receipt-dialog {
  position: fixed; inset: 0; z-index: 2147483647;
  display: none; align-items: center; justify-content: center;
  background: rgba(8, 10, 16, 0.35);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  font-family: "Courier New", ui-monospace, Consolas, "Microsoft YaHei", monospace;
}
#dsh-receipt-dialog.dsh-rcpt-open { display: flex; }
.dsh-rcpt-card {
  width: 320px; max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px); overflow-y: auto;
  background: var(--dsw-alias-bg-module-platform, #171b24);
  color: var(--dsw-alias-label-primary, #e8eaf0);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  border-radius: 6px;
  box-shadow: 0 14px 44px rgba(0,0,0,.38);
}
/* 顶部票据锯齿：模仿撕票边缘，颜色跟随主题 */
.dsh-rcpt-card:before {
  content: ""; display: block; height: 6px;
  background:
    linear-gradient(-45deg, transparent 70%, var(--dsw-alias-bg-module-platform, #171b24) 0) 0 0 / 8px 6px repeat-x,
    linear-gradient(45deg, transparent 70%, var(--dsw-alias-bg-module-platform, #171b24) 0) 4px 0 / 8px 6px repeat-x;
  border-bottom: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.28));
}
.dsh-rcpt-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px 6px;
}
.dsh-rcpt-title {
  font-size: 15px; font-weight: 700; letter-spacing: 3px;
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
.dsh-rcpt-close {
  -webkit-app-region: no-drag;
  appearance: none; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #8a8f98); width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px;
}
.dsh-rcpt-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-rcpt-body { padding: 2px 16px 14px; font-size: 12px; line-height: 1.75; color: var(--dsw-alias-label-secondary, #b4b9c2); }
.dsh-rcpt-brand {
  text-align: center; font-weight: 700; letter-spacing: 1px;
  font-size: 13px; margin-bottom: 6px;
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
.dsh-rcpt-line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-rcpt-line > span:last-child:not(.dsh-rcpt-id) { text-align: right; white-space: nowrap; }
/* 会话ID 允许换行完整显示，不截断 */
.dsh-rcpt-id {
  max-width: 64%; word-break: break-all; overflow-wrap: anywhere;
  white-space: normal; text-align: right;
}
.dsh-rcpt-sep { border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.28)); margin: 8px 0; }
.dsh-rcpt-model { font-weight: 700; margin: 4px 0 2px; color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-rcpt-model-amount { font-weight: 700; color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-rcpt-total { font-weight: 700; color: var(--dsw-alias-label-primary, #e8eaf0); }
.dsh-rcpt-thanks {
  text-align: center; margin-top: 10px;
  font-size: 13px; font-weight: 700; letter-spacing: 6px;
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
.dsh-rcpt-loading { text-align: center; color: var(--dsw-alias-label-tertiary, #8a8f98); padding: 14px 0; }
/* 新会话空态：暂无小票记录 */
.dsh-rcpt-empty { text-align: center; padding: 28px 10px 24px; }
.dsh-rcpt-empty-icon {
  display: flex; justify-content: center; margin-bottom: 12px;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
}
.dsh-rcpt-empty-title {
  font-size: 14px; font-weight: 700; letter-spacing: 4px;
  color: var(--dsw-alias-label-primary, #e8eaf0);
}
.dsh-rcpt-empty-sub {
  margin-top: 10px; font-size: 11.5px; line-height: 1.9;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  letter-spacing: .5px;
}
.dsh-rcpt-empty-sep {
  margin-top: 16px; font-size: 11px; letter-spacing: 3px;
  color: var(--dsw-alias-border-l2, rgba(128,128,128,.32));
}
.dsh-rcpt-actions {
  display: flex; justify-content: center; gap: 8px;
  padding: 0 16px 12px;
}
.dsh-rcpt-btn {
  -webkit-app-region: no-drag;
  appearance: none; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); cursor: pointer;
  height: 28px; padding: 0 18px; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary, #b4b9c2);
  font: 600 12px/1 "Courier New", ui-monospace, Consolas, "Microsoft YaHei", monospace;
}
.dsh-rcpt-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.07)); color: var(--dsw-alias-label-primary, #e8eaf0); }
`;


// ---------- 会话小票弹窗 ----------

/** 整数千分位格式化。 */
function fmtReceiptInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}
/** 小票金额：小金额保留 4 位小数。 */
function fmtReceiptCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return Math.abs(n) < 0.01 ? `¥${n.toFixed(4)}` : `¥${n.toFixed(2)}`;
}
/** 小票百分比：保留 1 位小数。 */
function fmtReceiptPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "0.0%";
}
/** 时长（毫秒）→ 人读文本。 */
function fmtReceiptDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  const totalSeconds = Math.max(0, Math.round(n / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function ensureReceiptDialog() {
  let dlg = document.getElementById("dsh-receipt-dialog");
  if (dlg) return dlg;
  const style = document.createElement("style");
  style.id = "dsh-receipt-dialog-style";
  style.textContent = RECEIPT_DIALOG_CSS;
  document.head.appendChild(style);
  dlg = document.createElement("div");
  dlg.id = "dsh-receipt-dialog";
  dlg.innerHTML = `
    <div class="dsh-rcpt-card">
      <div class="dsh-rcpt-head">
        <div class="dsh-rcpt-title">会话小票</div>
        <button class="dsh-rcpt-close" id="dsh-rcpt-close" title="关闭" type="button">✕</button>
      </div>
      <div class="dsh-rcpt-body" id="dsh-rcpt-body"></div>
      <div class="dsh-rcpt-actions">
        <button class="dsh-rcpt-btn" id="dsh-rcpt-close-btn" type="button">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  const close = () => dlg.classList.remove("dsh-rcpt-open");
  dlg.querySelector("#dsh-rcpt-close").addEventListener("click", close);
  dlg.querySelector("#dsh-rcpt-close-btn").addEventListener("click", close);
  dlg.addEventListener("pointerdown", (event) => {
    if (event.target === dlg) close();
  });
  return dlg;
}

function renderReceipt(data) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const issued = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short", timeStyle: "medium", hour12: false,
  }).format(new Date(data.issuedAt));
  const lines = [];
  lines.push('<div class="dsh-rcpt-brand">DeepSeek小票清单</div>');
  lines.push('<div class="dsh-rcpt-line"><span>会话ID</span><span class="dsh-rcpt-id" title="' + esc(data.sessionId) + '">' + esc(data.sessionId) + "</span></div>");
  lines.push(`<div class="dsh-rcpt-line"><span>出票时间</span><span>${esc(issued)}</span></div>`);
  lines.push('<div class="dsh-rcpt-sep"></div>');
  for (const model of data.models || []) {
    lines.push(`<div class="dsh-rcpt-model">${esc(model.model)}</div>`);
    lines.push(`<div class="dsh-rcpt-line"><span>调用次数</span><span>${fmtReceiptInt(model.calls)}</span></div>`);
    lines.push(`<div class="dsh-rcpt-line"><span>输入 Token</span><span>${fmtReceiptInt(model.inputTokens)}</span></div>`);
    lines.push(`<div class="dsh-rcpt-line"><span>输出 Token</span><span>${fmtReceiptInt(model.outputTokens)}</span></div>`);
    lines.push(`<div class="dsh-rcpt-line"><span>缓存 Token</span><span>${fmtReceiptInt((model.cacheReadTokens || 0) + (model.cacheWriteTokens || 0))}</span></div>`);
    lines.push(`<div class="dsh-rcpt-line"><span>推理 Token</span><span>${fmtReceiptInt(model.reasoningTokens)}</span></div>`);
    lines.push(`<div class="dsh-rcpt-line dsh-rcpt-model-amount"><span>金额</span><span>${fmtReceiptCost(model.cost)}</span></div>`);
  }
  lines.push('<div class="dsh-rcpt-sep"></div>');
  lines.push(`<div class="dsh-rcpt-line dsh-rcpt-total"><span>合计调用次数</span><span>${fmtReceiptInt(data.totals && data.totals.calls)}</span></div>`);
  lines.push(`<div class="dsh-rcpt-line dsh-rcpt-total"><span>合计 Token</span><span>${fmtReceiptInt(data.totals && data.totals.tokens)}</span></div>`);
  lines.push(`<div class="dsh-rcpt-line"><span>模型耗时</span><span>${fmtReceiptDuration(data.llmMs)}</span></div>`);
  lines.push(`<div class="dsh-rcpt-line"><span>会话跨度</span><span>${fmtReceiptDuration(data.spanMs)}</span></div>`);
  lines.push(`<div class="dsh-rcpt-line"><span>缓存命中</span><span>${fmtReceiptPercent(data.totals && data.totals.cacheHitRate)} · ${fmtReceiptCost(data.totals && data.totals.cacheHitCost)}</span></div>`);
  lines.push('<div class="dsh-rcpt-sep"></div>');
  lines.push(`<div class="dsh-rcpt-line dsh-rcpt-total"><span>合计金额</span><span>${fmtReceiptCost(data.totals && data.totals.cost)}</span></div>`);
  lines.push(`<div class="dsh-rcpt-line"><span>其中高峰时段费用</span><span>${fmtReceiptCost(data.totals && data.totals.peakCost)}</span></div>`);
  lines.push('<div class="dsh-rcpt-sep"></div>');
  lines.push('<div class="dsh-rcpt-thanks">-谢谢惠顾-</div>');
  return lines.join("");
}

/** 新会话空态：暂无小票记录（纸面小票风格）。 */
const RCPT_EMPTY_HTML = `
  <div class="dsh-rcpt-empty">
    <div class="dsh-rcpt-empty-icon">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>
      </svg>
    </div>
    <div class="dsh-rcpt-empty-title">暂无小票记录</div>
    <div class="dsh-rcpt-empty-sub">当前会话还没有产生对话记录<br/>发送第一条消息后，即可在此打印小票</div>
    <div class="dsh-rcpt-empty-sep">- - - - - - - - - - - - - - -</div>
  </div>`;

function openReceipt() {
  const dlg = ensureReceiptDialog();
  const body = dlg.querySelector("#dsh-rcpt-body");
  body.innerHTML = '<div class="dsh-rcpt-loading">小票生成中…</div>';
  dlg.classList.add("dsh-rcpt-open");
  // 优先打印当前正在查看的会话（由客户端插件写入 DOM）；无则交给服务端自动定位
  const activeSession = document.body.dataset.dshActiveSession || "";
  const url = activeSession !== ""
    ? `/api/token-monitor/receipt?sessionId=${encodeURIComponent(activeSession)}`
    : "/api/token-monitor/receipt";
  fetch(url, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      // 新会话（还没有任何对话记录）：展示空态，不打印空白小票
      const models = Array.isArray(data && data.models) ? data.models : [];
      const totals = (data && data.totals) || {};
      const hasRecords = models.length > 0
        || Number(totals.calls) > 0
        || Number(totals.tokens) > 0
        || Number(totals.cost) > 0;
      body.innerHTML = hasRecords ? renderReceipt(data) : RCPT_EMPTY_HTML;
    })
    .catch((error) => {
      const message = String(error && error.message ? error.message : error);
      body.innerHTML = message === "HTTP 404" ? RCPT_EMPTY_HTML : `<div class="dsh-rcpt-loading">小票生成失败：${message}</div>`;
    });
}

// ---------- 启动画面（Boot Splash） ----------

const SPLASH_LOGO_SVG = `<svg width="182" height="29" viewBox="0 0 182 29" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100.136 23.7767H98.1371V20.6775H100.136C101.374 20.6775 102.625 20.3688 103.431 19.5112C104.237 18.6535 104.542 17.3378 104.542 16.0229C104.542 14.708 104.25 13.3923 103.431 12.5354C102.613 11.6777 101.374 11.3691 100.136 11.3691C98.8981 11.3691 97.6471 11.6777 96.84 12.5354C96.0335 13.393 95.7291 14.708 95.7291 16.0229V28.7513H92.2224V8.28192H95.7291V9.58548H96.372C96.4417 9.50512 96.5114 9.43685 96.5818 9.36858C97.4594 8.56781 98.8028 8.28192 100.123 8.28192C102.193 8.28192 104.261 8.7968 105.617 10.2262C106.973 11.6557 107.452 13.851 107.452 16.0357C107.452 18.2204 106.961 20.4044 105.617 21.8452C104.273 23.286 102.193 23.7781 100.136 23.7781V23.7767Z" fill="currentColor"></path><path d="M46.7705 8.83322H48.7689V11.9325H46.7705C45.5317 11.9325 44.2815 12.2411 43.475 13.0988C42.6685 13.9564 42.3649 15.2721 42.3649 16.587C42.3649 17.9019 42.6572 19.2169 43.475 20.0745C44.2928 20.9322 45.5317 21.2408 46.7705 21.2408C48.0094 21.2408 49.2603 20.9322 50.0668 20.0745C50.8732 19.2169 51.1769 17.9019 51.1769 16.587V3.84727H54.6829V24.3287H51.1769V23.0252H50.534C50.4636 23.1048 50.3939 23.1738 50.3235 23.2421C49.4466 24.0421 48.1025 24.3287 46.7819 24.3287C44.7131 24.3287 42.6444 23.8145 41.2889 22.3851C39.9334 20.9557 39.4541 18.7596 39.4541 16.5756C39.4541 14.3917 39.9448 12.207 41.2889 10.7662C42.6444 9.33672 44.7131 8.83322 46.7705 8.83322Z" fill="currentColor"></path><path d="M72.2712 16.3098V17.5565H62.9329V15.0753H69.1271C68.987 14.1721 68.6599 13.3258 68.0753 12.7078C67.234 11.816 65.9362 11.496 64.6511 11.496C63.366 11.496 62.0682 11.816 61.2269 12.7078C60.3856 13.5996 60.0812 14.9608 60.0812 16.3106C60.0812 17.6603 60.3848 19.0322 61.2269 19.9126C62.0682 20.793 63.3653 21.1251 64.6511 21.1251C65.9369 21.1251 67.234 20.8051 68.0753 19.9126C68.192 19.7867 68.2972 19.6495 68.4025 19.5122H71.8623C71.5586 20.5875 71.0793 21.5596 70.3546 22.3142C68.9522 23.7891 66.7903 24.3268 64.6511 24.3268C62.5119 24.3268 60.35 23.8005 58.9476 22.3142C57.5452 20.8279 57.031 18.5635 57.031 16.3106C57.031 14.0576 57.5338 11.7819 58.9476 10.3069C60.3621 8.83199 62.5119 8.29435 64.6511 8.29435C66.7903 8.29435 68.9522 8.82061 70.3546 10.3069C71.7684 11.7933 72.2712 14.0576 72.2712 16.3106V16.3098Z" fill="currentColor"></path><path d="M89.8732 16.3098V17.5565H80.535V15.0753H86.7292C86.5884 14.1721 86.262 13.3258 85.6774 12.7078C84.8361 11.816 83.5382 11.496 82.2532 11.496C80.9681 11.496 79.6702 11.816 78.8289 12.7078C77.9876 13.5996 77.6832 14.9608 77.6832 16.3106C77.6832 17.6603 77.9869 19.0322 78.8289 19.9126C79.6702 20.793 80.9681 21.1251 82.2532 21.1251C83.5382 21.1251 84.8361 20.8051 85.6774 19.9126C85.7947 19.7867 85.8993 19.6495 86.0038 19.5122H89.4643C89.16 20.5875 88.6806 21.5596 87.956 22.3142C86.5535 23.7891 84.3916 24.3268 82.2532 24.3268C80.1147 24.3268 77.9521 23.8005 76.5496 22.3142C75.1472 20.8279 74.6331 18.5635 74.6331 16.3106C74.6331 14.0576 75.1359 11.7819 76.5496 10.3069C77.9641 8.83199 80.114 8.29435 82.2532 8.29435C84.3923 8.29435 86.5535 8.82061 87.956 10.3069C89.3705 11.7933 89.8732 14.0576 89.8732 16.3106V16.3098Z" fill="currentColor"></path><path d="M117.446 24.3282C119.585 24.3282 121.746 24.0195 123.148 23.1391C124.551 22.2587 125.066 20.9203 125.066 19.594C125.066 18.2677 124.562 16.9179 123.148 16.0489C121.746 15.1798 119.584 14.8591 117.446 14.8591C116.533 14.8591 115.692 14.7332 115.096 14.4018C114.5 14.0583 114.278 13.5441 114.278 13.0293C114.278 12.5144 114.489 11.9888 115.096 11.6567C115.692 11.3132 116.616 11.1994 117.527 11.1994C118.438 11.1994 119.362 11.3253 119.959 11.6567C120.555 12.0002 120.777 12.5144 120.777 13.0293H124.341C124.341 11.7022 123.886 10.3532 122.612 9.48412C121.339 8.61508 119.386 8.29435 117.446 8.29435C115.506 8.29435 113.555 8.60299 112.28 9.48412C111.007 10.3645 110.55 11.7022 110.55 13.0293C110.55 14.3563 111.006 15.7054 112.28 16.5744C113.554 17.4434 115.506 17.7642 117.446 17.7642C118.451 17.7642 119.562 17.89 120.228 18.2214C120.895 18.5536 121.128 19.0791 121.128 19.594C121.128 20.1089 120.895 20.6344 120.228 20.9665C119.562 21.2979 118.545 21.4238 117.54 21.4238C116.535 21.4238 115.506 21.2979 114.851 20.9665C114.197 20.6351 113.951 20.1089 113.951 19.594H109.837C109.837 20.921 110.339 22.2701 111.754 23.1391C113.168 24.0082 115.307 24.3282 117.446 24.3282H117.446Z" fill="currentColor"></path><path d="M142.666 16.3098V17.5565H133.327V15.0753H139.522C139.382 14.1721 139.054 13.3258 138.471 12.7078C137.628 11.816 136.331 11.496 135.045 11.496C133.758 11.496 132.462 11.816 131.621 12.7078C130.779 13.5996 130.476 14.9608 130.476 16.3106C130.476 17.6603 130.779 19.0322 131.621 19.9126C132.462 20.793 133.76 21.1251 135.045 21.1251C136.33 21.1251 137.628 20.8051 138.471 19.9126C138.587 19.7867 138.692 19.6495 138.797 19.5122H142.256C141.952 20.5875 141.473 21.5596 140.749 22.3142C139.347 23.7891 137.184 24.3268 135.045 24.3268C132.906 24.3268 130.745 23.8005 129.342 22.3142C127.94 20.8279 127.426 18.5635 127.426 16.3106C127.426 14.0576 127.928 11.7819 129.342 10.3069C130.757 8.83199 132.907 8.29435 135.045 8.29435C137.183 8.29435 139.347 8.82061 140.749 10.3069C142.163 11.7933 142.665 14.0576 142.665 16.3106L142.666 16.3098Z" fill="currentColor"></path><path d="M160.266 16.3098V17.5565H150.928V15.0753H157.122C156.983 14.1721 156.655 13.3258 156.07 12.7078C155.229 11.816 153.932 11.496 152.646 11.496C151.359 11.496 150.063 11.816 149.222 12.7078C148.38 13.5996 148.076 14.9608 148.076 16.3106C148.076 17.6603 148.38 19.0322 149.222 19.9126C150.063 20.793 151.361 21.1251 152.646 21.1251C153.931 21.1251 155.229 20.8051 156.07 19.9126C156.188 19.7867 156.292 19.6495 156.398 19.5122H159.857C159.553 20.5875 159.074 21.5596 158.35 22.3142C156.947 23.7891 154.785 24.3268 152.646 24.3268C150.507 24.3268 148.346 23.8005 146.943 22.3142C145.541 20.8279 145.026 18.5635 145.026 16.3106C145.026 14.0576 145.528 11.7819 146.943 10.3069C148.357 8.83199 150.508 8.29435 152.646 8.29435C154.784 8.29435 156.946 8.82061 158.35 10.3069C159.764 11.7933 160.266 14.0576 160.266 16.3106V16.3098Z" fill="currentColor"></path><path d="M166.121 3.84727H162.615V24.3287H166.121V3.84727Z" fill="currentColor"></path><path d="M172.106 15.83L177.855 24.3269H173.519L167.768 15.83L173.519 9.00281H177.855L172.106 15.83Z" fill="currentColor"></path><g clip-path="url(#clip0_10227_148760)"><path d="M33.7472 4.32057C33.3878 4.14492 33.2334 4.48011 33.0234 4.64989C32.9516 4.70478 32.8909 4.7765 32.8302 4.84237C32.3054 5.40296 31.6921 5.77107 30.8915 5.72716C29.7206 5.6613 28.7209 6.02941 27.8368 6.92518C27.6487 5.82084 27.0245 5.16145 26.0745 4.73845C25.5776 4.51889 25.0748 4.29861 24.7265 3.82072C24.4835 3.48041 24.4169 3.10132 24.2954 2.72735C24.2179 2.50194 24.141 2.27141 23.8812 2.23263C23.5995 2.18872 23.489 2.4251 23.3784 2.6227C22.9364 3.43065 22.7652 4.32057 22.782 5.22219C22.8208 7.25012 23.677 8.86529 25.3786 10.0143C25.5718 10.146 25.6215 10.2777 25.5608 10.4702C25.4444 10.8661 25.3068 11.2504 25.1854 11.6463C25.1078 11.8988 24.9921 11.9544 24.7214 11.8439C23.7875 11.4538 22.9811 10.8764 22.2682 10.1789C21.0585 9.00873 19.9644 7.71704 18.6003 6.70563C18.2797 6.46925 17.9592 6.2497 17.6276 6.04039C16.2357 4.68868 17.8099 3.57848 18.1743 3.44675C18.5556 3.30916 18.3068 2.83639 17.0751 2.84225C15.8434 2.84737 14.7164 3.26013 13.2798 3.80974C13.0697 3.89244 12.8487 3.95245 12.6226 4.00222C11.3192 3.75485 9.96528 3.69997 8.55136 3.85951C5.88893 4.1559 3.7622 5.41467 2.19899 7.56335C0.321085 10.146 -0.120946 13.0807 0.419884 16.1412C0.988524 19.3672 2.63516 22.0377 5.16514 24.1256C7.78878 26.2904 10.8106 27.3516 14.2582 27.1481C16.352 27.0274 18.683 26.7471 21.3125 24.5215C21.9755 24.8516 22.6715 24.9833 23.8256 25.0821C24.7148 25.1648 25.571 25.0382 26.2341 24.9006C27.2726 24.6811 27.2008 23.7195 26.8254 23.5431C23.7817 22.1255 24.4499 22.7022 23.8424 22.2353C25.3888 20.4057 27.7512 17.1534 28.4801 12.725C28.5518 12.2361 28.6433 11.5475 28.6323 11.1516C28.6265 10.9101 28.6821 10.8164 28.958 10.7886C29.7206 10.7007 30.4605 10.4922 31.1403 10.1182C33.1126 9.04094 33.9082 7.27135 34.0955 5.15047C34.1233 4.82627 34.0897 4.49109 33.7472 4.32057ZM16.5613 23.4113C13.6113 21.0921 12.1806 20.3288 11.59 20.3618C11.0374 20.3947 11.137 21.027 11.2584 21.439C11.3858 21.8459 11.5512 22.1262 11.7832 22.4834C11.9434 22.7198 12.0539 23.071 11.6229 23.3352C10.673 23.9229 9.0212 23.1376 8.94363 23.0989C7.02108 21.9667 5.41396 20.4723 4.28107 18.4282C3.18697 16.4611 2.55173 14.3504 2.44708 12.0978C2.41927 11.5541 2.57954 11.3616 3.12111 11.2628C3.83392 11.1311 4.56869 11.1033 5.28077 11.2079C8.29156 11.6477 10.8545 12.9936 13.0031 15.1262C14.2297 16.3403 15.1577 17.7915 16.1135 19.2091C17.13 20.7145 18.2234 22.1489 19.6161 23.325C20.1078 23.737 20.5001 24.0502 20.8755 24.2815C19.7434 24.4081 17.8538 24.4352 16.5613 23.4128V23.4113ZM17.9753 14.3168C17.9753 14.0753 18.1685 13.8828 18.4114 13.8828C18.4663 13.8828 18.5161 13.8938 18.5607 13.9099C18.6215 13.9318 18.6771 13.9648 18.721 14.0145C18.7986 14.0914 18.8425 14.2011 18.8425 14.3168C18.8425 14.5583 18.6493 14.7508 18.4063 14.7508C18.1633 14.7508 17.9753 14.5583 17.9753 14.3168ZM22.367 16.5694C22.0853 16.685 21.8035 16.7838 21.5327 16.7948C21.1127 16.8167 20.6545 16.6462 20.4057 16.4376C20.0193 16.1134 19.7427 15.9319 19.627 15.3662C19.5773 15.1247 19.6051 14.7508 19.649 14.5363C19.7485 14.0745 19.638 13.7781 19.3123 13.5088C19.0474 13.2893 18.71 13.2285 18.3397 13.2285C18.2014 13.2285 18.0748 13.1678 17.9804 13.1187C17.826 13.0419 17.6986 12.8494 17.8201 12.613C17.8589 12.5362 18.047 12.3496 18.0909 12.3167C18.5937 12.0305 19.1733 12.1242 19.7097 12.3386C20.2066 12.5421 20.5828 12.9153 21.1236 13.443C21.6762 14.0804 21.7757 14.256 22.0904 14.7347C22.3392 15.1086 22.5654 15.4928 22.7205 15.9327C22.8142 16.2071 22.6927 16.4318 22.367 16.5694Z" fill="currentColor"></path></g><defs><clipPath id="clip0_10227_148760"><rect width="33.8978" height="24.9455" fill="white" transform="translate(0.206299 2.22727)"></rect></clipPath></defs></svg>`;

const SPLASH_CSS = `/* ===== 启动向导 UI：跟随 DeepSeek Harness 主题（深/浅），含切换动画 ===== */
:root {
  --sp-brand: #4d6bfe;
  --sp-brand-2: #6f8bff;
  --sp-bg-1: #222633;
  --sp-bg-2: #0f1219;
  --sp-text-1: #f4f6fa;
  --sp-text-2: #a9b1c2;
  --sp-text-3: #7d8599;
  --sp-border: rgba(255, 255, 255, .10);
  --sp-border-strong: rgba(255, 255, 255, .16);
  --sp-surface: rgba(255, 255, 255, .055);
  --sp-surface-strong: rgba(255, 255, 255, .10);
  --sp-hover: rgba(255, 255, 255, .09);
  --sp-track: rgba(255, 255, 255, .10);
  --sp-success: #34c56b;
  --sp-success-soft: rgba(52, 197, 107, .14);
  --sp-danger: #f0625f;
  --sp-danger-soft: rgba(240, 98, 95, .14);
  --sp-shadow: rgba(0, 0, 0, .30);
  --sp-log-bg: rgba(0, 0, 0, .24);
  --sp-code: #c8cfdd;
}
html.dsh-splash-theme-light {
  --sp-brand: #4d6bfe;
  --sp-brand-2: #6f8bff;
  --sp-bg-1: #ffffff;
  --sp-bg-2: #e7ecf5;
  --sp-text-1: #181c26;
  --sp-text-2: #434c5e;
  --sp-text-3: #7a8399;
  --sp-border: rgba(23, 27, 40, .12);
  --sp-border-strong: rgba(23, 27, 40, .20);
  --sp-surface: rgba(255, 255, 255, .72);
  --sp-surface-strong: rgba(255, 255, 255, .94);
  --sp-hover: rgba(23, 27, 40, .08);
  --sp-track: rgba(23, 27, 40, .10);
  --sp-success: #1f9d57;
  --sp-success-soft: rgba(31, 157, 87, .12);
  --sp-danger: #dd4744;
  --sp-danger-soft: rgba(221, 71, 68, .12);
  --sp-shadow: rgba(26, 35, 60, .16);
  --sp-log-bg: rgba(255, 255, 255, .62);
  --sp-code: #3d4557;
}
#dsh-splash {
  --sp-text-1: #f7faff;
  --sp-text-2: rgba(235, 243, 255, .76);
  --sp-text-3: rgba(221, 234, 252, .58);
  --sp-border: rgba(225, 239, 255, .15);
  --sp-border-strong: rgba(225, 239, 255, .25);
  --sp-surface: rgba(227, 240, 255, .075);
  --sp-surface-strong: rgba(227, 240, 255, .13);
  --sp-hover: rgba(227, 240, 255, .12);
  --sp-track: rgba(225, 239, 255, .18);
  --sp-log-bg: rgba(2, 15, 34, .38);
  --sp-code: #d5e3f8;
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  isolation: isolate;
  background: #000;
  -webkit-app-region: drag;
  user-select: none;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  color: #f7faff;
  animation: dsh-splash-fade-in .18s ease-out both;
}
#dsh-splash-logo { color: #fff; }
html.dsh-splash-theme-light #dsh-splash-logo { color: #fff; }
#dsh-splash-web-bg {
  position: absolute; inset: 0; z-index: 0;
  width: 100%; height: 100%; border: 0;
  pointer-events: none;
  opacity: 0;
  background: #000;
  transition: opacity .18s ease-out;
}
#dsh-splash-web-bg.dsh-splash-web-bg-ready { opacity: .96; }
#dsh-splash::before, #dsh-splash::after,
#dsh-splash .dsh-splash-aurora { display: none !important; }
#dsh-splash::before {
  content: "";
  position: absolute; inset: 0; z-index: -1;
  opacity: .42;
  background-image:
    linear-gradient(rgba(210, 230, 255, .085) 1px, transparent 1px),
    linear-gradient(90deg, rgba(210, 230, 255, .07) 1px, transparent 1px);
  background-size: 88px 88px;
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,.84), rgba(0,0,0,.36) 58%, transparent 100%);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,.84), rgba(0,0,0,.36) 58%, transparent 100%);
}
#dsh-splash::after {
  content: "";
  position: absolute; inset: 0; z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    rgba(2, 8, 18, 0) 37%,
    rgba(2, 8, 18, .10) 48%,
    rgba(1, 5, 12, .46) 65%,
    rgba(0, 2, 6, .84) 83%,
    #000 100%
  );
}
.dsh-splash-aurora {
  position: absolute; inset: 0; z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.dsh-splash-aurora svg {
  position: absolute;
  width: 1250px; height: 760px;
  left: 50%; top: -314px;
  transform: translateX(-50%);
  overflow: visible;
  filter: blur(13px);
  opacity: .72;
}
.dsh-splash-aurora path {
  fill: none;
  stroke: rgba(235, 244, 255, .68);
  stroke-linecap: round;
}
.dsh-splash-aurora .dsh-splash-aurora-fade { opacity: .31; filter: blur(14px); }
#dsh-splash-inner { position: relative; z-index: 2; }
html.dsh-splash-theme-light #dsh-splash { background: #000; }
@keyframes dsh-splash-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
#dsh-splash-inner {
  width: min(680px, calc(100vw - 56px));
  display: flex; flex-direction: column; align-items: center; gap: 22px;
}
/* JS 通过 hidden 属性控制显示，防止 display:flex 覆盖 */
#dsh-splash [hidden] { display: none !important; }
#dsh-splash-logo {
  color: var(--sp-brand);
  display: block;
  filter: drop-shadow(0 10px 24px rgba(77, 107, 254, .28));
  animation: dsh-splash-logo-in .55s cubic-bezier(.2, .9, .25, 1) both;
}
#dsh-splash-logo svg { display: block; }
#dsh-splash-logo svg { width: 182px; height: 24px; }
@keyframes dsh-splash-logo-in {
  from { opacity: 0; transform: translateY(-8px) scale(.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
#dsh-splash-status { display: none; }

/* 页面滑轨：切换动画 */
#dsh-splash-stage {
  width: 100%;
  overflow: hidden;
  -webkit-app-region: no-drag;
}
#dsh-splash-track {
  display: flex;
  width: 400%;
  will-change: transform;
  backface-visibility: hidden;
  transform: translateX(0%);
  transition: transform .6s cubic-bezier(.22, .9, .26, 1);
}
.dsh-splash-page {
  box-sizing: border-box;
  width: 25%;
  flex: 0 0 25%;
  min-height: 360px;
  padding: 26px 34px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dsh-splash-page-head { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.dsh-splash-page-title {
  position: relative;
  width: 100%;
  text-align: center;
  font-size: 21px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: .2px;
  color: var(--sp-text-1);
}
.dsh-splash-page-sub {
  font-size: 12px;
  line-height: 1.7;
  color: var(--sp-text-3);
  text-align: center;
}
/* 检测步骤 */
.dsh-splash-step-list {
  width: max-content;
  max-width: 100%;
  margin: 22px auto 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.dsh-splash-step { display: flex; align-items: center; gap: 14px; }
.dsh-splash-step-icon {
  flex: none;
  width: 22px; height: 22px;
  border-radius: 50%;
  position: relative;
  margin-top: 0;
  border: 1px solid var(--sp-border-strong);
  background: transparent;
  transition: border-color .22s ease, background-color .22s ease, box-shadow .22s ease;
}
.dsh-splash-step-icon::before,
.dsh-splash-step-icon::after {
  content: "";
  position: absolute;
  opacity: 0;
  transition: opacity .2s ease, transform .2s ease, background-color .2s ease;
}
.dsh-splash-step-icon.loading::before {
  inset: 2px;
  opacity: 1;
  border-radius: 50%;
  border: 2px solid rgba(125, 147, 255, .25);
  border-top-color: var(--sp-brand);
  animation: dsh-splash-spin .8s linear infinite;
}
.dsh-splash-step-icon.success {
  background: var(--sp-success);
  border-color: var(--sp-success);
  box-shadow: 0 0 0 4px var(--sp-success-soft);
  animation: dsh-splash-icon-pop .36s cubic-bezier(.2, .86, .3, 1.2) both;
}
.dsh-splash-step-icon.success::before {
  left: 5px; top: 9px;
  width: 5px; height: 2px;
  opacity: 1;
  transform: rotate(45deg);
  background: #fff;
  border-radius: 1px;
}
.dsh-splash-step-icon.success::after {
  left: 8px; top: 6px;
  width: 9px; height: 2px;
  opacity: 1;
  transform: rotate(-45deg);
  background: #fff;
  border-radius: 1px;
}
.dsh-splash-step-icon.fail {
  background: var(--sp-danger);
  border-color: var(--sp-danger);
  box-shadow: 0 0 0 4px var(--sp-danger-soft);
  animation: dsh-splash-icon-pop .36s cubic-bezier(.2, .86, .3, 1.2) both;
}
.dsh-splash-step-icon.fail::before,
.dsh-splash-step-icon.fail::after {
  left: 4px; top: 9px;
  width: 12px; height: 2px;
  opacity: 1;
  background: #fff;
  border-radius: 1px;
}
.dsh-splash-step-icon.fail::before { transform: rotate(45deg); }
.dsh-splash-step-icon.fail::after { transform: rotate(-45deg); }
@keyframes dsh-splash-icon-pop {
  0% { transform: scale(.35); }
  62% { transform: scale(1.22); }
  100% { transform: scale(1); }
}
@keyframes dsh-splash-spin { to { transform: rotate(360deg); } }
.dsh-splash-step-body { min-width: 0; flex: none; }
.dsh-splash-step-title {
  font-size: 14.5px;
  line-height: 20px;
  font-weight: 550;
  color: var(--sp-text-1);
}
.dsh-splash-step-detail {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--sp-text-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 底部操作 */
.dsh-splash-action-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: auto;
  padding-top: 26px;
}
.dsh-splash-next-btn {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  background: linear-gradient(135deg, var(--sp-brand), var(--sp-brand-2));
  color: #fff;
  box-shadow: 0 14px 28px rgba(77, 107, 254, .32);
  transition: transform .16s ease, box-shadow .2s ease, filter .2s ease;
}
.dsh-splash-next-btn:hover { transform: translateY(-2px); box-shadow: 0 18px 34px rgba(77, 107, 254, .40); filter: brightness(1.06); }
.dsh-splash-next-btn:active { transform: translateY(0) scale(.96); }
.dsh-splash-next-btn[hidden] { display: none; }
.dsh-splash-next-btn svg { display: block; width: 22px; height: 22px; }
.dsh-splash-next-dark { background: linear-gradient(135deg, var(--sp-brand), var(--sp-brand-2)); color: #fff; }
.dsh-splash-next-light { background: linear-gradient(135deg, var(--sp-brand), var(--sp-brand-2)); color: #fff; }
.dsh-splash-next-label {
  font-size: 11px;
  color: var(--sp-text-3);
  text-align: center;
  min-height: 16px;
}
/* 按钮 */
.dsh-splash-confirm-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}
.dsh-splash-btn {
  appearance: none;
  border: none;
  cursor: pointer;
  height: 40px;
  min-width: 104px;
  border-radius: 20px;
  padding: 0 24px;
  font: 600 13.5px/1 inherit;
  transition: transform .1s ease, filter .15s ease, background-color .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.dsh-splash-btn:hover { filter: brightness(1.06); }
.dsh-splash-btn:active { transform: scale(.97); }
.dsh-splash-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
  filter: saturate(.6);
}
.dsh-splash-btn-primary {
  background: linear-gradient(90deg, var(--sp-brand), var(--sp-brand-2));
  color: #fff;
  box-shadow: 0 10px 22px rgba(77, 107, 254, .30);
}
.dsh-splash-btn-secondary {
  background: var(--sp-surface);
  color: var(--sp-text-1);
  border: 1px solid var(--sp-border-strong);
}
.dsh-splash-btn-secondary:hover { background: var(--sp-hover); }
/* 安装位置 */
.dsh-splash-path-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
  padding: 6px;
  border-radius: 14px;
  background: var(--sp-surface);
  border: 1px solid var(--sp-border);
  transition: border-color .18s ease, background-color .18s ease;
}
.dsh-splash-path-row:focus-within {
  border-color: var(--sp-brand);
  box-shadow: 0 0 0 3px rgba(77, 107, 254, .16);
}
.dsh-splash-path-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border: none;
  outline: none;
  border-radius: 10px;
  background: var(--sp-surface-strong);
  color: var(--sp-text-1);
  font-size: 11.5px;
  font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-splash-path-input:disabled { opacity: .8; }
.dsh-splash-path-browse {
  appearance: none;
  border: 1px solid var(--sp-border);
  cursor: pointer;
  flex: none;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  background: transparent;
  color: var(--sp-text-2);
  font: 500 11.5px/1 inherit;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}
.dsh-splash-path-browse:hover { background: var(--sp-hover); color: var(--sp-text-1); border-color: var(--sp-border-strong); }
.dsh-splash-install-button {
  width: auto;
  min-width: 136px;
  align-self: center;
  margin-top: 22px;
}
.dsh-splash-global-pill {
  align-self: center;
  margin-top: 30px;
  padding: 10px 22px;
  border-radius: 999px;
  background: var(--sp-surface-strong);
  color: var(--sp-text-1);
  border: 1px solid var(--sp-border);
  font-size: 13px;
  font-weight: 600;
}
.dsh-splash-custom-toggle {
  align-self: center;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--sp-text-3);
  cursor: pointer;
  font: 500 12px/1 inherit;
  padding: 8px 12px;
}
.dsh-splash-custom-toggle:hover { color: var(--sp-text-1); }
.dsh-splash-path-row.dsh-splash-path-hidden { display: flex; }

/* 安装页视觉收束：单一主操作，选项与自定义入口保持轻量。 */
.dsh-splash-page[data-page="location"] {
  gap: 12px;
  padding-top: 18px;
}
.dsh-splash-page[data-page="location"] .dsh-splash-page-head {
  margin-bottom: 10px;
}
.dsh-splash-page[data-page="location"] .dsh-splash-page-title {
  font-size: 20px;
  font-weight: 650;
}
.dsh-splash-page[data-page="detect"] .dsh-splash-page-title,
.dsh-splash-page[data-page="location"] .dsh-splash-page-title,
.dsh-splash-page[data-page="confirm"] .dsh-splash-page-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
}
.dsh-splash-global-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 132px;
  height: 42px;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 0 20px 0 34px;
  border-radius: 999px;
  background: rgba(255,255,255,.56);
  border: 1px solid rgba(77,107,254,.12);
  color: var(--sp-text-1);
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 5px 14px rgba(54,72,115,.08);
}
.dsh-splash-global-pill::before {
  content: "";
  position: absolute;
  left: 16px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #35b66b;
  box-shadow: 0 0 0 3px rgba(53,182,107,.12);
}
.dsh-splash-install-button {
  height: 44px;
  min-width: 148px;
  margin-top: 8px;
  border-radius: 999px;
  font-size: 14px;
  box-shadow: 0 10px 22px rgba(77,107,254,.22);
}
.dsh-splash-custom-toggle {
  margin-top: 0;
  padding: 8px 12px;
  min-width: 92px;
  text-align: center;
  color: var(--sp-text-3);
  border-radius: 999px;
  outline: none;
}
.dsh-splash-custom-toggle:focus,
.dsh-splash-custom-toggle:focus-visible {
  outline: none;
  box-shadow: none;
}
.dsh-splash-custom-toggle:hover {
  background: rgba(77,107,254,.07);
  color: var(--sp-text-1);
}
html.dsh-splash-theme-light .dsh-splash-global-pill {
  background: rgba(255,255,255,.72);
}

/* 全局安装 / 自定义切换：淡出当前项，再从下方滑入目标项。 */
.dsh-splash-page[data-page="location"] .dsh-splash-global-pill,
.dsh-splash-page[data-page="location"] .dsh-splash-path-row {
  max-height: 64px;
  opacity: 1;
  transform: translateY(0) scale(1);
  overflow: hidden;
  transition: max-height .28s cubic-bezier(.2,.8,.25,1), opacity .2s ease, transform .28s cubic-bezier(.2,.8,.25,1), margin .28s ease, padding .28s ease;
}
.dsh-splash-page[data-page="location"] .dsh-splash-path-row {
  max-height: 56px;
  margin-top: 8px;
}
.dsh-splash-page[data-page="location"] .dsh-splash-global-pill.dsh-splash-option-hidden,
.dsh-splash-page[data-page="location"] .dsh-splash-path-row.dsh-splash-option-hidden {
  max-height: 0;
  opacity: 0;
  transform: translateY(-10px) scale(.96);
  margin-top: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-width: 0;
  pointer-events: none;
}
.dsh-splash-page[data-page="location"] .dsh-splash-path-row.dsh-splash-option-hidden {
  gap: 0;
}
/* 进度条 */
.dsh-splash-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 26px;
}
#dsh-splash-track-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--sp-track);
  overflow: hidden;
}
#dsh-splash-track-bar-inner {
  position: relative;
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--sp-brand), var(--sp-brand-2));
  overflow: hidden;
  transition: width .3s ease;
}
#dsh-splash-track-bar-inner::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .38), transparent);
  transform: translateX(-100%);
  animation: dsh-splash-bar-shimmer 1.6s ease-in-out infinite;
}
@keyframes dsh-splash-bar-shimmer {
  0% { transform: translateX(-100%); }
  60%, 100% { transform: translateX(260%); }
}
#dsh-splash-track-pct {
  flex: none;
  width: 44px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--sp-text-2);
}
/* 日志框 */
.dsh-splash-log {
  display: none;
  margin-top: 16px;
  border-radius: 14px;
  background: var(--sp-log-bg);
  border: 1px solid var(--sp-border);
  overflow: hidden;
}
.dsh-splash-log-on { display: block; }
.dsh-splash-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 0;
  font-size: 11px;
  color: var(--sp-text-3);
}
.dsh-splash-log-scroll {
  box-sizing: border-box;
  max-height: 150px;
  overflow-y: auto;
  padding: 8px 12px 12px;
  scrollbar-width: none;
  font-size: 11px;
  line-height: 1.7;
  font-family: ui-monospace, Consolas, "Microsoft YaHei", monospace;
  color: var(--sp-code);
}
.dsh-splash-log-scroll::-webkit-scrollbar { display: none; }
.dsh-splash-log-scroll > div {
  animation: dsh-splash-log-in .16s ease-out both;
}
.dsh-splash-log-scroll > div + div { margin-top: 4px; }
@keyframes dsh-splash-log-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.dsh-splash-rounded-copy,
.dsh-splash-log-copy,
.dsh-splash-retry {
  appearance: none;
  border: 1px solid var(--sp-border);
  cursor: pointer;
  height: 24px;
  padding: 0 12px;
  border-radius: 8px;
  background: transparent;
  color: var(--sp-text-2);
  font: 500 10.5px/1 inherit;
  transition: background-color .15s ease, color .15s ease;
}
.dsh-splash-rounded-copy:hover,
.dsh-splash-log-copy:hover,
.dsh-splash-retry:hover { background: var(--sp-hover); color: var(--sp-text-1); }

/* 版本安装视图：取消 / 返回操作行 */
.dsh-splash-install-actions {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  margin-top: 14px;
}
.dsh-splash-install-actions[hidden] { display: none; }
.dsh-splash-install-actions .dsh-splash-btn {
  min-width: 108px;
}
.dsh-splash-btn.dsh-splash-btn-danger {
  background: var(--sp-danger-soft);
  border: 1px solid color-mix(in srgb, var(--sp-danger) 45%, transparent);
  color: var(--sp-danger);
}
.dsh-splash-btn.dsh-splash-btn-danger:hover { filter: brightness(1.08); }

/* 启动页只保留必要信息；状态细节和辅助文案不参与布局。 */
.dsh-splash-page-sub,
.dsh-splash-next-label { display: none !important; }

/* 仅服务启动阶段显示的随机生产力文案。 */
.dsh-splash-boot-message {
  display: none;
  margin-top: 7px;
  min-height: 18px;
  color: var(--sp-text-3);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}
#dsh-splash.dsh-splash-booting-state .dsh-splash-boot-message {
  display: block;
  animation: dsh-splash-boot-message-in .28s ease-out both;
}
@keyframes dsh-splash-boot-message-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}
.dsh-splash-parsing-dots {
  display: inline-flex;
  align-items: center;
  width: 26px;
  position: absolute;
  left: calc(50% + 78px);
  top: 50%;
  transform: translateY(-50%);
  margin-left: 0;
  color: #f6d36a;
}
.dsh-splash-title-main {
  display: inline-block;
  width: 100%;
  text-align: center;
}
.dsh-splash-parsing-dots span {
  opacity: .24;
  animation: dsh-splash-parsing-dot 1.05s ease-in-out infinite;
}
.dsh-splash-parsing-dots span:nth-child(2) { animation-delay: .16s; }
.dsh-splash-parsing-dots span:nth-child(3) { animation-delay: .32s; }
@keyframes dsh-splash-parsing-dot {
  0%, 100% { opacity: .18; text-shadow: none; }
  45% { opacity: 1; text-shadow: 0 0 10px rgba(246, 211, 106, .9); }
}

/* 勾叉以圆心为基准绘制，避免视觉偏上或偏左。 */
.dsh-splash-step-icon.success::before {
  left: 50%; top: 50%;
  width: 8px; height: 4px;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  background: transparent;
  border-radius: 0;
  transform: translate(-38%, -62%) rotate(-45deg);
}
.dsh-splash-step-icon.success::after { display: none; }
.dsh-splash-step-icon.fail::before,
.dsh-splash-step-icon.fail::after {
  left: 50%; top: 50%;
  width: 12px; height: 2px;
  background: #fff;
  border-radius: 2px;
  transform-origin: center;
}
.dsh-splash-step-icon.fail::before { transform: translate(-50%, -50%) rotate(45deg); }
.dsh-splash-step-icon.fail::after { transform: translate(-50%, -50%) rotate(-45deg); }

/* 完成页：Logo 下移放大并切换为主题反色，金色光束只扫 SVG。 */
#dsh-splash-logo {
  position: relative;
  overflow: hidden;
  transition: transform .72s cubic-bezier(.2,.86,.25,1), color .42s ease, filter .42s ease;
}
#dsh-splash-logo::after {
  content: "";
  position: absolute;
  z-index: 2;
  top: -45%; bottom: -45%; left: -70%;
  width: 22%;
  pointer-events: none;
  background: linear-gradient(105deg, transparent, rgba(244,205,91,.12) 28%, rgba(255,220,111,.82) 50%, rgba(244,205,91,.12) 72%, transparent);
  transform: skewX(-18deg);
  opacity: 0;
}
#dsh-splash.dsh-splash-ready-state #dsh-splash-logo {
  animation: none;
  transform: translateY(92px) scale(1.38);
  filter: drop-shadow(0 12px 26px rgba(0,0,0,.16));
}
#dsh-splash.dsh-splash-ready-state #dsh-splash-logo::after {
  opacity: 0;
  animation: none;
}
@keyframes dsh-splash-logo-gold-sweep {
  0%, 12% { left: -70%; opacity: 0; }
  22% { opacity: 1; }
  62%, 100% { left: 155%; opacity: 0; }
}
html.dsh-splash-theme-light #dsh-splash.dsh-splash-ready-state #dsh-splash-logo { color: #fff; }
html:not(.dsh-splash-theme-light) #dsh-splash.dsh-splash-ready-state #dsh-splash-logo { color: #f4f6fb; }
.dsh-splash-page[data-page="ready"] {
  justify-content: center;
  gap: 20px;
  padding-top: 150px;
}
.dsh-splash-page[data-page="ready"] .dsh-splash-page-head {
  flex: none;
  margin: 0;
}
.dsh-splash-page[data-page="ready"] .dsh-splash-page-title {
  display: block;
  width: 100%;
  font-size: 30px;
  line-height: 40px;
  font-weight: 400 !important;
  color: var(--sp-text-1);
  text-decoration: none;
  border: 0;
  background: none;
}
#dsh-splash.dsh-splash-ready-state .dsh-splash-page[data-page="ready"] .dsh-splash-page-title {
  color: transparent;
  background-image: linear-gradient(100deg, var(--sp-text-1) 28%, #f7d878 45%, #fff4b0 50%, #f7d878 55%, var(--sp-text-1) 72%);
  background-size: 260% 100%;
  background-position: 120% 0;
  -webkit-background-clip: text;
  background-clip: text;
  animation: dsh-splash-title-gold-sweep 3.2s ease-in-out infinite;
}
@keyframes dsh-splash-title-gold-sweep {
  0%, 18% { background-position: 120% 0; }
  58%, 100% { background-position: -30% 0; }
}
.dsh-splash-page[data-page="ready"] .dsh-splash-action-row {
  flex: none;
  margin: 0;
  padding: 0;
}
#dsh-splash-ready-start { background: #0c0d10 !important; color: #fff; box-shadow: 0 14px 30px rgba(0,0,0,.28); }

`;

/** 启动画面：logo + 状态文字 + 蓝色进度条 + 安装日志框（仅安装时出现）。 */
function initSplash() {
  // 主题由主进程通过启动参数同步注入（避免异步等待造成先闪默认色）
  let theme = "dark";
  try {
    const arg = (process.argv || []).find((a) => a.startsWith("--dsh-splash-theme="));
    if (arg) theme = arg.split("=")[1] || "dark";
  } catch { /* 默认深色 */ }
  document.documentElement.classList.toggle("dsh-splash-theme-light", theme === "light");
  const style = document.createElement("style");
  style.id = "dsh-splash-style";
  style.textContent = SPLASH_CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "dsh-splash";
  root.innerHTML = `
    <iframe id="dsh-splash-web-bg" src="harness-web/index.html" title="" aria-hidden="true"></iframe>
    <div class="dsh-splash-aurora" aria-hidden="true">
      <svg viewBox="0 0 1250 760" preserveAspectRatio="xMidYMid slice">
        <path class="dsh-splash-aurora-fade" d="M 106 24 C 326 16, 369 319, 629 312 C 865 305, 901 36, 1146 42" stroke-width="106"/>
        <path d="M 128 14 C 344 17, 381 300, 628 292 C 853 284, 909 26, 1127 34" stroke-width="56"/>
        <path d="M 246 -8 C 459 80, 472 365, 681 373 C 905 381, 924 120, 1072 77" stroke-width="27" opacity=".58"/>
      </svg>
    </div>
    <div id="dsh-splash-inner">
      <div id="dsh-splash-logo">${SPLASH_LOGO_SVG}</div>
      <div id="dsh-splash-status">正在启动…</div>
      <div id="dsh-splash-stage">
        <div id="dsh-splash-track">
          <section class="dsh-splash-page" data-page="detect">
            <div class="dsh-splash-page-head">
              <div class="dsh-splash-page-title">环境检测</div>
              <div class="dsh-splash-page-sub"></div>
            </div>
            <div class="dsh-splash-step-list">
              <div class="dsh-splash-step" data-step="0">
                <div class="dsh-splash-step-icon loading"></div>
                <div class="dsh-splash-step-body">
                  <div class="dsh-splash-step-title">检测 Node.js 环境</div>
                  <div class="dsh-splash-step-detail">正在检查 Node.js、npm</div>
                </div>
              </div>
              <div class="dsh-splash-step" data-step="1">
                <div class="dsh-splash-step-icon"></div>
                <div class="dsh-splash-step-body">
                  <div class="dsh-splash-step-title">检测 DeepSeek Harness 环境</div>
                  <div class="dsh-splash-step-detail">等待上一步完成</div>
                </div>
              </div>
              <div class="dsh-splash-step" data-step="2">
                <div class="dsh-splash-step-icon"></div>
                <div class="dsh-splash-step-body">
                  <div class="dsh-splash-step-title">检测当前网络状态</div>
                  <div class="dsh-splash-step-detail">等待上一步完成</div>
                </div>
              </div>
            </div>
            <div class="dsh-splash-action-row">
              <button class="dsh-splash-next-btn" id="dsh-splash-detect-next" type="button" hidden aria-label="下一步">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
            <div class="dsh-splash-next-label" id="dsh-splash-detect-label">正在检测环境…</div>
          </section>

          <section class="dsh-splash-page" data-page="location">
            <div class="dsh-splash-page-head">
              <div class="dsh-splash-page-title" id="dsh-splash-location-title">选择安装位置</div>
              <div class="dsh-splash-page-sub" id="dsh-splash-location-sub">默认安装到本软件的安装位置。</div>
            </div>
            <div class="dsh-splash-path-row dsh-splash-path-hidden" id="dsh-splash-path-row">
              <input class="dsh-splash-path-input" id="dsh-splash-install-path" type="text" readonly />
              <button class="dsh-splash-path-browse" id="dsh-splash-install-browse" type="button">更改…</button>
            </div>
            <button class="dsh-splash-btn dsh-splash-btn-primary dsh-splash-install-button" id="dsh-splash-install-go" type="button">开始安装</button>
            <button class="dsh-splash-custom-toggle" id="dsh-splash-custom-toggle" type="button">自定义</button>
          </section>

          <section class="dsh-splash-page" data-page="installing">
            <div class="dsh-splash-page-head">
              <div class="dsh-splash-page-title" id="dsh-splash-install-title">正在安装</div>
              <div class="dsh-splash-page-sub" id="dsh-splash-install-sub">请稍候，正在下载并安装所需组件。</div>
              <div class="dsh-splash-boot-message" id="dsh-splash-boot-message"></div>
            </div>
            <div class="dsh-splash-progress-row" id="dsh-splash-bar-row" hidden>
              <div id="dsh-splash-track-bar"><div id="dsh-splash-track-bar-inner"></div></div>
              <span id="dsh-splash-track-pct">0%</span>
            </div>
            <div class="dsh-splash-log" id="dsh-splash-log">
              <div class="dsh-splash-log-head">
                <span>安装日志</span>
                <div style="display:flex;align-items:center;gap:6px">
                  <button class="dsh-splash-retry" id="dsh-splash-retry" type="button" hidden>重试安装</button>
                  <button class="dsh-splash-rounded-copy" id="dsh-splash-log-copy" type="button">复制日志</button>
                </div>
              </div>
              <div class="dsh-splash-log-scroll" id="dsh-splash-log-scroll"></div>
            </div>
            <div class="dsh-splash-install-actions" id="dsh-splash-install-actions" hidden>
              <button class="dsh-splash-btn dsh-splash-btn-danger" id="dsh-splash-cancel-install" type="button" hidden>取消安装</button>
              <button class="dsh-splash-btn" id="dsh-splash-return-app" type="button" hidden>返回软件</button>
            </div>
          </section>

          <section class="dsh-splash-page" data-page="ready">
            <div class="dsh-splash-page-head">
              <div class="dsh-splash-page-title">开始使用</div>
              <div class="dsh-splash-page-sub" id="dsh-splash-ready-sub">环境已准备就绪。</div>
            </div>
            <div class="dsh-splash-action-row">
              <button class="dsh-splash-next-btn" id="dsh-splash-ready-start" type="button" aria-label="开始使用">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
            <div class="dsh-splash-next-label">开始使用</div>
          </section>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const webBackground = root.querySelector("#dsh-splash-web-bg");
  if (webBackground) {
    webBackground.addEventListener("load", () => webBackground.classList.add("dsh-splash-web-bg-ready"), { once: true });
    // 首帧先展示纯色启动页（logo/进度条），web 背景延迟加载避免拖慢首帧渲染
    const splashBgSrc = webBackground.getAttribute("src");
    webBackground.removeAttribute("src");
    setTimeout(() => {
      if (webBackground && webBackground.isConnected && !webBackground.getAttribute("src")) {
        webBackground.setAttribute("src", splashBgSrc);
      }
    }, 600);
  }
  const status = root.querySelector("#dsh-splash-status");
  const track = root.querySelector("#dsh-splash-track");
  const detectNext = root.querySelector("#dsh-splash-detect-next");
  const detectLabel = root.querySelector("#dsh-splash-detect-label");
  const locationTitle = root.querySelector("#dsh-splash-location-title");
  const locationSub = root.querySelector("#dsh-splash-location-sub");
  const installPath = root.querySelector("#dsh-splash-install-path");
  const installTitle = root.querySelector("#dsh-splash-install-title");
  const installSub = root.querySelector("#dsh-splash-install-sub");
  const bootMessage = root.querySelector("#dsh-splash-boot-message");
  const installBrowse = root.querySelector("#dsh-splash-install-browse");
  const installPathRow = root.querySelector("#dsh-splash-path-row");
  const customToggle = root.querySelector("#dsh-splash-custom-toggle");
  const installGo = root.querySelector("#dsh-splash-install-go");
  const logCopy = root.querySelector("#dsh-splash-log-copy");
  const retryInstall = root.querySelector("#dsh-splash-retry");
  const readySub = root.querySelector("#dsh-splash-ready-sub");
  const barRow = root.querySelector("#dsh-splash-bar-row");
  const bar = root.querySelector("#dsh-splash-track-bar-inner");
  const pct = root.querySelector("#dsh-splash-track-pct");
  const logOuter = root.querySelector("#dsh-splash-log");
  const logBox = root.querySelector("#dsh-splash-log-scroll");
  const readyStart = root.querySelector("#dsh-splash-ready-start");
  const stepRows = Array.from(root.querySelectorAll("[data-step]")).map((row) => ({
    row,
    icon: row.querySelector(".dsh-splash-step-icon"),
    detail: row.querySelector(".dsh-splash-step-detail"),
  }));
  const pageMap = { detect: 0, location: 1, installing: 2, ready: 3 };
  let currentNextPage = "location";
  let currentInstallMode = "bundled";
  let currentNativeInfo = null;
  let customInstall = false;
  let startupTagline = null;
  const STARTUP_TAGLINES = [
    "正在准备您的 AI 生产力空间…",
    "正在启动您的智能工作台…",
    "正在连接您的 AI 助手…",
    "正在整理您的创作与思考环境…",
    "正在唤醒您的高效工作伙伴…",
    "正在加载您的智能生产力工具…",
    "正在准备下一次灵感与创造…",
    "正在开启您的 AI 工作流…",
    "正在为您构建更高效的工作方式…",
    "正在让想法更快成为成果…",
  ];
  const themeClass = theme === "light" ? "dsh-splash-next-light" : "dsh-splash-next-dark";
  detectNext.classList.add(themeClass);
  readyStart.classList.add(themeClass);
  const setPage = (page) => {
    const idx = Object.prototype.hasOwnProperty.call(pageMap, page) ? pageMap[page] : 0;
    track.style.transform = `translateX(-${idx * 25}%)`;
    root.classList.toggle("dsh-splash-ready-state", page === "ready");
    root.classList.remove("dsh-splash-booting-state");
  };
  const resolveInstallMode = () => {
    return "global";
  };
  const setStepState = (index, state, detail) => {
    const entry = stepRows[index];
    if (!entry) return;
    entry.icon.className = `dsh-splash-step-icon${state ? ` ${state}` : ""}`;
    if (typeof detail === "string" && detail !== "") entry.detail.textContent = detail;
  };
  const setInstallInputs = (disabled) => {
    installPath.disabled = !!disabled;
    installBrowse.disabled = !!disabled;
    installGo.disabled = !!disabled;
  };
  const setInstallModeView = (custom) => {
    customInstall = !!custom;
    installPathRow.classList.toggle("dsh-splash-path-hidden", !customInstall);
    installPathRow.classList.toggle("dsh-splash-option-hidden", !customInstall);
    customToggle.textContent = customInstall ? "使用全局安装" : "自定义";
    installGo.textContent = customInstall ? "开始安装" : "开始全局安装";
  };
  const setInstallSubtitle = (mode) => {
    if (mode === "global") {
      const hasNode = !!(currentNativeInfo && currentNativeInfo.localNodeReady);
      installTitle.textContent = hasNode ? "安装 DeepSeek Harness" : "安装运行环境";
      installSub.textContent = "";
      locationTitle.textContent = hasNode ? "安装 DeepSeek Harness" : "安装运行环境";
      locationSub.textContent = "";
      readySub.textContent = "";
      return;
    }
    installTitle.textContent = "安装运行环境";
    installSub.textContent = "";
    locationTitle.textContent = "选择安装位置";
    locationSub.textContent = "";
    readySub.textContent = "";
  };
  const setDetectAction = (show, labelText, nextPage) => {
    detectNext.hidden = !show;
    detectLabel.textContent = labelText || "正在检测环境…";
    currentNextPage = nextPage || "location";
  };
  const setInstallStage = (stage, fallback = "正在安装 DeepSeek Harness…") => {
    const text = typeof stage === "string" && stage.trim() !== "" ? stage.trim() : fallback;
    if (text.includes("正在解析安装包")) {
      installTitle.innerHTML = `<span class="dsh-splash-title-main">正在解析安装包</span><span class="dsh-splash-parsing-dots"><span>.</span><span>.</span><span>.</span></span>`;
      bootMessage.textContent = "请耐心等待";
      root.classList.add("dsh-splash-booting-state");
      return;
    }
    installTitle.textContent = text;
    bootMessage.textContent = "";
    root.classList.remove("dsh-splash-booting-state");
  };
  ipcRenderer.on("dsh:boot-progress", (_event, payload) => {
    if (!payload || typeof payload !== "object") return;
    if (typeof payload.percent === "number") {
      const clamped = Math.min(100, Math.max(0, payload.percent));
      bar.style.width = `${clamped}%`;
      pct.textContent = `${Math.round(clamped)}%`;
    }
    if (typeof payload.stage === "string" && payload.stage !== "") status.textContent = payload.stage;
    if (typeof payload.defaultDir === "string" && payload.defaultDir !== "") installPath.value = payload.defaultDir;
    if (typeof payload.installMode === "string" && payload.installMode !== "") {
      currentInstallMode = payload.installMode;
      setInstallSubtitle(currentInstallMode);
    }
    if (payload.native && typeof payload.native === "object") {
      currentNativeInfo = payload.native;
    }
    if (payload.steps && Array.isArray(payload.steps)) {
      payload.steps.forEach((step, index) => {
        if (!step || typeof step !== "object") return;
        const state = typeof step.state === "string" ? step.state : "idle";
        const detail = typeof step.detail === "string" ? step.detail : "";
        setStepState(index, state, detail);
      });
    }
    if (payload.page === "detect") {
      setPage("detect");
      setInstallInputs(true);
      setInstallSubtitle(currentInstallMode);
      barRow.hidden = true;
      logOuter.classList.remove("dsh-splash-log-on");
      detectNext.hidden = !payload.detectComplete;
      detectLabel.textContent = payload.detectComplete ? "点击继续" : "正在检测环境…";
      currentNextPage = payload.nextPage || "location";
      return;
    }
    if (payload.page === "location") {
      setPage("location");
      setInstallInputs(false);
      setInstallModeView(false);
      setInstallSubtitle(currentInstallMode);
      barRow.hidden = true;
      logOuter.classList.remove("dsh-splash-log-on");
      return;
    }
    if (payload.page === "installing") {
      setPage("installing");
      setInstallInputs(true);
      setInstallSubtitle(currentInstallMode);
      if (payload.installError !== true) {
        setInstallStage(payload.stage, "正在安装 DeepSeek Harness…");
        installSub.textContent = typeof payload.stage === "string" && payload.stage !== "" ? payload.stage : "正在安装 DeepSeek Harness…";
      }
      if (payload.installError === true) {
        installTitle.textContent = "安装失败";
        installSub.textContent = typeof payload.stage === "string" && payload.stage !== "" ? payload.stage : "请检查网络后重试";
        root.classList.remove("dsh-splash-booting-state");
      }
      barRow.hidden = false;
      logOuter.classList.add("dsh-splash-log-on");
      retryInstall.hidden = payload.installError !== true;
      // 版本安装视图：安装中显示"取消安装"，失败/取消且无法恢复时显示"返回软件"
      if (pendingInstallVersionLocal) {
        installActionsRow.hidden = false;
        cancelInstallBtn.hidden = payload.installError === true;
        cancelInstallBtn.disabled = payload.installError === true;
        returnAppBtn.hidden = payload.installError !== true;
      } else {
        installActionsRow.hidden = true;
      }
      return;
    }
    if (payload.page === "ready") {
      setPage("ready");
      setInstallInputs(true);
      setInstallSubtitle(typeof payload.installMode === "string" ? payload.installMode : currentInstallMode);
      barRow.hidden = true;
      logOuter.classList.remove("dsh-splash-log-on");
      detectNext.hidden = true;
      readyStart.disabled = false;
      return;
    }
    if (payload.page === "booting") {
      // 已安装/已就绪后的启动阶段：显示进度条加载（规则4），无日志
      setPage("installing");
      if (startupTagline === null) {
        startupTagline = STARTUP_TAGLINES[Math.floor(Math.random() * STARTUP_TAGLINES.length)];
      }
      root.classList.add("dsh-splash-booting-state");
      setInstallInputs(true);
      if (typeof payload.stage === "string" && payload.stage.includes("正在解析安装包")) {
        setInstallStage(payload.stage, "正在启动服务…");
      } else {
        bootMessage.textContent = startupTagline;
        installTitle.textContent = typeof payload.stage === "string" && payload.stage.includes("正在安装") ? "正在安装" : "正在启动";
      }
      installSub.textContent = typeof payload.stage === "string" && payload.stage !== "" ? payload.stage : "正在启动服务…";
      barRow.hidden = false;
      logOuter.classList.remove("dsh-splash-log-on");
      detectNext.hidden = true;
      readyStart.disabled = true;
      return;
    }
    // 其余无 page 的进度事件（如“服务已就绪 100%”）：只更新进度/状态，不切换页面
  });
  ipcRenderer.on("dsh:boot-log", (_event, message) => {
    if (!message || typeof message.line !== "string") return;
    const line = document.createElement("div");
    line.textContent = message.line;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
    while (logBox.childElementCount > 400) logBox.removeChild(logBox.firstChild);
  });
  detectNext.addEventListener("click", () => {
    if (currentNextPage === "start") {
      api.chooseBootMode("start");
      return;
    }
    currentInstallMode = resolveInstallMode();
    setInstallSubtitle(currentInstallMode);
    setInstallInputs(false);
    setInstallModeView(false);
    barRow.hidden = true;
    logOuter.classList.remove("dsh-splash-log-on");
    setPage("location");
  });
  installBrowse.addEventListener("click", async () => {
    const dir = await api.chooseRuntimeDir();
    if (dir && typeof dir === "string") installPath.value = dir;
  });
  installGo.addEventListener("click", () => {
    if (customInstall) {
      const dir = installPath.value.trim();
      if (dir === "") return;
      api.startRuntimeInstall({ mode: "custom", dir });
      return;
    }
    api.startRuntimeInstall({ mode: "global" });
  });
  retryInstall.addEventListener("click", () => {
    retryInstall.hidden = true;
    if (pendingInstallVersionLocal) {
      // 版本安装失败重试：重新走版本安装流程
      api.installVersion(pendingInstallVersionLocal);
      return;
    }
    if (customInstall) {
      const dir = installPath.value.trim();
      if (dir !== "") api.startRuntimeInstall({ mode: "custom", dir });
      return;
    }
    api.startRuntimeInstall({ mode: "global" });
  });
  customToggle.addEventListener("click", () => {
    setInstallModeView(!customInstall);
  });
  readyStart.addEventListener("click", () => {
    readyStart.disabled = true;
    api.chooseBootMode("start");
  });
  logCopy.addEventListener("click", async () => {
    try {
      const text = Array.from(logBox.querySelectorAll("div")).map((el) => el.textContent || "").join("\n").trim();
      if (!text) return;
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }
  });
  setInstallSubtitle("global");
  // 版本安装视图：取消 / 返回
  const cancelInstallBtn = root.querySelector("#dsh-splash-cancel-install");
  const returnAppBtn = root.querySelector("#dsh-splash-return-app");
  const installActionsRow = root.querySelector("#dsh-splash-install-actions");
  cancelInstallBtn.addEventListener("click", () => {
    cancelInstallBtn.disabled = true;
    cancelInstallBtn.textContent = "正在取消…";
    api.cancelInstall();
  });
  returnAppBtn.addEventListener("click", () => {
    returnAppBtn.disabled = true;
    api.returnToApp();
  });
  // 已安装过（--dsh-boot-resume=1）：启动页直接进入“正在启动”视图（logo + 状态 + 进度条），
  // 由 booting 事件驱动；首次运行则从环境检测向导开始。
  const bootResume = (process.argv || []).some((a) => a === "--dsh-boot-resume=1");
  if (bootResume) {
    setPage("installing");
    installTitle.textContent = "正在启动";
    installSub.textContent = "正在准备环境…";
    barRow.hidden = false;
    logOuter.classList.remove("dsh-splash-log-on");
  } else {
    setPage("detect");
  }
  // 版本安装模式：主进程会在 loadURL 后 400ms 再发送 installing 事件；
  // 这里先主动查询并切换到安装视图（显示版本号 + 进度 + 取消按钮）
  api.getPendingInstall().then((version) => {
    if (!version || !root.isConnected) return;
    pendingInstallVersionLocal = String(version);
    setPage("installing");
    installTitle.textContent = `正在安装 DeepSeek Harness v${pendingInstallVersionLocal}…`;
    installSub.textContent = "";
    barRow.hidden = false;
    logOuter.classList.add("dsh-splash-log-on");
    retryInstall.hidden = true;
    installActionsRow.hidden = false;
    cancelInstallBtn.hidden = false;
    cancelInstallBtn.disabled = false;
    cancelInstallBtn.textContent = "取消安装";
  }).catch(() => {});
  // 启动页 DOM 已渲染完成，通知主进程立即展示窗口（不等 did-finish-load / iframe 慢子资源）
  try {
    ipcRenderer.send("dsh:splash-ready");
  } catch { /* ignore */ }
}

/** 读取 DSH 主题底色，估算明暗并上报主进程（供下次启动画面跟随）。 */
function reportThemeToMain() {
  const readBg = () => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue("--dsw-alias-bg-base").trim();
    } catch {
      return "";
    }
  };
  const luminance = (bg) => {
    const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) return (Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114) / 255;
    if (/^#[0-9a-fA-F]{6}$/.test(bg)) {
      const r = parseInt(bg.slice(1, 3), 16);
      const g = parseInt(bg.slice(3, 5), 16);
      const b = parseInt(bg.slice(5, 7), 16);
      return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    }
    return null;
  };
  let attempts = 0;
  const tryReport = () => {
    const lum = luminance(readBg());
    if (lum !== null) {
      ipcRenderer.send("dsh:theme", lum < 0.5 ? "dark" : "light");
      return;
    }
    if (++attempts > 10) return;
    setTimeout(tryReport, 400);
  };
  setTimeout(tryReport, 300);
}

function boot() {
  const init = () => {
    // 启动画面模式：窗口先以 about:blank 打开，显示 logo/进度/安装日志；
    // 导航到主界面（http://127.0.0.1）后进入正常模式（标题栏等）。
    const isSplash = location.protocol === "file:";
    if (isSplash) {
      initSplash();
      return;
    }
    injectTitlebar();
    // 设置弹窗更新事件监听（新版本提示 / 安装进度 / 安装结果）与状态监听
    ipcRenderer.on("dsh:update-event", (_event, evt) => handleDesktopUpdateEvent(evt));
    ipcRenderer.on("dsh:update-status", (_event, status) => handleUpdateStatus(status));
    // llama-server 状态实时刷新（启动中/运行中/错误徽标与启停按钮）
    ipcRenderer.on("dsh:llama-status-changed", (_event, status) => updateLlamaStatusView(status));
    // 通知主进程：本页面 preload 已就绪（用于更新完成后重载页面的握手）
    ipcRenderer.send("dsh:renderer-ready");
    // 上报应用主题给主进程（持久化，供下次启动画面跟随主题）
    reportThemeToMain();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}

const api = {
  minimize: () => ipcRenderer.send("dsh:win-min"),
  toggleMaximize: () => ipcRenderer.send("dsh:win-max-toggle"),
  close: () => ipcRenderer.send("dsh:win-close"),
  isMaximized: () => ipcRenderer.invoke("dsh:win-is-maximized"),
  onMaximizedChange: (cb) => {
    const listener = (_event, value) => cb(value);
    ipcRenderer.on("dsh:win-maximized", listener);
    return () => ipcRenderer.removeListener("dsh:win-maximized", listener);
  },
  /** 触发一次静默更新检查（设置弹窗"检查更新"按钮使用） */
  checkUpdate: (silent) => ipcRenderer.send("dsh:check-update", !!silent),
  onUpdateStatus: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on("dsh:update-status", listener);
    return () => ipcRenderer.removeListener("dsh:update-status", listener);
  },
  getVersion: () => ipcRenderer.invoke("dsh:get-version"),
  getSettings: () => ipcRenderer.invoke("dsh:get-settings"),
  saveSettings: (patch) => ipcRenderer.send("dsh:save-settings", patch),
  onSettingsChanged: (cb) => {
    const listener = (_event, settings) => cb(settings);
    ipcRenderer.on("dsh:settings-changed", listener);
    return () => ipcRenderer.removeListener("dsh:settings-changed", listener);
  },
  listVersions: () => ipcRenderer.invoke("dsh:list-versions"),
  installVersion: (version) => ipcRenderer.send("dsh:install-version", version),
  // Llama 启动器
  llamaGet: () => ipcRenderer.invoke("dsh:llama-get"),
  llamaSave: (patch) => ipcRenderer.send("dsh:llama-save", patch),
  llamaBrowseDir: () => ipcRenderer.invoke("dsh:llama-browse-dir"),
  llamaBrowseModel: () => ipcRenderer.invoke("dsh:llama-browse-model"),
  llamaStart: () => ipcRenderer.send("dsh:llama-start"),
  llamaStop: () => ipcRenderer.send("dsh:llama-stop"),
  onLlamaStatusChanged: (cb) => {
    const listener = (_event, status) => cb(status);
    ipcRenderer.on("dsh:llama-status-changed", listener);
    return () => ipcRenderer.removeListener("dsh:llama-status-changed", listener);
  },
  getPendingInstall: () => ipcRenderer.invoke("dsh:get-pending-install"),
  cancelInstall: () => ipcRenderer.send("dsh:cancel-install"),
  returnToApp: () => ipcRenderer.invoke("dsh:return-to-app"),
  reloadAfterUpdate: () => ipcRenderer.invoke("dsh:reload-after-update"),
  chooseBootMode: (mode) => ipcRenderer.send("dsh:boot-choice", mode),
  chooseRuntimeDir: () => ipcRenderer.invoke("dsh:choose-runtime-dir"),
  startRuntimeInstall: (dir) => ipcRenderer.send("dsh:runtime-install", dir),
};

contextBridge.exposeInMainWorld("dshDesktop", api);

if (typeof window !== "undefined") boot();
