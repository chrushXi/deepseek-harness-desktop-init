window.__ModuleLoader__.load({
	id: "dsh-damage-pulse",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region packages/client/ui-token-monitor/src/client/usage-node.ts
		function locationOf(context) {
			return context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
		}
		const tokenUsageNodeDefinition = {
			kind: "token-usage",
			target: "chat",
			match: (event) => {
				if (event.type === "token-usage/record") return {
					id: String(event.seq),
					role: "start"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "token-usage/record") throw new Error("token-usage requires token-usage/record");
				return match.event.data.record;
			},
			update: (context) => context.state,
			publication: () => "immediate",
			buildViewNode: (context) => {
				if (context.state === void 0) return null;
				return {
					key: context.key,
					kind: "token-usage",
					id: context.id,
					target: "chat",
					anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
					location: locationOf(context),
					visibility: "visible",
					data: context.state
				};
			}
		};
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/UsageNodeView.tsx
		/**
		* 单次用量行 renderer：对话流内紧凑展示一次模型调用的 token 与金额。
		* 无 locale（文案硬编码中文），无 CSS module（内联样式，M4 验证用）。
		*/
		const ROW = {
			display: "inline-flex",
			alignItems: "baseline",
			gap: 8,
			padding: "3px 10px",
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsh-color-text-secondary, #888)",
			fontVariantNumeric: "tabular-nums"
		};
		const COST$1 = {
			fontWeight: 600,
			color: "var(--dsh-color-accent, #4c8dff)"
		};
		/** 把大 token 数格式化为 1.2k / 3.4M 的紧凑形式。 */
		function fmtTokens$1(n) {
			if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return String(n);
		}
		/** 金额格式：保留足够小数位，极小值也用科学计数兜底。 */
		function fmtCost$2(n) {
			if (n === 0) return "¥0";
			if (n < 1e-4) return `¥${n.toExponential(2)}`;
			if (n < .01) return `¥${n.toFixed(5)}`;
			return `¥${n.toFixed(4)}`;
		}
		const UsageNodeView = (0, react.memo)(function UsageNodeView({ node }) {
			const r = node.data;
			const total = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens + r.outputTokens;
			const cache = r.cacheReadTokens > 0 ? ` · 缓存 ${fmtTokens$1(r.cacheReadTokens)}` : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: ROW,
				"data-token-usage": "",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: r.model }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"↑ ",
						fmtTokens$1(r.inputTokens + r.cacheWriteTokens),
						cache
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["↓ ", fmtTokens$1(r.outputTokens)] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"∑ ",
						fmtTokens$1(total),
						" tok"
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: r.peak ? "峰时" : "谷时" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: COST$1,
						children: fmtCost$2(r.cost)
					})
				]
			});
		});
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/SessionStatsBar.tsx
		const BAR = {
			display: "inline-flex",
			alignItems: "baseline",
			gap: 10,
			fontSize: 12,
			lineHeight: "16px",
			color: "var(--dsh-color-text-secondary, #888)",
			fontVariantNumeric: "tabular-nums"
		};
		const COST = {
			fontWeight: 600,
			color: "var(--dsh-color-accent, #4c8dff)"
		};
		function fmtTokens(n) {
			if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return String(n);
		}
		function fmtCost$1(n) {
			if (n === 0) return "¥0";
			if (n < 1e-4) return `¥${n.toExponential(2)}`;
			if (n < .01) return `¥${n.toFixed(5)}`;
			return `¥${n.toFixed(4)}`;
		}
		function SessionStatsBar({ useProjection }) {
			const projection = useProjection("tokenCost");
			if (projection === void 0 || projection === null) return null;
			const p = projection;
			if (p.calls === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: BAR,
				"data-token-monitor-stats": "",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "本次会话" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: COST,
						children: fmtCost$1(p.cost)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [fmtTokens(p.totalTokens), " tokens"] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [p.calls, " 次调用"] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["↑ ", fmtTokens(p.inputTokens + p.cacheWriteTokens)] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["↓ ", fmtTokens(p.outputTokens)] })
				]
			});
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/BalanceWidget.tsx
		/**
		* 余额悬浮卡片：挂载在 frame 级浮动层（shell.overlay，右下角）。
		*
		* 数据源两个：
		* - 扣费：每秒增量拉取 /api/token-monitor/charge-events（Host collector 每次模型调用算出的精确 cost），
		*   合并该秒内扣费 → 余额本地精确扣减 + 红色「扣血」飘字动画 + 数字红色闪烁 + 下沉回弹微动。
		* - 余额：每 60 秒拉取 /api/token-monitor/balance，校准显示余额；检测到余额变多（充值）→
		*   绿色「加费」飘字动画 + 数字绿色闪烁。
		*
		* 全局（root scope）组件，无 session 依赖。
		*/
		const CARD = {
			position: "fixed",
			padding: "6px 12px",
			borderRadius: 8,
			background: "var(--dsh-color-surface-overlay, rgba(30, 30, 30, 0.82))",
			color: "var(--dsh-color-text, #e8e8e8)",
			fontSize: 16,
			lineHeight: "22px",
			fontVariantNumeric: "tabular-nums",
			pointerEvents: "auto",
			cursor: "grab",
			userSelect: "none",
			boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
			zIndex: 1e3
		};
		const RED = "#ff3b30";
		const GREEN = "#30a46c";
		/** 命中脉冲：飘字短促弹出上浮，余额数字同步下沉回弹。 */
		const KEYFRAMES = `
@keyframes tkm-impact-float {
  0%   { opacity: 0; transform: translateY(6px) scale(0.5); }
  14%  { opacity: 1; transform: translateY(-6px) scale(1.25); }
  30%  { opacity: 1; transform: translateY(-21px) scale(0.98); }
  70%  { opacity: 1; transform: translateY(-63px) scale(1); }
  100% { opacity: 0; transform: translateY(-90px) scale(0.9); }
}
@keyframes tkm-balance-hit {
  0%   { transform: translateY(0) scale(1); }
  26%  { transform: translateY(3px) scale(0.97); }
  58%  { transform: translateY(-1px) scale(1.015); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes tkm-miss-float {
  0%   { opacity: 0; filter: blur(1.5px); transform: translateY(9px) scale(0.36) rotate(-3deg); }
  12%  { opacity: 1; filter: blur(0); transform: translateY(-12px) scale(1.52) rotate(1deg); }
  23%  { transform: translate(-4px, -27px) scale(0.96) rotate(-1deg); }
  34%  { transform: translate(3px, -39px) scale(1.08); }
  64%  { opacity: 1; transform: translateY(-87px) scale(1); }
  100% { opacity: 0; transform: translateY(-132px) scale(0.88); }
}
@keyframes tkm-balance-miss {
  0%   { transform: translate(0, 0) scale(1); }
  12%  { transform: translate(-3px, 4px) scale(0.94); text-shadow: 0 0 8px rgba(255,59,48,0.7); }
  23%  { transform: translate(3px, 1px) scale(1.04); }
  34%  { transform: translate(-2px, -1px) scale(0.99); }
  48%  { transform: translate(1px, 0) scale(1.015); }
  100% { transform: translate(0, 0) scale(1); text-shadow: none; }
}
@keyframes tkm-impact-float-reduced {
  0%   { opacity: 0; transform: translateY(6px); }
  35%  { opacity: 1; transform: translateY(-6px); }
  100% { opacity: 0; transform: translateY(-30px); }
}
@media (prefers-reduced-motion: reduce) {
  .tkm-impact-float {
    animation: tkm-impact-float-reduced 180ms ease-out forwards !important;
  }
  .tkm-miss-float {
    animation: tkm-impact-float-reduced 180ms ease-out forwards !important;
  }
  .tkm-balance-hit,
  .tkm-balance-miss {
    animation: none !important;
  }
}
`;
		/** 飘字锚定余额数字，不参与卡片布局。 */
		const FLOAT = {
			position: "absolute",
			right: 0,
			bottom: 0,
			fontSize: 18,
			fontWeight: 700,
			fontVariantNumeric: "tabular-nums",
			pointerEvents: "none",
			zIndex: 1001,
			animation: "tkm-impact-float 1000ms cubic-bezier(.2,.86,.25,1) forwards",
			transformOrigin: "50% 70%",
			whiteSpace: "nowrap",
			willChange: "transform, opacity",
			textShadow: "0 1px 3px rgba(0,0,0,0.5)"
		};
		/** 悬浮窗位置持久化 key。 */
		const POS_KEY = "dsh-token-monitor-balance-pos";
		/** 从 localStorage 恢复上次位置；缺失或非法则用右下角默认值。 */
		function loadPos() {
			try {
				const raw = localStorage.getItem(POS_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					if (typeof parsed.left === "number" && typeof parsed.top === "number") return {
						left: parsed.left,
						top: parsed.top
					};
				}
			} catch {}
			return {
				left: Math.max(0, window.innerWidth - 220),
				top: Math.max(0, window.innerHeight - 72)
			};
		}
		/** 持久化悬浮窗位置。 */
		function savePos(pos) {
			try {
				localStorage.setItem(POS_KEY, JSON.stringify(pos));
			} catch {}
		}
		/** 限制数值在 [min, max] 区间。 */
		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}
		/** 紧凑金额格式：小金额保留 4 位，大金额保留 2 位。 */
		function fmtCost(cost) {
			return cost < .01 ? cost.toFixed(4) : cost.toFixed(2);
		}
		/** 高峰时段（北京时间，半开区间 [start, end)）。 */
		const PEAK_HOURS = [[9, 12], [14, 18]];
		/** 取时间戳对应的北京时间小时（0-23）；解析失败返回 -1。 */
		function beijingHour(ts) {
			const hour = new Intl.DateTimeFormat("en-GB", {
				timeZone: "Asia/Shanghai",
				hour: "2-digit",
				hour12: false
			}).formatToParts(new Date(ts)).find((p) => p.type === "hour")?.value;
			return hour === void 0 ? -1 : Number(hour);
		}
		/** 当前时刻是否落在高峰时段。 */
		function isPeakNow() {
			const hour = beijingHour(Date.now());
			return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end);
		}
		const CHARGE_POLL_MS = 1e3;
		const BALANCE_POLL_MS = 6e4;
		const FLOAT_MS = 1e3;
		const MISS_FLOAT_MS = 1250;
		const FLOAT_EMIT_INTERVAL_MS = 200;
		const FLASH_MS = 620;
		function BalanceWidget(_props) {
			const [balanceInfo, setBalanceInfo] = (0, react.useState)(void 0);
			const [display, setDisplay] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(false);
			const [flash, setFlash] = (0, react.useState)(null);
			const [dipKey, setDipKey] = (0, react.useState)(0);
			const [damageKind, setDamageKind] = (0, react.useState)("normal");
			const [anims, setAnims] = (0, react.useState)([]);
			const [pos, setPos] = (0, react.useState)(loadPos);
			const [dragging, setDragging] = (0, react.useState)(false);
			const [isPeak, setIsPeak] = (0, react.useState)(isPeakNow);
			const chargeSeq = (0, react.useRef)(0);
			const chargeSeeded = (0, react.useRef)(false);
			const animId = (0, react.useRef)(0);
			const flashTimer = (0, react.useRef)(void 0);
			const animTimers = (0, react.useRef)(/* @__PURE__ */ new Set());
			const animQueue = (0, react.useRef)([]);
			const queueTimer = (0, react.useRef)(void 0);
			const dragStart = (0, react.useRef)(null);
			/** 拖拽开始：记录起点，捕获指针。 */
			const onPointerDown = (0, react.useCallback)((event) => {
				if (event.button !== 0) return;
				dragStart.current = {
					x: event.clientX,
					y: event.clientY,
					left: pos.left,
					top: pos.top
				};
				setDragging(true);
				event.currentTarget.setPointerCapture(event.pointerId);
			}, [pos]);
			/** 拖拽移动：按位移更新位置，并限制在视口内。 */
			const onPointerMove = (0, react.useCallback)((event) => {
				const start = dragStart.current;
				if (start === null) return;
				setPos({
					left: clamp(start.left + event.clientX - start.x, 0, Math.max(0, window.innerWidth - 64)),
					top: clamp(start.top + event.clientY - start.y, 0, Math.max(0, window.innerHeight - 32))
				});
			}, []);
			/** 拖拽结束：持久化位置。 */
			const onPointerUp = (0, react.useCallback)((event) => {
				if (dragStart.current === null) return;
				dragStart.current = null;
				setDragging(false);
				event.currentTarget.releasePointerCapture(event.pointerId);
				setPos((current) => {
					savePos(current);
					return current;
				});
			}, []);
			/** 将一条反馈真正发射到共同轨道。 */
			const emit = (0, react.useCallback)((pending) => {
				const { text, color, kind, label } = pending;
				const id = ++animId.current;
				const next = {
					text,
					color,
					damageKind: kind,
					label
				};
				setAnims((list) => [...list, {
					id,
					...next
				}].slice(-3));
				setFlash(color);
				setDamageKind(kind);
				setDipKey((key) => key + 1);
				if (flashTimer.current !== void 0) clearTimeout(flashTimer.current);
				flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
				const timer = setTimeout(() => {
					animTimers.current.delete(timer);
					setAnims((list) => list.filter((anim) => anim.id !== id));
				}, kind === "miss" ? MISS_FLOAT_MS : FLOAT_MS);
				animTimers.current.add(timer);
			}, []);
			/** FIFO 发射器：首条立即出现，后续每 200ms 错峰发射。 */
			const drainQueue = (0, react.useCallback)(function drain() {
				const next = animQueue.current.shift();
				if (next === void 0) {
					queueTimer.current = void 0;
					return;
				}
				emit(next);
				queueTimer.current = setTimeout(drain, FLOAT_EMIT_INTERVAL_MS);
			}, [emit]);
			/** 将反馈加入共同轨道队列，连续触发时保持可辨识的部分覆盖。 */
			const trigger = (0, react.useCallback)((text, color, kind = "normal", label) => {
				animQueue.current.push({
					text,
					color,
					kind,
					label
				});
				if (queueTimer.current === void 0 && animQueue.current.length === 1) drainQueue();
			}, [drainQueue]);
			(0, react.useEffect)(() => () => {
				if (flashTimer.current !== void 0) clearTimeout(flashTimer.current);
				if (queueTimer.current !== void 0) clearTimeout(queueTimer.current);
				animTimers.current.forEach((timer) => clearTimeout(timer));
				animTimers.current.clear();
				animQueue.current = [];
			}, []);
			(0, react.useEffect)(() => {
				const update = () => setIsPeak(isPeakNow());
				const timer = setInterval(update, 3e4);
				return () => clearInterval(timer);
			}, []);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const poll = async () => {
					try {
						const res = await fetch(`/api/token-monitor/charge-events?since=${chargeSeq.current}`, { cache: "no-store" });
						if (!res.ok) return;
						const data = await res.json();
						if (!chargeSeeded.current) {
							chargeSeeded.current = true;
							chargeSeq.current = data.seq;
							return;
						}
						chargeSeq.current = data.seq;
						const events = data.events ?? [];
						if (events.length === 0) return;
						const total = events.reduce((sum, event) => sum + event.cost, 0);
						const components = {
							hit: 0,
							miss: 0,
							output: 0
						};
						let hasBreakdown = true;
						for (const event of events) {
							const b = event.breakdown;
							if (b === void 0) {
								hasBreakdown = false;
								break;
							}
							const hit = Number(b.cacheHit?.cost ?? 0);
							const miss = Number(b.cacheMiss?.cost ?? 0);
							const output = Number(b.output?.cost ?? 0);
							if (![
								hit,
								miss,
								output,
								event.cost
							].every(Number.isFinite) || hit < 0 || miss < 0 || output < 0) {
								hasBreakdown = false;
								break;
							}
							const sum = hit + miss + output;
							if (Math.abs(sum - event.cost) > Math.max(1e-9, Math.abs(event.cost) * 1e-6)) {
								hasBreakdown = false;
								break;
							}
							components.hit += hit;
							components.miss += miss;
							components.output += output;
						}
						if (!hasBreakdown) {
							components.hit = 0;
							components.miss = 0;
							components.output = 0;
						}
						const mergedDamageKind = hasBreakdown ? components.miss > 0 ? "miss" : "normal" : events.some((event) => event.damageKind === "miss") ? "miss" : "normal";
						if (cancelled) return;
						setDisplay((prev) => prev === null ? null : prev - total);
						if (hasBreakdown) {
							if (components.hit > 0) trigger(`-${fmtCost(components.hit)}¥`, "red", "normal", "命中");
							if (components.output > 0) trigger(`-${fmtCost(components.output)}¥`, "red", "output", "输出");
							if (components.miss > 0) trigger(`-${fmtCost(components.miss)}¥`, "red", "miss", "未命中");
						} else trigger(`-${fmtCost(total)}¥`, "red", mergedDamageKind);
					} catch {}
				};
				poll();
				const timer = setInterval(() => void poll(), CHARGE_POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [trigger]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const poll = async () => {
					try {
						const res = await fetch("/api/token-monitor/balance", { cache: "no-store" });
						if (!res.ok) {
							if (!cancelled) setError(true);
							return;
						}
						const data = await res.json();
						if (cancelled) return;
						setBalanceInfo(data);
						setError(false);
						if (data !== null) setDisplay((prev) => {
							if (prev !== null && data.totalBalance > prev + 1e-9) trigger(`+${fmtCost(data.totalBalance - prev)}¥`, "green");
							return data.totalBalance;
						});
					} catch {
						if (!cancelled) setError(true);
					}
				};
				poll();
				const timer = setInterval(() => void poll(), BALANCE_POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [trigger]);
			if (balanceInfo === void 0) return null;
			if (balanceInfo === null || error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: CARD,
				"data-token-monitor-balance": "",
				children: "余额：未配置 API Key 或查询失败"
			});
			const amountColor = flash === "red" ? RED : flash === "green" ? GREEN : "var(--dsh-color-accent, #4c8dff)";
			const shown = display ?? balanceInfo.totalBalance;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...CARD,
					left: pos.left,
					top: pos.top,
					cursor: dragging ? "grabbing" : "grab"
				},
				"data-token-monitor-balance": "",
				title: "DeepSeek 账户余额（扣费实时、余额 60s 校准；可拖动）",
				onPointerDown,
				onPointerMove,
				onPointerUp,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: KEYFRAMES }),
					"余额",
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							position: "relative",
							display: "inline-block"
						},
						children: [anims.map((anim) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: anim.damageKind === "miss" ? "tkm-miss-float" : "tkm-impact-float",
							style: {
								...FLOAT,
								color: anim.color,
								display: anim.damageKind === "miss" ? "flex" : void 0,
								alignItems: anim.damageKind === "miss" ? "baseline" : void 0,
								gap: anim.damageKind === "miss" ? 5 : void 0,
								fontSize: anim.damageKind === "miss" ? 23 : anim.damageKind === "output" ? 13 : FLOAT.fontSize,
								fontWeight: anim.damageKind === "miss" ? 800 : anim.damageKind === "output" ? 600 : FLOAT.fontWeight,
								opacity: anim.damageKind === "output" ? .72 : void 0,
								animation: anim.damageKind === "miss" ? "tkm-miss-float 1250ms cubic-bezier(.15,.88,.22,1) forwards" : FLOAT.animation,
								textShadow: anim.damageKind === "miss" ? "0 1px 3px rgba(0,0,0,0.72), 0 0 10px rgba(255,59,48,0.55)" : FLOAT.textShadow
							},
							children: [anim.label !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: RED,
									fontSize: anim.damageKind === "output" ? 10 : 11,
									fontWeight: anim.damageKind === "output" ? 700 : 800,
									marginRight: anim.damageKind === "miss" ? 0 : 4
								},
								children: anim.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: anim.text })]
						}, anim.id)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: damageKind === "miss" ? "tkm-balance-miss" : "tkm-balance-hit",
							style: {
								fontWeight: 700,
								fontVariantNumeric: "tabular-nums",
								display: "inline-block",
								color: amountColor,
								transition: "color 0.25s ease",
								animation: damageKind === "miss" ? "tkm-balance-miss 620ms cubic-bezier(.2,.86,.25,1)" : "tkm-balance-hit 440ms cubic-bezier(.2,.9,.25,1)"
							},
							children: [
								balanceInfo.currency,
								" ",
								shown.toFixed(2)
							]
						}, dipKey)]
					}),
					balanceInfo.grantedBalance > 0 ? ` · 赠送 ${balanceInfo.grantedBalance.toFixed(2)}` : "",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontWeight: 700,
							marginLeft: 6,
							color: isPeak ? RED : GREEN,
							textShadow: isPeak ? "0 0 6px rgba(255,59,48,0.9), 0 0 14px rgba(255,59,48,0.55)" : "0 0 6px rgba(48,164,108,0.9), 0 0 14px rgba(48,164,108,0.55)",
							transition: "color 0.3s ease, text-shadow 0.3s ease"
						},
						children: isPeak ? "峰" : "谷"
					})
				]
			});
		}
		//#endregion
		//#region packages/client/ui-token-monitor/src/client/index.ts
		/** 依赖 slots；Conversation 事件注册兼容 dsh 新旧服务名。 */
		const inject = ["slots"];
		/**
		* 当前会话上报组件（不可见）：把当前选中的会话 id 写入
		* document.body.dataset.dshActiveSession，供桌面标题栏「打印小票」定位会话。
		*/
		const ActiveSessionReporter = (0, react.memo)(function ActiveSessionReporter({ sessionId }) {
			(0, react.useEffect)(() => {
				const id = sessionId === void 0 || sessionId === null ? "" : String(sessionId);
				if (id !== "") document.body.dataset.dshActiveSession = id;
				return () => {
					if (id !== "" && document.body.dataset.dshActiveSession === id) delete document.body.dataset.dshActiveSession;
				};
			}, [sessionId]);
			return null;
		});
		function apply(ctx) {
			// dsh <= 0.1.1 exposes conversationEvents directly; dsh >= 0.1.2
			// exposes the registry as uiConversation.events.
			const conversationEvents = ctx.get("uiConversation")?.events || ctx.get("conversationEvents");
			if (conversationEvents && typeof conversationEvents.register === "function") {
				conversationEvents.register(tokenUsageNodeDefinition);
			}
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "token-usage"
			}, UsageNodeView));
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "token-monitor-stats",
				order: 0
			}, SessionStatsBar));
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "token-monitor-active-session",
				order: 1e4
			}, ActiveSessionReporter));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "token-monitor-balance"
			}, BalanceWidget));
		}
		//#endregion
		exports.ActiveSessionReporter = ActiveSessionReporter;
		exports.BalanceWidget = BalanceWidget;
		exports.SessionStatsBar = SessionStatsBar;
		exports.UsageNodeView = UsageNodeView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
