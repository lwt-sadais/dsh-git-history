window.__ModuleLoader__.load({
	id: "dsh-git-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
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
		/** 读取指定提交的轻量文件清单。 */
		function readCommit(request, signal) {
			return post("/api/dsh-git-history/commit", request, signal);
		}
		/** 按服务端签发的文件标识读取提交中的单文件差异。 */
		function readCommitFile(request, signal) {
			return post("/api/dsh-git-history/commit-file", request, signal);
		}
		/** 按远端跟踪状态先 pull 后 push 同步指定仓库。 */
		function syncRepository(request, signal) {
			return post("/api/dsh-git-history/sync", request, signal);
		}
		//#endregion
		//#region src/client/GitHistoryView.tsx
		const PAGE_SIZE = 20;
		const DIFF_ROW_HEIGHT = 20;
		const DIFF_OVERSCAN = 20;
		const STATUS_KEYS = {
			modified: "statusModified",
			added: "statusAdded",
			deleted: "statusDeleted",
			renamed: "statusRenamed"
		};
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
		function RepositoryTree({ repository, selectedId, depth, onSelect, onSync, syncingId, t }) {
			const selected = repository.id === selectedId;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dghTreeNode",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `dghRepository ${selected ? "dghRepositoryActive" : ""}`,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dghRepositorySelect",
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
								})
							]
						}),
						(repository.ahead > 0 || repository.behind > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dghSync",
							disabled: syncingId !== null,
							onClick: () => onSync(repository),
							title: syncingId === repository.id ? t("syncing") : t("sync"),
							children: syncingId === repository.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dghSpin",
								"aria-hidden": "true",
								children: "↻"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [repository.ahead > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dghAhead",
								title: t("ahead", { count: repository.ahead }),
								children: [repository.ahead, " ↑"]
							}), repository.behind > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dghBehind",
								title: t("behind", { count: repository.behind }),
								children: [repository.behind, " ↓"]
							})] })
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
					onSync,
					syncingId,
					t
				}, child.id))]
			});
		}
		/** 渲染一个可打开详情的提交条目。 */
		function CommitRow({ commit, onOpen }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dghCommit",
				title: `${commit.hash}\n${commit.authorName} <${commit.authorEmail}>`,
				onClick: () => onOpen(commit),
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
		/** 将差异行类型映射为稳定样式名。 */
		function diffLineClass(line) {
			if (line.kind === "delete") return "dghDiffDelete";
			if (line.kind === "insert") return "dghDiffInsert";
			if (line.kind === "modify") return line.partnerKind === "delete" ? "dghDiffModifyDelete" : "dghDiffModifyInsert";
			if (line.kind === "empty") return "dghDiffEmpty";
			return "dghDiffEqual";
		}
		/** 虚拟渲染单侧差异，避免大文件一次创建全部 DOM 行。 */
		function DiffPane({ file, side, paneRef, onScroll }) {
			const [viewport, setViewport] = (0, react.useState)({
				scrollTop: 0,
				height: 0
			});
			const start = Math.max(0, Math.floor(viewport.scrollTop / DIFF_ROW_HEIGHT) - DIFF_OVERSCAN);
			const end = Math.min(file.rows.length, Math.ceil((viewport.scrollTop + viewport.height) / DIFF_ROW_HEIGHT) + DIFF_OVERSCAN);
			const update = () => {
				const pane = paneRef.current;
				if (pane !== null) setViewport({
					scrollTop: pane.scrollTop,
					height: pane.clientHeight
				});
			};
			(0, react.useEffect)(() => {
				const pane = paneRef.current;
				if (pane === null) return;
				update();
				const observer = new ResizeObserver(update);
				observer.observe(pane);
				return () => observer.disconnect();
			}, [file.id, paneRef]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: paneRef,
				className: "dghDiffPane",
				onScroll: () => {
					update();
					onScroll();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dghDiffRows",
					style: { height: `${file.rows.length * DIFF_ROW_HEIGHT}px` },
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dghDiffRowsVisible",
						style: { top: `${start * DIFF_ROW_HEIGHT}px` },
						children: file.rows.slice(start, end).map((row) => {
							const line = side === "before" ? row.left : row.right;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `dghDiffLine ${diffLineClass(line)}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dghDiffLineNo",
									children: line.lineNumber ?? ""
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dghDiffCode",
									children: line.text || " "
								})]
							}, row.index);
						})
					})
				})
			});
		}
		/** 展示一个提交相对第一父提交的按文件双栏差异。 */
		function CommitDetailDialog({ commit, detail, activeFileId, activeFile, loading, error, onSelect, onClose, t }) {
			const leftRef = (0, react.useRef)(null);
			const rightRef = (0, react.useRef)(null);
			const syncing = (0, react.useRef)(false);
			const sync = (source, target) => {
				if (source === null || target === null || syncing.current) return;
				syncing.current = true;
				target.scrollTop = source.scrollTop;
				target.scrollLeft = source.scrollLeft;
				requestAnimationFrame(() => {
					syncing.current = false;
				});
			};
			(0, react.useEffect)(() => {
				if (leftRef.current) {
					leftRef.current.scrollTop = 0;
					leftRef.current.scrollLeft = 0;
				}
				if (rightRef.current) {
					rightRef.current.scrollTop = 0;
					rightRef.current.scrollLeft = 0;
				}
			}, [activeFileId]);
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dghDetailOverlay",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": t("commitChanges"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dghDetailMask",
					onClick: onClose,
					"aria-label": t("close")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dghDetailPanel",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "dghDetailHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: commit.subject }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								commit.authorName,
								" · ",
								formatDate(commit.date),
								" · ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: commit.shortHash })
							] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dghClose",
								onClick: onClose,
								"aria-label": t("close"),
								children: "×"
							})]
						}),
						detail !== null && detail.parentHash !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dghParentNotice",
							children: t("firstParent")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dghDetailBody",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
								className: "dghCommitFiles",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dghCommitFilesTitle",
									children: t("changedFiles", { count: detail?.files.length ?? 0 })
								}), detail?.files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: `dghCommitFile ${activeFileId === file.id ? "dghCommitFileActive" : ""}`,
									onClick: () => onSelect(file),
									title: file.path,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `dghFileStatus dghFileStatus${file.status}`,
										children: t(STATUS_KEYS[file.status])
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}` })]
								}, file.id))]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("main", {
								className: "dghDiffMain",
								children: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dghState",
									children: t("loadingChanges")
								}) : error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dghState dghError",
									children: error
								}) : detail?.files.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dghState",
									children: t("noChanges")
								}) : activeFile === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dghState",
									children: t("selectFile")
								}) : activeFile.binary ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dghState",
									children: t("binary")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dghSelectedFile",
										title: activeFile.path,
										children: [activeFile.oldPath !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [activeFile.oldPath, " → "] }), activeFile.path]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dghDiffColumns",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("before") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("after") })]
									}),
									activeFile.truncated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dghDiffNotice",
										children: t("truncated")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dghDiffViewport",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffPane, {
												file: activeFile,
												side: "before",
												paneRef: leftRef,
												onScroll: () => sync(leftRef.current, rightRef.current)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffPane, {
												file: activeFile,
												side: "after",
												paneRef: rightRef,
												onScroll: () => sync(rightRef.current, leftRef.current)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dghDiffIndicator",
												"aria-hidden": "true",
												children: activeFile.markers.map((marker, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: marker.kind === "delete" ? "dghMarkerDelete" : "dghMarkerInsert",
													style: { top: `${marker.row / Math.max(1, activeFile.rows.length) * 100}%` }
												}, `${marker.row}-${marker.kind}-${index}`))
											})
										]
									})
								] })
							})]
						})
					]
				})]
			}), document.body);
		}
		/** 提供常驻工具栏入口，并在按需弹窗中展示仓库树和分页提交历史。 */
		function GitHistoryView(props) {
			const { sessionId, useSessions, t } = props;
			const cwd = useSessions((state) => state.byId[sessionId]?.cwd);
			const [open, setOpen] = (0, react.useState)(false);
			const [repository, setRepository] = (0, react.useState)(null);
			const [selectedId, setSelectedId] = (0, react.useState)("");
			const [commits, setCommits] = (0, react.useState)([]);
			const [hasMore, setHasMore] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(false);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [historyLoading, setHistoryLoading] = (0, react.useState)(false);
			const [loadingMore, setLoadingMore] = (0, react.useState)(false);
			const [syncingId, setSyncingId] = (0, react.useState)(null);
			const [historyRevision, setHistoryRevision] = (0, react.useState)(0);
			const [error, setError] = (0, react.useState)(null);
			const [syncMessage, setSyncMessage] = (0, react.useState)(null);
			const [syncError, setSyncError] = (0, react.useState)(null);
			const [historyError, setHistoryError] = (0, react.useState)(null);
			const [selectedCommit, setSelectedCommit] = (0, react.useState)(null);
			const [commitDetail, setCommitDetail] = (0, react.useState)(null);
			const [activeFileId, setActiveFileId] = (0, react.useState)(null);
			const [commitFiles, setCommitFiles] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [commitLoading, setCommitLoading] = (0, react.useState)(false);
			const [commitFileLoading, setCommitFileLoading] = (0, react.useState)(false);
			const [commitError, setCommitError] = (0, react.useState)(null);
			const selectedRepository = (0, react.useMemo)(() => findRepository(repository, selectedId), [repository, selectedId]);
			const activeCommitFile = activeFileId === null ? void 0 : commitFiles.get(activeFileId);
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
				if (!open) return;
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
			}, [
				cwd,
				loadSnapshot,
				open
			]);
			(0, react.useEffect)(() => {
				if (!open || cwd === void 0 || cwd === "" || selectedRepository === null || !selectedRepository.initialized) return;
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
			}, [
				cwd,
				historyRevision,
				open,
				selectedRepository?.id
			]);
			(0, react.useEffect)(() => {
				if (selectedCommit === null || cwd === void 0 || cwd === "" || selectedRepository === null) return;
				const controller = new AbortController();
				setCommitLoading(true);
				setCommitError(null);
				setCommitDetail(null);
				setActiveFileId(null);
				setCommitFiles(/* @__PURE__ */ new Map());
				readCommit({
					path: cwd,
					repositoryId: selectedRepository.id,
					commitHash: selectedCommit.hash
				}, controller.signal).then((result) => {
					if (result.ok) {
						setCommitDetail(result.value);
						setActiveFileId(result.value.files[0]?.id ?? null);
					} else setCommitError(result.error.message);
				}).catch((cause) => {
					if (!(cause instanceof DOMException && cause.name === "AbortError")) setCommitError(String(cause));
				}).finally(() => setCommitLoading(false));
				return () => controller.abort();
			}, [
				cwd,
				selectedCommit,
				selectedRepository?.id
			]);
			(0, react.useEffect)(() => {
				if (cwd === void 0 || cwd === "" || commitDetail === null || activeFileId === null || commitFiles.has(activeFileId)) return;
				const controller = new AbortController();
				setCommitFileLoading(true);
				setCommitError(null);
				readCommitFile({
					path: cwd,
					manifestId: commitDetail.manifestId,
					fileId: activeFileId
				}, controller.signal).then((result) => {
					if (result.ok) setCommitFiles((current) => new Map(current).set(result.value.id, result.value));
					else setCommitError(result.error.message);
				}).catch((cause) => {
					if (!(cause instanceof DOMException && cause.name === "AbortError")) setCommitError(String(cause));
				}).finally(() => setCommitFileLoading(false));
				return () => controller.abort();
			}, [
				activeFileId,
				commitDetail,
				commitFiles,
				cwd
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const close = (event) => {
					if (event.key !== "Escape") return;
					selectedCommit === null ? setOpen(false) : setSelectedCommit(null);
				};
				document.addEventListener("keydown", close);
				return () => document.removeEventListener("keydown", close);
			}, [open, selectedCommit]);
			/** 同步指定仓库，并在成功后刷新仓库计数和当前提交历史。 */
			const sync = (0, react.useCallback)(async (item) => {
				if (cwd === void 0 || cwd === "" || syncingId !== null) return;
				setSelectedId(item.id);
				setSyncingId(item.id);
				setSyncMessage(null);
				setSyncError(null);
				const result = await syncRepository({
					path: cwd,
					repositoryId: item.id
				});
				if (result.ok) {
					setSyncMessage(t("syncCompleted", {
						pulled: result.value.pulled,
						pushed: result.value.pushed
					}));
					await loadSnapshot(false);
					setHistoryRevision((current) => current + 1);
				} else setSyncError(result.error.message);
				setSyncingId(null);
			}, [
				cwd,
				loadSnapshot,
				syncingId,
				t
			]);
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dghDock",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dghLauncher",
						onClick: () => setOpen(true),
						"aria-label": t("tab"),
						title: t("tab"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dghLauncherIcon",
							"aria-hidden": "true",
							children: "⑂"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("tab") })]
					}),
					open && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dghOverlay",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("history"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dghMask",
							type: "button",
							onClick: () => setOpen(false),
							"aria-label": t("close")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dghPanel",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								className: "dghHeader",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("history") }), repository !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("commits", { count: commits.length }) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dghHeaderActions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dghRefresh",
										disabled: refreshing || loading || cwd === void 0 || cwd === "",
										onClick: () => void loadSnapshot(true),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: refreshing ? "dghSpin" : "",
											"aria-hidden": "true",
											children: "↻"
										}), refreshing ? t("refreshing") : t("refresh")]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dghClose",
										onClick: () => setOpen(false),
										"aria-label": t("close"),
										children: "×"
									})]
								})]
							}), cwd === void 0 || cwd === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dghState",
								children: t("noWorkspace")
							}) : loading && repository === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dghState",
								children: t("loading")
							}) : error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dghState dghError",
								children: error
							}) : repository !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dghContent",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
									className: "dghRepositories",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dghRepositoriesTitle",
										children: t("repositories")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RepositoryTree, {
										repository,
										selectedId,
										depth: 0,
										onSelect: (item) => setSelectedId(item.id),
										onSync: (item) => void sync(item),
										syncingId,
										t
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
									className: "dghMain",
									children: [
										syncMessage !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dghSyncMessage",
											children: syncMessage
										}),
										syncError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dghSyncMessage dghSyncMessageError",
											children: syncError
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
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [commits.map((commit) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommitRow, {
												commit,
												onOpen: setSelectedCommit
											}, commit.hash)), hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dghLoadMore",
												disabled: loadingMore,
												onClick: () => void loadMore(),
												children: loadingMore ? t("loadingMore") : t("loadMore")
											})] })
										})
									]
								})]
							})]
						})]
					}), document.body),
					selectedCommit !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommitDetailDialog, {
						commit: selectedCommit,
						detail: commitDetail,
						activeFileId,
						activeFile: activeCommitFile,
						loading: commitLoading || commitFileLoading,
						error: commitError,
						onSelect: (file) => setActiveFileId(file.id),
						onClose: () => setSelectedCommit(null),
						t
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			tab: "Git History",
			repositories: "仓库",
			history: "提交历史",
			close: "关闭",
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
			sync: "与远端同步",
			syncing: "正在同步…",
			syncCompleted: "同步完成：拉取 {pulled} 个、推送 {pushed} 个提交",
			commits: "{count} 条提交",
			commitChanges: "提交改动",
			changedFiles: "{count} 个改动文件",
			loadingChanges: "正在读取提交改动…",
			noChanges: "该提交没有文件改动",
			selectFile: "请选择文件查看改动",
			firstParent: "改动相对父提交比较；合并提交使用第一父提交",
			before: "修改前",
			after: "修改后",
			binary: "二进制文件无法作为文本比较",
			truncated: "文件较大，仅展示前 2 MiB",
			statusModified: "M",
			statusAdded: "A",
			statusDeleted: "D",
			statusRenamed: "R"
		};
		const en = {
			tab: "Git History",
			repositories: "Repositories",
			history: "Commit History",
			close: "Close",
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
			sync: "Sync with remote",
			syncing: "Syncing…",
			syncCompleted: "Sync completed: pulled {pulled}, pushed {pushed} commits",
			commits: "{count} commits",
			commitChanges: "Commit changes",
			changedFiles: "{count} changed files",
			loadingChanges: "Loading commit changes…",
			noChanges: "No file changes in this commit",
			selectFile: "Select a file to view changes",
			firstParent: "Changes are compared with the parent; merge commits use the first parent",
			before: "Before",
			after: "After",
			binary: "Binary files cannot be compared as text",
			truncated: "Large file: showing the first 2 MiB",
			statusModified: "M",
			statusAdded: "A",
			statusDeleted: "D",
			statusRenamed: "R"
		};
		//#endregion
		//#region src/client/styles.css?inline
		var styles_default = ".dghDock {\n  display: contents;\n}\n\n.dghDock button, .dghOverlay button {\n  font: inherit;\n}\n\n.dghLauncher {\n  width: auto;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  cursor: pointer;\n  white-space: nowrap;\n  background: none;\n  border: 0;\n  border-radius: 999px;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  gap: 5px;\n  padding: 0 8px 0 6px;\n  font-size: 12px;\n  font-weight: 500;\n  line-height: 20px;\n  display: inline-flex;\n}\n\n.dghLauncher:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghLauncherIcon {\n  place-items: center;\n  width: 16px;\n  height: 16px;\n  font-size: 16px;\n  line-height: 16px;\n  display: grid;\n}\n\n.dghOverlay, .dghOverlay * {\n  box-sizing: border-box;\n}\n\n.dghOverlay {\n  z-index: 1000;\n  justify-content: center;\n  align-items: center;\n  padding: 24px;\n  display: flex;\n  position: fixed;\n  inset: 0;\n}\n\n.dghMask {\n  backdrop-filter: blur(4px);\n  background: #05070c99;\n  border: 0;\n  position: absolute;\n  inset: 0;\n}\n\n.dghPanel {\n  width: min(1200px, 100vw - 48px);\n  height: min(820px, 100vh - 48px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  border: 1px solid var(--dsw-alias-border-l2);\n  box-shadow: var(--dsw-shadow-lv4);\n  border-radius: 16px;\n  flex-direction: column;\n  display: flex;\n  position: relative;\n  overflow: hidden;\n}\n\n.dghHeader {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  justify-content: space-between;\n  align-items: center;\n  gap: 16px;\n  height: 68px;\n  padding: 0 20px;\n  display: flex;\n}\n\n.dghHeader > div:first-child {\n  min-width: 0;\n}\n\n.dghHeader h2, .dghHistoryHeader h3 {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 22px;\n}\n\n.dghHeader > div:first-child > span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dghHeaderActions {\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dghRefresh, .dghLoadMore, .dghClose {\n  min-height: 32px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: none;\n  border-radius: 8px;\n  justify-content: center;\n  align-items: center;\n  gap: 6px;\n  padding: 0 12px;\n  display: inline-flex;\n}\n\n.dghClose {\n  width: 32px;\n  padding: 0;\n  font-size: 20px;\n}\n\n.dghRefresh:hover:not(:disabled), .dghLoadMore:hover:not(:disabled), .dghClose:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghRefresh:disabled, .dghLoadMore:disabled {\n  cursor: default;\n  opacity: .55;\n}\n\n.dghContent {\n  flex: 1;\n  grid-template-columns: minmax(280px, 34%) minmax(0, 1fr);\n  min-height: 0;\n  display: grid;\n}\n\n.dghRepositories {\n  border-right: 1px solid var(--dsw-alias-border-l2);\n  min-width: 0;\n  padding: 6px 0;\n  overflow: auto;\n}\n\n.dghRepositoriesTitle {\n  z-index: 2;\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-base);\n  border-bottom: 1px solid var(--dsw-alias-border-l3);\n  text-transform: uppercase;\n  padding: 8px 14px;\n  font-size: 11px;\n  font-weight: 600;\n  position: sticky;\n  top: -6px;\n}\n\n.dghTreeNode {\n  min-width: max-content;\n}\n\n.dghRepository {\n  width: 100%;\n  min-width: 390px;\n  height: 34px;\n  color: var(--dsw-alias-label-secondary);\n  align-items: center;\n  padding-right: 10px;\n  display: flex;\n}\n\n.dghRepository:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghRepositoryActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-interactive-bg-hover));\n}\n\n.dghRepositorySelect {\n  min-width: 0;\n  height: 100%;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 1;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dghRepositorySelect:disabled {\n  cursor: default;\n  opacity: .6;\n}\n\n.dghTreeGuide {\n  width: 14px;\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  flex: none;\n}\n\n.dghRepositoryName {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 70px;\n  max-width: 180px;\n  font-size: 13px;\n  font-weight: 500;\n  overflow: hidden;\n}\n\n.dghBranch {\n  min-width: 0;\n  max-width: 130px;\n  color: var(--dsw-alias-label-tertiary);\n  font-family: var(--ds-font-family-code);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  align-items: center;\n  gap: 3px;\n  font-size: 11px;\n  display: inline-flex;\n  overflow: hidden;\n}\n\n.dghMuted {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n}\n\n.dghSync {\n  cursor: pointer;\n  background: none;\n  border: 0;\n  border-radius: 6px;\n  justify-content: center;\n  align-items: center;\n  gap: 6px;\n  min-width: 42px;\n  min-height: 26px;\n  margin-left: auto;\n  padding: 0 5px;\n  display: inline-flex;\n}\n\n.dghSync:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghSync:disabled {\n  cursor: default;\n  opacity: .55;\n}\n\n.dghAhead {\n  color: var(--dsw-alias-state-success-primary);\n  font-family: var(--ds-font-family-code);\n  font-size: 11px;\n}\n\n.dghBehind {\n  color: var(--dsw-alias-state-warn-label);\n  font-family: var(--ds-font-family-code);\n  font-size: 11px;\n}\n\n.dghFetchError {\n  width: 18px;\n  height: 18px;\n  color: var(--dsw-alias-state-error-primary);\n  border: 1px solid;\n  border-radius: 50%;\n  place-items: center;\n  margin-left: 6px;\n  font-size: 12px;\n  font-weight: 700;\n  display: grid;\n}\n\n.dghMain {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.dghSyncMessage {\n  color: var(--dsw-alias-state-success-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  padding: 7px 18px;\n  font-size: 12px;\n}\n\n.dghSyncMessageError {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dghHistoryHeader {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 18px;\n  display: flex;\n}\n\n.dghHistoryHeader > span {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dghHistoryHeader .dghHistoryWarning {\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.dghHistory {\n  flex: 1;\n  min-height: 0;\n  padding: 4px 16px 24px;\n  overflow: auto;\n}\n\n.dghCommit {\n  width: 100%;\n  min-width: 0;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  border: 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l3);\n  background: none;\n  gap: 12px;\n  padding: 10px 8px 10px 4px;\n  display: flex;\n  position: relative;\n}\n\n.dghCommit:hover, .dghCommit:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: 0;\n}\n\n.dghCommit:before {\n  content: \"\";\n  background: var(--dsw-alias-border-l2);\n  width: 1px;\n  position: absolute;\n  top: 24px;\n  bottom: -12px;\n  left: 8px;\n}\n\n.dghCommit:last-of-type:before {\n  display: none;\n}\n\n.dghCommitDot {\n  z-index: 1;\n  background: var(--dsw-alias-bg-base);\n  border: 2px solid var(--dsw-alias-brand-primary, var(--dsw-alias-label-secondary));\n  border-radius: 50%;\n  flex: none;\n  width: 9px;\n  height: 9px;\n  margin-top: 5px;\n  position: relative;\n}\n\n.dghCommitBody {\n  flex: 1;\n  min-width: 0;\n}\n\n.dghCommitTitle {\n  color: var(--dsw-alias-label-primary);\n  overflow-wrap: anywhere;\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dghCommitMeta {\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  align-items: center;\n  gap: 7px;\n  margin-top: 2px;\n  font-size: 11px;\n  display: flex;\n}\n\n.dghCommitMeta > span:first-child {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  max-width: 180px;\n  overflow: hidden;\n}\n\n.dghCommitMeta code {\n  color: var(--dsw-alias-label-secondary);\n  font-family: var(--ds-font-family-code);\n  margin-left: auto;\n}\n\n.dghRefs {\n  flex-wrap: wrap;\n  gap: 5px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dghRefs span {\n  color: var(--dsw-alias-state-success-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n  border-radius: 999px;\n  padding: 1px 7px;\n  font-size: 10px;\n  line-height: 17px;\n}\n\n.dghState {\n  min-height: 140px;\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  flex: 1;\n  place-items: center;\n  padding: 24px;\n  font-size: 13px;\n  display: grid;\n}\n\n.dghError {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dghLoadMore {\n  margin: 16px auto 0;\n  display: flex;\n}\n\n.dghSpin {\n  animation: .8s linear infinite dgh-spin;\n  display: inline-block;\n}\n\n.dghDetailOverlay, .dghDetailOverlay * {\n  box-sizing: border-box;\n}\n\n.dghDetailOverlay {\n  z-index: 1010;\n  justify-content: center;\n  align-items: center;\n  padding: 24px;\n  display: flex;\n  position: fixed;\n  inset: 0;\n}\n\n.dghDetailMask {\n  backdrop-filter: blur(5px);\n  background: #05070cbb;\n  border: 0;\n  position: absolute;\n  inset: 0;\n}\n\n.dghDetailPanel {\n  width: min(1500px, 100vw - 48px);\n  height: min(900px, 100vh - 48px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  border: 1px solid var(--dsw-alias-border-l2);\n  box-shadow: var(--dsw-shadow-lv4);\n  border-radius: 16px;\n  flex-direction: column;\n  display: flex;\n  position: relative;\n  overflow: hidden;\n}\n\n.dghDetailHeader {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  justify-content: space-between;\n  align-items: center;\n  gap: 16px;\n  min-height: 68px;\n  padding: 10px 20px;\n  display: flex;\n}\n\n.dghDetailHeader > div {\n  min-width: 0;\n}\n\n.dghDetailHeader h2 {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  margin: 0;\n  font-size: 16px;\n  line-height: 23px;\n  overflow: hidden;\n}\n\n.dghDetailHeader p {\n  color: var(--dsw-alias-label-tertiary);\n  margin: 3px 0 0;\n  font-size: 12px;\n}\n\n.dghDetailHeader code {\n  font-family: var(--ds-font-family-code);\n}\n\n.dghParentNotice, .dghDiffNotice {\n  color: var(--dsw-alias-state-warn-label);\n  background: var(--dsw-alias-interactive-bg-hover);\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  padding: 6px 14px;\n  font-size: 11px;\n}\n\n.dghDetailBody {\n  flex: 1;\n  grid-template-columns: 280px minmax(0, 1fr);\n  min-height: 0;\n  display: grid;\n}\n\n.dghCommitFiles {\n  border-right: 1px solid var(--dsw-alias-border-l2);\n  min-width: 0;\n  overflow: auto;\n}\n\n.dghCommitFilesTitle {\n  z-index: 1;\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-base);\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  padding: 10px 12px;\n  font-size: 11px;\n  font-weight: 600;\n  position: sticky;\n  top: 0;\n}\n\n.dghCommitFile {\n  width: 100%;\n  min-height: 34px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 10px;\n  display: flex;\n}\n\n.dghCommitFile:hover, .dghCommitFileActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghCommitFile > span:last-child {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 0;\n  font-size: 12px;\n  overflow: hidden;\n}\n\n.dghFileStatus {\n  width: 20px;\n  height: 20px;\n  font-family: var(--ds-font-family-code);\n  border-radius: 5px;\n  flex: none;\n  place-items: center;\n  font-size: 11px;\n  font-weight: 700;\n  display: inline-grid;\n}\n\n.dghFileStatusmodified {\n  color: #c18b2f;\n  background: #c18b2f1f;\n}\n\n.dghFileStatusadded {\n  color: #2b9b62;\n  background: #2b9b621f;\n}\n\n.dghFileStatusdeleted {\n  color: #d55b5b;\n  background: #d55b5b1f;\n}\n\n.dghFileStatusrenamed {\n  color: #6f75d8;\n  background: #6f75d81f;\n}\n\n.dghDiffMain {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.dghSelectedFile {\n  min-height: 38px;\n  color: var(--dsw-alias-label-primary);\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  font-family: var(--ds-font-family-code);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  flex: none;\n  padding: 9px 12px;\n  font-size: 12px;\n  overflow: hidden;\n}\n\n.dghSelectedFile span {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dghDiffColumns {\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-base);\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  grid-template-columns: 1fr 1fr;\n  font-size: 11px;\n  display: grid;\n}\n\n.dghDiffColumns span {\n  padding: 6px 10px;\n}\n\n.dghDiffColumns span:first-child {\n  border-right: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dghDiffViewport {\n  flex: 1;\n  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 9px;\n  min-height: 0;\n  display: grid;\n  position: relative;\n}\n\n.dghDiffPane {\n  min-width: 0;\n  min-height: 0;\n  font-family: var(--ds-font-family-code);\n  font-size: 12px;\n  line-height: 20px;\n  overflow: auto;\n}\n\n.dghDiffPane:first-child {\n  border-right: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dghDiffRows {\n  min-width: max-content;\n  position: relative;\n}\n\n.dghDiffRowsVisible {\n  position: absolute;\n  left: 0;\n  right: 0;\n}\n\n.dghDiffLine {\n  white-space: pre;\n  height: 20px;\n  display: flex;\n}\n\n.dghDiffLineNo {\n  width: 52px;\n  color: var(--dsw-alias-label-tertiary);\n  background: inherit;\n  border-right: 1px solid var(--dsw-alias-border-l3);\n  text-align: right;\n  user-select: none;\n  flex: none;\n  padding-right: 8px;\n  display: inline-block;\n  position: sticky;\n  left: 0;\n}\n\n.dghDiffCode {\n  min-width: max-content;\n  padding: 0 10px;\n}\n\n.dghDiffDelete, .dghDiffModifyDelete {\n  background: #d55b5b1a;\n}\n\n.dghDiffInsert, .dghDiffModifyInsert {\n  background: #2b9b621a;\n}\n\n.dghDiffEmpty {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dghDiffIndicator {\n  background: var(--dsw-alias-bg-base);\n  border-left: 1px solid var(--dsw-alias-border-l2);\n  position: relative;\n}\n\n.dghDiffIndicator span {\n  width: 100%;\n  min-height: 2px;\n  display: block;\n  position: absolute;\n}\n\n.dghMarkerDelete {\n  background: #d55b5b;\n}\n\n.dghMarkerInsert {\n  background: #2b9b62;\n}\n\n@keyframes dgh-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@media (width <= 760px) {\n  .dghOverlay {\n    padding: 12px;\n  }\n\n  .dghPanel {\n    width: calc(100vw - 24px);\n    height: calc(100vh - 24px);\n  }\n\n  .dghContent {\n    grid-template-rows: minmax(130px, 34%) minmax(0, 1fr);\n    grid-template-columns: 1fr;\n  }\n\n  .dghRepositories {\n    border-right: 0;\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n  }\n\n  .dghRepository {\n    min-width: 320px;\n  }\n\n  .dghRepositoryName {\n    max-width: 150px;\n  }\n\n  .dghBranch {\n    max-width: 100px;\n  }\n\n  .dghHeader {\n    padding-inline: 12px;\n  }\n\n  .dghDetailOverlay {\n    padding: 12px;\n  }\n\n  .dghDetailPanel {\n    width: calc(100vw - 24px);\n    height: calc(100vh - 24px);\n  }\n\n  .dghDetailBody {\n    grid-template-columns: 210px minmax(0, 1fr);\n  }\n}\n";
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale"];
		const NS = "git-history";
		/** 注册输入框工具栏入口、双语词典和随插件生命周期释放的弹窗样式。 */
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
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "git-history",
				order: 3,
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