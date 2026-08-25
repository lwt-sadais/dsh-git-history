import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { isIP } from "node:net";
//#region src/host/git-service.ts
const MAX_REPOSITORIES = 128;
const MAX_OUTPUT_BYTES = 8388608;
const MAX_ERROR_BYTES = 262144;
const COMMAND_TIMEOUT_MS = 15e3;
const FIELD_SEPARATOR = "";
const RECORD_SEPARATOR = "";
/** 构造稳定的 API 失败结果，避免各调用点重复拼装错误结构。 */
function fail(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
}
/** 将 Git 输出的首行转换为可展示值，空输出统一视为未知。 */
function firstLine(value) {
	const line = value.trim().split(/\r?\n/u)[0];
	return line === void 0 || line === "" ? null : line;
}
/** 解析 .gitmodules 的路径配置，同时忽略畸形或空白记录。 */
function parseSubmodulePaths(stdout) {
	return stdout.split(/\r?\n/u).flatMap((line) => {
		const separator = line.search(/\s/u);
		if (separator < 0) return [];
		const path = line.slice(separator).trim();
		return path === "" ? [] : [path];
	});
}
/** 只允许解析仓库根目录之内的相对路径，阻断绝对路径和目录穿越。 */
function safeChild(root, path) {
	if (path === "" || isAbsolute(path) || path.includes("\0")) return null;
	const absolute = resolve(root, path);
	const rel = relative(root, absolute);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? absolute : null;
}
/** 拼接工作区相对的仓库标识，根仓库固定使用空字符串。 */
function childId(parentId, childPath) {
	return parentId === "" ? childPath : `${parentId}/${childPath}`;
}
/** 将 rev-list 的左右计数转换为 ahead 和 behind。 */
function parseAheadBehind(stdout) {
	const [aheadValue, behindValue] = stdout.trim().split(/\s+/u);
	return {
		ahead: Number.parseInt(aheadValue ?? "0", 10) || 0,
		behind: Number.parseInt(behindValue ?? "0", 10) || 0
	};
}
/** 解析使用不可见分隔符输出的 Git 日志，避免提交文本中的常见字符破坏字段。 */
function parseHistory(stdout) {
	return stdout.split(RECORD_SEPARATOR).flatMap((record) => {
		const value = record.replace(/^\r?\n/u, "").trimEnd();
		if (value === "") return [];
		const [hash, shortHash, date, subject, authorName, authorEmail, refs = ""] = value.split(FIELD_SEPARATOR);
		if (!hash || !shortHash || !date || subject === void 0 || authorName === void 0 || authorEmail === void 0) return [];
		return [{
			hash,
			shortHash,
			date,
			subject,
			authorName,
			authorEmail,
			refs: refs.split(",").map((ref) => ref.trim()).filter(Boolean)
		}];
	});
}
var GitHistoryService = class {
	runner;
	gate;
	repositories = /* @__PURE__ */ new Map();
	/** 创建服务并注入受控 Git 执行器和已注册工作区校验器。 */
	constructor(runner, gate) {
		this.runner = runner;
		this.gate = gate;
	}
	/** 探测仓库当前分支、跟踪分支和同步计数。 */
	async readIdentity(root, signal) {
		const branchResult = await this.runner.run([
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD"
		], root, signal);
		let branch = branchResult.exitCode === 0 ? firstLine(branchResult.stdout) : null;
		if (branch === null) {
			const head = await this.runner.run([
				"rev-parse",
				"--short",
				"HEAD"
			], root, signal);
			const shortHash = head.exitCode === 0 ? firstLine(head.stdout) : null;
			branch = shortHash === null ? null : `detached@${shortHash}`;
		}
		const upstreamResult = await this.runner.run([
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{upstream}"
		], root, signal);
		const tracking = upstreamResult.exitCode === 0 ? firstLine(upstreamResult.stdout) : null;
		if (tracking === null) return {
			branch,
			tracking: null,
			ahead: 0,
			behind: 0
		};
		const countResult = await this.runner.run([
			"rev-list",
			"--left-right",
			"--count",
			"HEAD...@{upstream}"
		], root, signal);
		const counts = countResult.exitCode === 0 ? parseAheadBehind(countResult.stdout) : {
			ahead: 0,
			behind: 0
		};
		return {
			branch,
			tracking,
			...counts
		};
	}
	/** 在明确请求时更新远程跟踪引用；失败仅记录在对应仓库节点上。 */
	async fetch(root, signal) {
		const result = await this.runner.run(["fetch", "--prune"], root, signal);
		if (result.exitCode === 0) return null;
		return (firstLine(result.stderr) ?? "git fetch failed").slice(0, 500);
	}
	/** 递归扫描一个已初始化仓库，并建立仅供当前工作区使用的仓库路径清单。 */
	async scanRepository(root, id, shouldFetch, budget, identities, signal) {
		signal?.throwIfAborted();
		budget.repositories += 1;
		if (budget.repositories > MAX_REPOSITORIES) throw new Error("repository limit exceeded");
		identities.set(id, root);
		const fetchError = shouldFetch ? await this.fetch(root, signal) : null;
		const identity = await this.readIdentity(root, signal);
		const modules = await this.runner.run([
			"config",
			"--file",
			".gitmodules",
			"--get-regexp",
			"^submodule\\..*\\.path$"
		], root, signal);
		const declaredPaths = modules.exitCode === 0 ? parseSubmodulePaths(modules.stdout) : [];
		const children = [];
		for (const path of declaredPaths) {
			const childRoot = safeChild(root, path);
			if (childRoot === null) continue;
			const childRepositoryId = childId(id, path);
			let initialized = false;
			try {
				const canonicalChild = await realpath(childRoot);
				const probe = await this.runner.run(["rev-parse", "--show-toplevel"], canonicalChild, signal);
				initialized = probe.exitCode === 0 && await realpath(probe.stdout.trim()) === canonicalChild;
			} catch {
				initialized = false;
			}
			if (initialized) children.push(await this.scanRepository(childRoot, childRepositoryId, shouldFetch, budget, identities, signal));
			else children.push({
				id: childRepositoryId,
				name: basename(path),
				path: childRepositoryId,
				initialized: false,
				branch: null,
				tracking: null,
				ahead: 0,
				behind: 0,
				fetchError: null,
				children: []
			});
		}
		return {
			id,
			name: basename(root),
			path: id,
			initialized: true,
			...identity,
			fetchError,
			children
		};
	}
	/** 读取当前工作区仓库树，并按需自动 fetch 根仓库及递归子模块。 */
	async snapshot(path, shouldFetch, signal) {
		const workspace = await this.gate.resolve(path);
		if (!workspace.ok) return workspace;
		const probe = await this.runner.run(["rev-parse", "--show-toplevel"], workspace.value, signal);
		if (probe.exitCode !== 0) return fail("not-git-repository", "workspace is not a Git repository");
		let root;
		try {
			root = await realpath(probe.stdout.trim());
			if (root !== workspace.value) return fail("workspace-unknown", "workspace must be the Git repository root");
		} catch {
			return fail("not-git-repository", "Git repository root is unavailable");
		}
		try {
			const identities = /* @__PURE__ */ new Map();
			const repository = await this.scanRepository(root, "", shouldFetch, { repositories: 0 }, identities, signal);
			this.repositories.set(root, identities);
			return {
				ok: true,
				value: {
					generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					repository
				}
			};
		} catch (cause) {
			if (cause instanceof Error && cause.name === "AbortError") throw cause;
			return fail("internal", "unable to read Git repositories");
		}
	}
	/** 分页读取服务端最近一次扫描确认过的仓库提交历史。 */
	async history(request, signal) {
		const workspace = await this.gate.resolve(request.path);
		if (!workspace.ok) return workspace;
		const root = this.repositories.get(workspace.value)?.get(request.repositoryId);
		if (root === void 0) return fail("repository-unknown", "repository is stale; refresh the Git view");
		const format = `%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%D${RECORD_SEPARATOR}`;
		const result = await this.runner.run([
			"--no-pager",
			"log",
			`--skip=${request.skip}`,
			`--max-count=${request.limit + 1}`,
			`--pretty=format:${format}`
		], root, signal);
		if (result.exitCode !== 0) return fail("internal", "unable to read Git history");
		const commits = parseHistory(result.stdout);
		return {
			ok: true,
			value: {
				commits: commits.slice(0, request.limit),
				hasMore: commits.length > request.limit
			}
		};
	}
};
/** 建立只承认 DSH Workspace Registry 中规范路径的访问门。 */
function createWorkspaceGate(workspaces) {
	return { async resolve(path) {
		let canonical;
		try {
			canonical = await realpath(path);
		} catch {
			return fail("workspace-unknown", "workspace path does not resolve");
		}
		return workspaces().some((workspace) => workspace.path === canonical) ? {
			ok: true,
			value: canonical
		} : fail("workspace-unknown", "path is not a registered workspace");
	} };
}
/** 将 DSH subprocess 能力适配为带超时、无交互凭据提示的 Git 执行器。 */
function subprocessRunner(ctx) {
	return { async run(argv, cwd, signal) {
		const timeoutSignal = AbortSignal.timeout(COMMAND_TIMEOUT_MS);
		const combinedSignal = signal === void 0 ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
		const handle = ctx.subprocess.spawn({
			argv: ["git", ...argv],
			cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: MAX_OUTPUT_BYTES },
				stderr: { maxBytes: MAX_ERROR_BYTES }
			},
			graceMs: 2e3,
			env: { GIT_TERMINAL_PROMPT: "0" },
			signal: combinedSignal
		});
		return {
			exitCode: (await handle.done).exitCode,
			stdout: handle.collected.stdout?.readFrom(0).text ?? "",
			stderr: handle.collected.stderr?.readFrom(0).text ?? ""
		};
	} };
}
//#endregion
//#region src/host/routes.ts
const SNAPSHOT_ROUTE = "/api/dsh-git-history/snapshot";
const HISTORY_ROUTE = "/api/dsh-git-history/log";
const BODY_CAP = 16384;
/** 仅接受来自当前 DSH 页面、回环地址且使用 JSON 的请求。 */
function allowed(req) {
	const address = req.socket.remoteAddress?.replace(/^::ffff:/u, "");
	if (address === void 0 || address !== "::1" && !(isIP(address) === 4 && address.startsWith("127."))) return false;
	const contentType = req.headers["content-type"];
	if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) return false;
	const origin = req.headers.origin;
	const host = req.headers.host;
	return typeof origin === "string" && typeof host === "string" && origin === `http://${host}`;
}
/** 读取有上限的 JSON 请求体，防止本地路由被大请求占用内存。 */
async function readBody(req) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > BODY_CAP) throw new Error("body too large");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
/** 将未知值缩窄为普通 JSON 对象。 */
function recordOf(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
/** 校验带长度上限的字符串字段。 */
function boundedString(value, allowEmpty = false) {
	return typeof value === "string" && value.length <= 4096 && (allowEmpty || value.length > 0) ? value : null;
}
/** 校验仓库树快照请求。 */
function snapshotRequestOf(value) {
	const record = recordOf(value);
	if (record === null || Object.keys(record).length !== 2) return null;
	const path = boundedString(record.path);
	return path === null || typeof record.fetch !== "boolean" ? null : {
		path,
		fetch: record.fetch
	};
}
/** 校验分页历史请求并限制分页参数范围。 */
function historyRequestOf(value) {
	const record = recordOf(value);
	if (record === null || Object.keys(record).length !== 4) return null;
	const path = boundedString(record.path);
	const repositoryId = boundedString(record.repositoryId, true);
	const skip = record.skip;
	const limit = record.limit;
	if (path === null || repositoryId === null || !Number.isSafeInteger(skip) || !Number.isSafeInteger(limit)) return null;
	if (skip < 0 || limit < 1 || limit > 100) return null;
	return {
		path,
		repositoryId,
		skip,
		limit
	};
}
/** 输出无缓存且禁止 MIME 嗅探的 JSON 响应。 */
function send(res, status, result) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.setHeader("x-content-type-options", "nosniff");
	res.end(JSON.stringify(result));
}
/** 注册一条具有统一鉴权、取消和错误处理的本地 POST API。 */
function registerRoute(ctx, route, parse, run) {
	return ctx.webServer.register({
		kind: "exact",
		path: route,
		handler: async (req, res) => {
			if (req.method !== "POST" || !allowed(req)) {
				send(res, 403, {
					ok: false,
					error: {
						code: "invalid-request",
						message: "local same-origin JSON POST required"
					}
				});
				return;
			}
			const controller = new AbortController();
			const abort = () => controller.abort();
			req.once("aborted", abort);
			res.once("close", abort);
			try {
				const value = parse(await readBody(req));
				if (value === null) {
					send(res, 400, {
						ok: false,
						error: {
							code: "invalid-request",
							message: "invalid Git history request"
						}
					});
					return;
				}
				const result = await run(value, controller.signal);
				if (!controller.signal.aborted && !res.destroyed) send(res, result.ok ? 200 : 400, result);
			} catch (cause) {
				if (!controller.signal.aborted && !res.destroyed) {
					ctx.logger.warn(`dsh-git-history: request failed: ${String(cause)}`);
					send(res, 500, {
						ok: false,
						error: {
							code: "internal",
							message: "Git history request failed"
						}
					});
				}
			} finally {
				req.off("aborted", abort);
				res.off("close", abort);
			}
		}
	});
}
/** 注册仓库树与提交历史 API，并返回按逆序释放的 disposer。 */
function registerRoutes(ctx, service) {
	const disposeSnapshot = registerRoute(ctx, SNAPSHOT_ROUTE, snapshotRequestOf, (request, signal) => service.snapshot(request.path, request.fetch, signal));
	const disposeHistory = registerRoute(ctx, HISTORY_ROUTE, historyRequestOf, (request, signal) => service.history(request, signal));
	return () => {
		disposeHistory();
		disposeSnapshot();
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-git-history";
const inject = [
	"webServer",
	"subprocess",
	"workspaceRegistry"
];
/** 组装工作区访问门、Git 服务和本地 API，并交由 Cordis 管理生命周期。 */
function apply(ctx) {
	const service = new GitHistoryService(subprocessRunner(ctx), createWorkspaceGate(() => ctx.workspaceRegistry.list()));
	ctx.effect(() => registerRoutes(ctx, service), "dsh-git-history: routes");
}
//#endregion
export { GitHistoryService, apply, inject, name, parseAheadBehind, parseHistory, parseSubmodulePaths };

//# sourceMappingURL=index.js.map