/**
 * ============================================================================
 * 工具函数 - github-error-translator
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/utils
 */


/**
 * ============================================================================
 * GitHub API 错误翻译器
 * ============================================================================
 *
 * 将 GitHub REST API 的英文错误响应翻译为中文友好提示. 
 * 从前端 `src/theme/tools/github/utils.ts` 下沉到后端,供所有后端模块复用. 
 */

export interface GitHubErrorTranslation {
  message: string;
  suggestion: string;
  code: number;
}

/**
 * 将 GitHub API 错误码翻译为用户友好的中文提示
 *
 * 覆盖的错误码: 
 * - 400: 请求格式错误
 * - 401: Token 无效或过期
 * - 403: 无权限访问、速率限制、SSO、账单、仓库归档、分支保护等
 * - 404: 仓库/资源不存在
 * - 405: 操作不被允许
 * - 406: 不接受该请求格式
 * - 409: 资源冲突(合并冲突、空仓库等)
 * - 410: 资源已被永久删除
 * - 415: 不支持的媒体类型
 * - 422: 参数验证失败(已存在、非法字符、配额不足等)
 * - 429: 请求过于频繁
 * - 451: 因法律原因不可用(DMCA)
 * - 500/502/503/504: GitHub 服务端错误
 */
export function translateGitHubError(errorMsg: string): GitHubErrorTranslation {
  const statusMatch = errorMsg.match(/(\d{3})/);
  const status = statusMatch ? parseInt(statusMatch[1]) : 0;
  const lower = errorMsg.toLowerCase();

  if (status === 400) {
    return {
      message: "请求格式错误",
      suggestion: "请检查 JSON 格式、字段类型或必填参数是否完整",
      code: status,
    };
  }

  if (status === 401) {
    return {
      message: "GitHub Token 无效或已过期",
      suggestion: "请检查是否配置了 GITHUB_TOKEN 环境变量,或 Token 是否已撤销/过期",
      code: status,
    };
  }

  if (status === 403) {
    if (lower.includes("rate limit") || lower.includes("api rate limit")) {
      return {
        message: "GitHub API 速率限制",
        suggestion: "未认证请求每小时 60 次限制,建议配置 GITHUB_TOKEN;如已配置,请等待配额重置或申请更高额度的 Token",
        code: status,
      };
    }
    if (lower.includes("secondary rate limit") || lower.includes("abuse detection")) {
      return {
        message: "触发 GitHub 滥用检测(二级速率限制)",
        suggestion: "请求过于密集,请降低并发频率,等待几分钟后重试",
        code: status,
      };
    }
    if (lower.includes("sso") || lower.includes("saml")) {
      return {
        message: "需要 SSO/SAML 认证",
        suggestion: "该组织要求 SSO 登录,请在 GitHub 网页端完成组织授权后再使用 Token",
        code: status,
      };
    }
    if (lower.includes("two-factor") || lower.includes("2fa")) {
      return {
        message: "需要两步验证(2FA)",
        suggestion: "该操作需要账户开启 2FA,请在 GitHub 设置中完成配置",
        code: status,
      };
    }
    if (lower.includes("billing") || lower.includes("payment") || lower.includes("quota")) {
      return {
        message: "账户额度或账单限制",
        suggestion: "可能超出私有仓库数量、Action 分钟数或存储配额,请检查 GitHub Billing 设置",
        code: status,
      };
    }
    if (lower.includes("archived")) {
      return {
        message: "仓库已归档,只读状态",
        suggestion: "归档仓库无法执行写入操作,如需修改请先取消归档(仅仓库所有者可操作)",
        code: status,
      };
    }
    if (lower.includes("branch protection") || lower.includes("protected branch")) {
      return {
        message: "分支受保护",
        suggestion: "该分支启用了保护规则,无法直接推送或删除,请通过 Pull Request 进行变更",
        code: status,
      };
    }
    if (lower.includes("blocked")) {
      return {
        message: "访问被阻止",
        suggestion: "该用户或仓库可能已被封禁,或你的账户被限制",
        code: status,
      };
    }
    if (lower.includes("resource not accessible by personal access token")) {
      return {
        message: "Token 权限不足",
        suggestion: "当前 Personal Access Token 缺少执行该操作所需的 scope(如 repo、workflow、delete_repo),请在 GitHub 设置中重新生成 Token 并授予对应权限",
        code: status,
      };
    }
    if (lower.includes("ip allowlist")) {
      return {
        message: "IP 不在白名单中",
        suggestion: "该组织启用了 IP 允许列表,请将当前服务器 IP 添加到组织的允许列表中",
        code: status,
      };
    }
    if (lower.includes("signature")) {
      return {
        message: "请求签名验证失败",
        suggestion: "Webhook 或 API 请求的签名不匹配,请检查密钥配置",
        code: status,
      };
    }
    return {
      message: "没有权限访问该资源",
      suggestion: "请检查 Token 是否有对应仓库/组织的访问权限(repo、workflow、delete_repo 等 scope)",
      code: status,
    };
  }

  if (status === 404) {
    return {
      message: "仓库或资源不存在",
      suggestion: "请检查 owner、repo、path、issue_number、pull_number 等参数是否正确,或该资源是否已被删除/转移",
      code: status,
    };
  }

  if (status === 405) {
    return {
      message: "操作不被允许",
      suggestion: "PR 可能已合并/已关闭,Issue 可能已锁定,或当前资源状态不支持该操作",
      code: status,
    };
  }

  if (status === 406) {
    return {
      message: "不接受的请求格式",
      suggestion: "请检查请求头中的 Accept 字段是否正确(如 application/vnd.github+json)",
      code: status,
    };
  }

  if (status === 409) {
    if (lower.includes("merge conflict") || lower.includes("conflict")) {
      return {
        message: "存在合并冲突",
        suggestion: "请在本地或 GitHub 网页端解决冲突后再尝试合并",
        code: status,
      };
    }
    if (lower.includes("empty") || lower.includes("git repository is empty")) {
      return {
        message: "Git 仓库为空",
        suggestion: "空仓库无法执行某些操作(如创建分支基于的 ref 不存在),请先推送初始提交",
        code: status,
      };
    }
    return {
      message: "资源冲突",
      suggestion: "可能存在合并冲突,或该资源已存在/已删除,请刷新状态后重试",
      code: status,
    };
  }

  if (status === 410) {
    return {
      message: "资源已被永久删除",
      suggestion: "该资源(如仓库、Issue、评论)已被硬删除,无法恢复",
      code: status,
    };
  }

  if (status === 415) {
    return {
      message: "不支持的媒体类型",
      suggestion: "请检查 Content-Type 请求头,确保使用 application/json 或正确的媒体类型",
      code: status,
    };
  }

  if (status === 422) {
    // GitHub 的 422 语义多样,需根据返回内容细分: 
    // - "already exists" / "name already exists" → 仓库/资源已存在(create_repo 时最常见)
    // - "is invalid" / "invalid" → 参数值无效(如非法字符)
    // - "missing" / "required" → 缺少必填字段
    // - "exceeded" / "over quota" / "limit" → 配额不足(如私有仓库数量上限)
    // - "archived" → 对归档仓库执行不允许的操作
    if (lower.includes("already exists") || lower.includes("name already exists")) {
      return {
        message: "资源已存在",
        suggestion: "请检查是否已存在同名仓库或资源,如需重新创建请先删除已有资源,或使用更新/查询工具操作现有资源",
        code: status,
      };
    }
    if (lower.includes("is invalid") || lower.includes("invalid") || lower.includes("contains invalid")) {
      return {
        message: "参数值无效",
        suggestion: "请检查参数格式(如仓库名只能包含字母、数字、连字符、下划线和点,不能以连字符开头或结尾)",
        code: status,
      };
    }
    if (lower.includes("missing") || lower.includes("required") || lower.includes("must include")) {
      return {
        message: "缺少必填参数",
        suggestion: "请对照 GitHub API 文档检查必填字段是否完整",
        code: status,
      };
    }
    if (lower.includes("exceeded") || lower.includes("over quota") || lower.includes("limit")) {
      return {
        message: "超出配额限制",
        suggestion: "可能超出私有仓库数量、协作者数量或其他配额,请检查 GitHub 账户计划或删除不必要的资源",
        code: status,
      };
    }
    if (lower.includes("archived")) {
      return {
        message: "归档仓库不支持此操作",
        suggestion: "该仓库已归档,如需执行此操作请先取消归档",
        code: status,
      };
    }
    if (lower.includes("reference already exists") || lower.includes("ref already exists")) {
      return {
        message: "引用已存在(分支或标签)",
        suggestion: "该分支名或标签名已存在,请更换名称或先删除已有引用",
        code: status,
      };
    }
    if (lower.includes("object does not exist") || lower.includes("no commit found for sha") || lower.includes("no match found for ref")) {
      return {
        message: "引用的对象不存在",
        suggestion: "请检查 SHA、分支名或引用路径是否正确,或该提交是否已被删除/重写",
        code: status,
      };
    }
    if (lower.includes("is not a member of")) {
      return {
        message: "用户不是组织成员",
        suggestion: "该用户不属于目标组织,无法执行此操作,请确认用户已加入组织",
        code: status,
      };
    }
    if (lower.includes("was not found") || lower.includes("could not be resolved")) {
      return {
        message: "请求的资源未找到",
        suggestion: "请检查参数是否正确,或该资源是否已被删除/转移",
        code: status,
      };
    }
    return {
      message: "请求参数验证失败",
      suggestion: "请检查参数格式是否符合 GitHub API 要求(如字段类型、枚举值、字符串长度等)",
      code: status,
    };
  }

  if (status === 429) {
    return {
      message: "请求过于频繁",
      suggestion: "已触发速率限制,请等待几分钟后重试",
      code: status,
    };
  }

  if (status === 451) {
    return {
      message: "因法律原因不可用(DMCA)",
      suggestion: "该资源因 DMCA 删除通知或其他法律原因被 GitHub 下架,无法访问",
      code: status,
    };
  }

  if (status === 500) {
    return {
      message: "GitHub 服务器内部错误",
      suggestion: "GitHub 服务端异常,请稍后重试",
      code: status,
    };
  }

  if (status === 502) {
    return {
      message: "GitHub 网关错误",
      suggestion: "GitHub 服务暂时不可用,请稍后重试",
      code: status,
    };
  }

  if (status === 503) {
    return {
      message: "GitHub 服务维护中",
      suggestion: "GitHub 可能正在进行维护,请稍后重试",
      code: status,
    };
  }

  if (status === 504) {
    return {
      message: "GitHub 网关超时",
      suggestion: "请求在 GitHub 服务端处理超时,请稍后重试或简化请求参数",
      code: status,
    };
  }

  return { message: errorMsg, suggestion: "请检查参数或稍后重试", code: status };
}
