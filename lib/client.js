window.__ModuleLoader__.load({
	id: "dsh-git-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		const FALLBACK = {
			ok: false,
			error: {
				code: "internal",
				message: "Git history service is unavailable"
			}
		};
		/** 向插件宿主路由发送同源 JSON 请求，并将传输异常折叠为稳定错误。 */
		async function post(route, body, signal) {
			try {
				const value = await (await fetch(route, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					...signal === void 0 ? {} : { signal }
				})).json();
				if (value !== null && typeof value === "object" && "ok" in value) return value;
				return FALLBACK;
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
				return FALLBACK;
			}
		}
		/** 读取仓库树；fetch 为 true 时先更新远程跟踪引用。 */
		function readRepositorySnapshot(path, fetchRemote, signal) {
			return post("/api/dsh-git-history/snapshot", {
				path,
				fetch: fetchRemote
			}, signal);
		}
		/** 分页读取指定仓库的提交历史。 */
		function readHistory(request, signal) {
			return post("/api/dsh-git-history/log", request, signal);
		}
		//#endregion
		//#region src/client/GitHistoryView.tsx
		const PAGE_SIZE = 20;
		/** 以深度优先顺序展开仓库树，供选中仓库失效时寻找回退项。 */
		function flattenRepositories(repository) {
			return [repository, ...repository.children.flatMap(flattenRepositories)];
		}
		/** 在最新仓库树中按服务端生成的稳定标识查找节点。 */
		function findRepository(repository, id) {
			if (repository === null) return null;
			if (repository.id === id) return repository;
			for (const child of repository.children) {
				const match = findRepository(child, id);
				if (match !== null) return match;
			}
			return null;
		}
		/** 将提交时间格式化为紧凑的本地相对时间或日期。 */
		function formatDate(value) {
			const date = new Date(value);
			const elapsed = Date.now() - date.getTime();
			const hours = Math.floor(elapsed / 36e5);
			const days = Math.floor(elapsed / 864e5);
			if (hours < 1) return "刚刚";
			if (hours < 24) return `${hours} 小时前`;
			if (days < 7) return `${days} 天前`;
			return new Intl.DateTimeFormat(void 0, {
				year: "numeric",
				month: "2-digit",
				day: "2-digit"
			}).format(date);
		}
		/** 渲染递归仓库节点，并保持子模块的树状缩进。 */
		function RepositoryTree({ repository, selectedId, depth, onSelect, t }) {
			const selected = repository.id === selectedId;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dghTreeNode",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: `dghRepository ${selected ? "dghRepositoryActive" : ""}`,
					style: { paddingLeft: `${12 + depth * 18}px` },
					onClick: () => repository.initialized && onSelect(repository),
					disabled: !repository.initialized,
					title: repository.path || repository.name,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dghTreeGuide",
							"aria-hidden": "true",
							children: depth === 0 ? "◆" : "└"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dghRepositoryName",
							children: repository.name
						}),
						!repository.initialized && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dghMuted",
							children: t("uninitialized")
						}),
						repository.initialized && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dghBranch",
							title: repository.tracking ?? t("noUpstream"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "⑂"
								}),
								" ",
								repository.branch ?? t("noBranch")
							]
						}),
						repository.ahead > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dghAhead",
							title: t("ahead", { count: repository.ahead }),
							children: [repository.ahead, " ↑"]
						}),
						repository.behind > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dghBehind",
							title: t("behind", { count: repository.behind }),
							children: [repository.behind, " ↓"]
						}),
						repository.fetchError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dghFetchError",
							title: repository.fetchError,
							children: "!"
						})
					]
				}), repository.children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RepositoryTree, {
					repository: child,
					selectedId,
					depth: depth + 1,
					onSelect,
					t
				}, child.id))]
			});
		}
		/** 渲染一个提交条目及其作者、时间、引用和短哈希。 */
		function CommitRow({ commit }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: "dghCommit",
				title: `${commit.hash}\n${commit.authorName} <${commit.authorEmail}>`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dghCommitDot",
					"aria-hidden": "true"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dghCommitBody",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dghCommitTitle",
							children: commit.subject
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dghCommitMeta",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: commit.authorName }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "·"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
									dateTime: commit.date,
									children: formatDate(commit.date)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: commit.shortHash })
							]
						}),
						commit.refs.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dghRefs",
							children: commit.refs.map((ref) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: ref.replace(/^HEAD ->\s*/u, "").replace(/^tag:\s*/u, "") }, ref))
						})
					]
				})]
			});
		}
		/** 提供当前会话工作区的仓库树和可切换分页提交历史。 */
		function GitHistoryView(props) {
			const { sessionId, useSessions, t } = props;
			const cwd = useSessions((state) => state.byId[sessionId]?.cwd);
			const [repository, setRepository] = (0, react.useState)(null);
			const [selectedId, setSelectedId] = (0, react.useState)("");
			const [commits, setCommits] = (0, react.useState)([]);
			const [hasMore, setHasMore] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(false);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [historyLoading, setHistoryLoading] = (0, react.useState)(false);
			const [loadingMore, setLoadingMore] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [historyError, setHistoryError] = (0, react.useState)(null);
			const selectedRepository = (0, react.useMemo)(() => findRepository(repository, selectedId), [repository, selectedId]);
			/** 读取本地快照，并可选在后台 fetch 后刷新远程同步计数。 */
			const loadSnapshot = (0, react.useCallback)(async (fetchRemote, signal) => {
				if (cwd === void 0 || cwd === "") return;
				fetchRemote ? setRefreshing(true) : setLoading(true);
				setError(null);
				const result = await readRepositorySnapshot(cwd, fetchRemote, signal);
				if (result.ok) {
					setRepository(result.value.repository);
					setSelectedId((current) => {
						return findRepository(result.value.repository, current)?.initialized === true ? current : flattenRepositories(result.value.repository).find((item) => item.initialized)?.id ?? "";
					});
				} else setError(result.error.message);
				fetchRemote ? setRefreshing(false) : setLoading(false);
			}, [cwd]);
			(0, react.useEffect)(() => {
				setRepository(null);
				setSelectedId("");
				setCommits([]);
				setHasMore(false);
				if (cwd === void 0 || cwd === "") return;
				const controller = new AbortController();
				loadSnapshot(false, controller.signal).then(() => loadSnapshot(true, controller.signal)).catch((cause) => {
					if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(String(cause));
				});
				return () => controller.abort();
			}, [cwd, loadSnapshot]);
			(0, react.useEffect)(() => {
				if (cwd === void 0 || cwd === "" || selectedRepository === null || !selectedRepository.initialized) return;
				const controller = new AbortController();
				setHistoryLoading(true);
				setHistoryError(null);
				setCommits([]);
				readHistory({
					path: cwd,
					repositoryId: selectedRepository.id,
					skip: 0,
					limit: PAGE_SIZE
				}, controller.signal).then((result) => {
					if (result.ok) {
						setCommits(result.value.commits);
						setHasMore(result.value.hasMore);
					} else setHistoryError(result.error.message);
					setHistoryLoading(false);
				}).catch((cause) => {
					if (!(cause instanceof DOMException && cause.name === "AbortError")) setHistoryError(String(cause));
					setHistoryLoading(false);
				});
				return () => controller.abort();
			}, [cwd, selectedRepository?.id]);
			/** 追加下一页历史，同时避免并发重复加载。 */
			const loadMore = (0, react.useCallback)(async () => {
				if (cwd === void 0 || cwd === "" || selectedRepository === null || loadingMore || !hasMore) return;
				setLoadingMore(true);
				const result = await readHistory({
					path: cwd,
					repositoryId: selectedRepository.id,
					skip: commits.length,
					limit: PAGE_SIZE
				});
				if (result.ok) {
					setCommits((current) => [...current, ...result.value.commits]);
					setHasMore(result.value.hasMore);
				} else setHistoryError(result.error.message);
				setLoadingMore(false);
			}, [
				commits.length,
				cwd,
				hasMore,
				loadingMore,
				selectedRepository
			]);
			if (cwd === void 0 || cwd === "") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dghState",
				children: t("noWorkspace")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dghRoot",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "dghHeader",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("repositories") }), repository !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("commits", { count: commits.length }) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dghRefresh",
						disabled: refreshing || loading,
						onClick: () => void loadSnapshot(true),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: refreshing ? "dghSpin" : "",
							"aria-hidden": "true",
							children: "↻"
						}), refreshing ? t("refreshing") : t("refresh")]
					})]
				}), loading && repository === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dghState",
					children: t("loading")
				}) : error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dghState dghError",
					children: error
				}) : repository !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dghRepositories",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RepositoryTree, {
							repository,
							selectedId,
							depth: 0,
							onSelect: (item) => setSelectedId(item.id),
							t
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dghHistoryHeader",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("history") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: selectedRepository?.name }),
							selectedRepository?.fetchError !== null && selectedRepository?.fetchError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dghHistoryWarning",
								title: selectedRepository.fetchError,
								children: t("fetchFailed")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dghHistory",
						children: historyLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dghState",
							children: t("loadingHistory")
						}) : historyError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dghState dghError",
							children: historyError
						}) : commits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dghState",
							children: t("noHistory")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [commits.map((commit) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommitRow, { commit }, commit.hash)), hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dghLoadMore",
							disabled: loadingMore,
							onClick: () => void loadMore(),
							children: loadingMore ? t("loadingMore") : t("loadMore")
						})] })
					})
				] })]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			tab: "Git",
			repositories: "仓库",
			history: "提交历史",
			refresh: "刷新并 Fetch",
			refreshing: "正在 Fetch…",
			loading: "正在读取 Git 仓库…",
			loadingHistory: "正在读取提交历史…",
			noWorkspace: "当前会话没有工作区",
			noHistory: "当前仓库没有提交记录",
			uninitialized: "未初始化",
			noBranch: "未知分支",
			noUpstream: "未设置跟踪分支",
			fetchFailed: "Fetch 失败",
			loadMore: "加载更多",
			loadingMore: "正在加载…",
			ahead: "本地领先 {count} 个提交",
			behind: "本地落后 {count} 个提交",
			commits: "{count} 条提交"
		};
		const en = {
			tab: "Git",
			repositories: "Repositories",
			history: "Commit History",
			refresh: "Refresh and fetch",
			refreshing: "Fetching…",
			loading: "Reading Git repositories…",
			loadingHistory: "Reading commit history…",
			noWorkspace: "The current session has no workspace",
			noHistory: "No commits in this repository",
			uninitialized: "Not initialized",
			noBranch: "Unknown branch",
			noUpstream: "No upstream branch",
			fetchFailed: "Fetch failed",
			loadMore: "Load more",
			loadingMore: "Loading…",
			ahead: "{count} commits ahead",
			behind: "{count} commits behind",
			commits: "{count} commits"
		};
		//#endregion
		//#region src/client/styles.css?inline
		var styles_default = ".dghRoot {\n  box-sizing: border-box;\n  min-width: 0;\n  height: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  flex-direction: column;\n  display: flex;\n  overflow: hidden;\n}\n\n.dghRoot button {\n  font: inherit;\n}\n\n.dghHeader {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  justify-content: space-between;\n  align-items: center;\n  gap: 16px;\n  padding: 14px 18px;\n  display: flex;\n}\n\n.dghHeader > div {\n  min-width: 0;\n}\n\n.dghHeader h2, .dghHistoryHeader h3 {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  line-height: 22px;\n}\n\n.dghHeader > div > span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dghRefresh, .dghLoadMore {\n  min-height: 32px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: none;\n  border-radius: 8px;\n  justify-content: center;\n  align-items: center;\n  gap: 6px;\n  padding: 0 12px;\n  display: inline-flex;\n}\n\n.dghRefresh:hover:not(:disabled), .dghLoadMore:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghRefresh:disabled, .dghLoadMore:disabled {\n  cursor: default;\n  opacity: .55;\n}\n\n.dghRepositories {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  max-height: 36%;\n  padding: 6px 0;\n  overflow: auto;\n}\n\n.dghTreeNode {\n  min-width: max-content;\n}\n\n.dghRepository {\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 420px;\n  height: 34px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 8px;\n  padding-right: 14px;\n  display: flex;\n}\n\n.dghRepository:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghRepository:disabled {\n  cursor: default;\n  opacity: .6;\n}\n\n.dghRepositoryActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-interactive-bg-hover));\n}\n\n.dghTreeGuide {\n  width: 14px;\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  flex: none;\n}\n\n.dghRepositoryName {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 80px;\n  max-width: 280px;\n  font-size: 13px;\n  font-weight: 500;\n  overflow: hidden;\n}\n\n.dghBranch {\n  min-width: 0;\n  max-width: 180px;\n  color: var(--dsw-alias-label-tertiary);\n  font-family: var(--ds-font-family-code);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  align-items: center;\n  gap: 3px;\n  font-size: 11px;\n  display: inline-flex;\n  overflow: hidden;\n}\n\n.dghMuted {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n}\n\n.dghAhead {\n  color: var(--dsw-alias-state-success-primary);\n  font-family: var(--ds-font-family-code);\n  margin-left: auto;\n  font-size: 11px;\n}\n\n.dghBehind {\n  color: var(--dsw-alias-state-warn-label);\n  font-family: var(--ds-font-family-code);\n  font-size: 11px;\n}\n\n.dghFetchError {\n  width: 18px;\n  height: 18px;\n  color: var(--dsw-alias-state-error-primary);\n  border: 1px solid;\n  border-radius: 50%;\n  place-items: center;\n  font-size: 12px;\n  font-weight: 700;\n  display: grid;\n}\n\n.dghHistoryHeader {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 18px;\n  display: flex;\n}\n\n.dghHistoryHeader > span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dghHistoryHeader .dghHistoryWarning {\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.dghHistory {\n  flex: 1;\n  min-height: 0;\n  padding: 4px 16px 24px;\n  overflow: auto;\n}\n\n.dghCommit {\n  border-bottom: 1px solid var(--dsw-alias-border-l3);\n  gap: 12px;\n  min-width: 0;\n  padding: 10px 8px 10px 4px;\n  display: flex;\n  position: relative;\n}\n\n.dghCommit:before {\n  content: \"\";\n  background: var(--dsw-alias-border-l2);\n  width: 1px;\n  position: absolute;\n  top: 24px;\n  bottom: -12px;\n  left: 8px;\n}\n\n.dghCommit:last-of-type:before {\n  display: none;\n}\n\n.dghCommitDot {\n  z-index: 1;\n  background: var(--dsw-alias-bg-base);\n  border: 2px solid var(--dsw-alias-brand-primary, var(--dsw-alias-label-secondary));\n  border-radius: 50%;\n  flex: none;\n  width: 9px;\n  height: 9px;\n  margin-top: 5px;\n  position: relative;\n}\n\n.dghCommitBody {\n  flex: 1;\n  min-width: 0;\n}\n\n.dghCommitTitle {\n  color: var(--dsw-alias-label-primary);\n  overflow-wrap: anywhere;\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dghCommitMeta {\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  align-items: center;\n  gap: 7px;\n  margin-top: 2px;\n  font-size: 11px;\n  display: flex;\n}\n\n.dghCommitMeta > span:first-child {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  max-width: 180px;\n  overflow: hidden;\n}\n\n.dghCommitMeta code {\n  color: var(--dsw-alias-label-secondary);\n  font-family: var(--ds-font-family-code);\n  margin-left: auto;\n}\n\n.dghRefs {\n  flex-wrap: wrap;\n  gap: 5px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dghRefs span {\n  color: var(--dsw-alias-state-success-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n  border-radius: 999px;\n  padding: 1px 7px;\n  font-size: 10px;\n  line-height: 17px;\n}\n\n.dghState {\n  min-height: 140px;\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  place-items: center;\n  padding: 24px;\n  font-size: 13px;\n  display: grid;\n}\n\n.dghError {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dghLoadMore {\n  margin: 16px auto 0;\n  display: flex;\n}\n\n.dghSpin {\n  animation: .8s linear infinite dgh-spin;\n  display: inline-block;\n}\n\n@keyframes dgh-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@media (width <= 720px) {\n  .dghRepository {\n    min-width: 320px;\n  }\n\n  .dghRepositoryName {\n    max-width: 160px;\n  }\n\n  .dghBranch {\n    max-width: 110px;\n  }\n\n  .dghHeader {\n    padding-inline: 12px;\n  }\n}\n";
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale"];
		const NS = "git-history";
		/** 注册 Git 视图、双语词典和随插件生命周期释放的样式。 */
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.dshGitHistory = "";
				style.textContent = styles_default;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-git-history: styles");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-git-history: dictionaries");
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "git-history",
				order: 20,
				label: () => ctx.locale.bind(NS)("tab"),
				locale: NS
			}, GitHistoryView));
		}
		//#endregion
		exports.GitHistoryView = GitHistoryView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map