/**
 * ============================================================================
 * 工具函数 - github-validators
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/utils
 */


export interface ValidationResult {
  valid: boolean;
  error?: { code: string; message: string };
}

/** GitHub username/organization 正则(最多 39 字符,允许字母、数字、连字符、下划线、点号) */
const OWNER_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

/** GitHub 仓库名正则(最多 100 字符) */
const REPO_REGEX = /^[a-zA-Z0-9._-]{1,100}$/;

function fail(code: string, message: string): ValidationResult {
  return { valid: false, error: { code, message } };
}

function ok(): ValidationResult {
  return { valid: true };
}

/** 校验 owner */
/**
 * 校验Owner
 *
 * @param owner - 参数(unknown)
 * @returns 返回值(ValidationResult)
 */
export function validateOwner(owner: unknown): ValidationResult {
  if (!owner || typeof owner !== "string") {
    return fail("MISSING_OWNER", "请提供仓库所有者(owner)");
  }
  if (owner.length > 39) {
    return fail("OWNER_TOO_LONG", "仓库所有者名称不能超过 39 个字符");
  }
  if (!OWNER_REGEX.test(owner)) {
    return fail("INVALID_OWNER", "仓库所有者名称格式不正确");
  }
  return ok();
}

/** 校验 repo */
/**
 * 校验Repo
 *
 * @param repo - 参数(unknown)
 * @returns 返回值(ValidationResult)
 */
export function validateRepo(repo: unknown): ValidationResult {
  if (!repo || typeof repo !== "string") {
    return fail("MISSING_REPO", "请提供仓库名称(repo)");
  }
  if (repo.length > 100) {
    return fail("REPO_TOO_LONG", "仓库名称不能超过 100 个字符");
  }
  if (!REPO_REGEX.test(repo)) {
    return fail("INVALID_REPO", "仓库名称只能包含字母、数字、连字符、下划线和点号");
  }
  return ok();
}

/** 校验 owner + repo 组合 */
export function validateOwnerRepo(
  owner: unknown,
  repo: unknown
): ValidationResult {
  const o = validateOwner(owner);
  if (!o.valid) return o;
  return validateRepo(repo);
}

/** 校验文件/目录路径(禁止目录遍历) */
export function validatePath(path: unknown): ValidationResult {
  if (typeof path !== "string") {
    return fail("INVALID_PATH", "路径必须是字符串");
  }
  if (path.includes("..") || path.startsWith("/")) {
    return fail("PATH_TRAVERSAL", "路径中不能包含 '..' 或以 '/' 开头");
  }
  return ok();
}

/** 校验分支/标签名 */
/**
 * 校验Ref
 *
 * @param ref - 参数(unknown)
 * @returns 返回值(ValidationResult)
 */
export function validateRef(ref: unknown): ValidationResult {
  if (typeof ref !== "string") return ok(); // 可选参数
  if (ref.length > 255) {
    return fail("REF_TOO_LONG", "分支/标签名不能超过 255 个字符");
  }
  return ok();
}

/** 校验 Issue/PR number */
/**
 * 校验Number
 *
 * @param num - 参数(unknown)
 * @returns 返回值(ValidationResult)
 */
export function validateNumber(num: unknown): ValidationResult {
  if (typeof num !== "number" || !Number.isInteger(num) || num < 1) {
    return fail("INVALID_NUMBER", "编号必须是正整数");
  }
  return ok();
}

/** 校验搜索查询 */
/**
 * 校验Query
 *
 * @param query - 参数(unknown)
 * @returns 返回值(ValidationResult)
 */
export function validateQuery(query: unknown): ValidationResult {
  if (!query || typeof query !== "string") {
    return fail("MISSING_QUERY", "请提供搜索关键词");
  }
  if (query.length > 256) {
    return fail("QUERY_TOO_LONG", "搜索关键词不能超过 256 个字符");
  }
  return ok();
}

/** 校验分页参数 */
/**
 * 校验PerPage
 *
 * @param perPage - 参数(unknown)
 * @param max - 参数
 * @returns 返回值(ValidationResult)
 */
export function validatePerPage(perPage: unknown, max = 100): ValidationResult {
  if (perPage === undefined) return ok();
  const n = typeof perPage === "string" ? parseInt(perPage) : perPage;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max) {
    return fail("INVALID_PER_PAGE", `每页数量必须在 1-${max} 之间`);
  }
  return ok();
}
