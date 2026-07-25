/**
 * 集成域 — feishu_*（从 integration.ts 拆出，P2-01 选 B）
 *
 * 飞书文档/知识库/电子表格/白板/权限/用户授权操作。
 */
import {
  feishuSendText,
  feishuSendMessage,
  feishuGetDoc,
  feishuCreateDoc,
  feishuUpdateDocBlocks,
  feishuUpdateDocTitle,
  feishuCreateDocChildren,
  feishuAppendDocText,
  feishuDeleteDoc,
  feishuSearchDocs,
  feishuGetWikiSpace,
  feishuGetWikiNodes,
  feishuCreateWikiNode,
  feishuCreateSpreadsheet,
  feishuAppendSpreadsheetValues,
  feishuListDocWhiteboards,
  feishuListWhiteboardNodes,
  feishuCreateWhiteboardNodes,
  feishuWhiteboardFromDiagram,
  feishuDeleteWhiteboardNodes,
  feishuGetWhiteboardTheme,
  feishuUpdateWhiteboardTheme,
  feishuListPermissionMembers,
  feishuAddPermissionMember,
  feishuUpdatePermissionMember,
  feishuRemovePermissionMember,
  feishuGetPermissionPublic,
  feishuUpdatePermissionPublic,
  feishuBatchGetUserIds,
  feishuAddCollaboratorByContact,
  getUserAccessTokenStatus,
  refreshUserAccessToken,
} from "../../../feishuClient.js";
import type { FeishuPermissionPublicPatch } from "../../../feishuClient.js";
import { getCredentialValue } from "../../../credentialVault.js";
import {
  authorizeUserViaBrowser,
  refreshTokenManually as refreshFileToken,
  getTokenStatus as getFeishuFileTokenStatus,
} from "../../../external/larkTokenManager.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import { z } from "zod";
import { zodParams } from "../zodParams.js";

// ─── 飞书 ───

async function feishuSendTextTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSendText(
    String(args.receiveId),
    String(args.receiveIdType || "open_id"),
    String(args.text),
    ctx.config,
  );
}

async function feishuSendMessageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSendMessage(
    String(args.receiveId),
    String(args.receiveIdType || "open_id"),
    String(args.msgType || "text"),
    (args.content || {}) as Record<string, unknown>,
    ctx.config,
  );
}

async function feishuGetDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetDoc(String(args.documentId), ctx.prisma, ctx.config);
}

async function feishuCreateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuCreateDoc(String(args.title), args.folderToken ? String(args.folderToken) : undefined, ctx.prisma, ctx.config);
}

async function feishuUpdateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const documentId = String(args.documentId);
  const title = args.title != null ? String(args.title) : undefined;
  const blocks = Array.isArray(args.blocks) ? (args.blocks as unknown[]) : undefined;
  if (!title && !blocks?.length) {
    throw new Error(
      "请提供 title 和/或 blocks（仅改已有 block 的 batch_update）。新建正文请用 feishu_append_doc_text / feishu_append_doc_blocks。",
    );
  }
  const results: Record<string, unknown> = {};
  if (title) results.title = await feishuUpdateDocTitle(documentId, title, ctx.prisma, ctx.config);
  if (blocks?.length) results.blocks = await feishuUpdateDocBlocks(documentId, blocks, ctx.prisma, ctx.config);
  return results;
}

async function feishuAppendDocTextTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAppendDocText(String(args.documentId), String(args.text ?? ""), ctx.prisma, ctx.config);
}

async function feishuAppendDocBlocksTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const children = Array.isArray(args.children) ? (args.children as unknown[]) : [];
  if (children.length === 0) throw new Error("children 不能为空");
  return feishuCreateDocChildren(
    String(args.documentId),
    children,
    {
      parentBlockId: args.parentBlockId != null ? String(args.parentBlockId) : undefined,
      index: args.index != null ? Number(args.index) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuDeleteDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuDeleteDoc(String(args.documentId), ctx.prisma, ctx.config);
}

async function feishuSearchDocsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSearchDocs(String(args.query), ctx.prisma, ctx.config);
}

async function feishuCreateWikiNodeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuCreateWikiNode(
    String(args.spaceId),
    String(args.title),
    {
      parentNodeToken: args.parentNodeToken ? String(args.parentNodeToken) : undefined,
      objType: args.objType ? String(args.objType) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuGetWikiSpaceTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetWikiSpace(String(args.spaceId), ctx.prisma, ctx.config);
}

async function feishuGetWikiNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetWikiNodes(String(args.spaceId), args.parentNodeToken ? String(args.parentNodeToken) : undefined, ctx.prisma, ctx.config);
}

async function feishuCreateSpreadsheetTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuCreateSpreadsheet(String(args.title), args.folderToken ? String(args.folderToken) : undefined, ctx.prisma, ctx.config);
}

async function feishuAppendSpreadsheetValuesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAppendSpreadsheetValues(
    String(args.spreadsheetToken),
    String(args.range),
    (args.values || []) as unknown[],
    ctx.prisma,
    ctx.config,
  );
}

async function feishuTokenStatusTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return getUserAccessTokenStatus(ctx.prisma, ctx.config);
}

async function feishuListDocWhiteboardsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const boards = await feishuListDocWhiteboards(String(args.documentId), ctx.prisma, ctx.config);
  return { count: boards.length, boards };
}

async function feishuListWhiteboardNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuListWhiteboardNodes(String(args.whiteboardId), ctx.prisma, ctx.config);
}

async function feishuCreateWhiteboardNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const nodes = args.nodes;
  if (!Array.isArray(nodes)) throw new Error("nodes 必须是数组（board-v1 节点结构）");
  return feishuCreateWhiteboardNodes(
    String(args.whiteboardId),
    nodes,
    {
      overwrite: args.overwrite === true,
      clientToken: args.clientToken ? String(args.clientToken) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuWhiteboardFromDiagramTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const format = String(args.format || "mermaid") as "plantuml" | "mermaid" | "svg";
  if (!["plantuml", "mermaid", "svg"].includes(format)) {
    throw new Error("format 必须是 plantuml | mermaid | svg");
  }
  const code = String(args.code || "").trim();
  if (!code) throw new Error("code 不能为空");
  return feishuWhiteboardFromDiagram(
    String(args.whiteboardId),
    code,
    format,
    {
      overwrite: args.overwrite !== false, // 默认覆盖，避免叠一层旧图
      clientToken: args.clientToken ? String(args.clientToken) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuDeleteWhiteboardNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const ids = args.ids;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("ids 必须为非空字符串数组");
  return feishuDeleteWhiteboardNodes(
    String(args.whiteboardId),
    ids.map(String),
    { clientToken: args.clientToken ? String(args.clientToken) : undefined },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuGetWhiteboardThemeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetWhiteboardTheme(String(args.whiteboardId), ctx.prisma, ctx.config);
}

async function feishuUpdateWhiteboardThemeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuUpdateWhiteboardTheme(String(args.whiteboardId), String(args.theme), ctx.prisma, ctx.config);
}

async function feishuListPermissionMembersTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuListPermissionMembers(
    String(args.token),
    String(args.type || "docx"),
    ctx.prisma,
    ctx.config,
  );
}

async function feishuAddPermissionMemberTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAddPermissionMember(
    String(args.token),
    String(args.type || "docx"),
    {
      memberType: String(args.memberType || "openid"),
      memberId: String(args.memberId),
      perm: String(args.perm || "view"),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuUpdatePermissionMemberTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuUpdatePermissionMember(
    String(args.token),
    String(args.type || "docx"),
    {
      memberType: String(args.memberType || "openid"),
      memberId: String(args.memberId),
      perm: String(args.perm || "edit"),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuRemovePermissionMemberTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuRemovePermissionMember(
    String(args.token),
    String(args.type || "docx"),
    {
      memberType: String(args.memberType || "openid"),
      memberId: String(args.memberId),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuGetPermissionPublicTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetPermissionPublic(String(args.token), String(args.type || "docx"), ctx.prisma, ctx.config);
}

async function feishuUpdatePermissionPublicTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const patch: FeishuPermissionPublicPatch = {};
  const keys = [
    "external_access_entity",
    "security_entity",
    "comment_entity",
    "share_entity",
    "manage_collaborator_entity",
    "link_share_entity",
    "copy_entity",
  ] as const;
  for (const k of keys) {
    if (args[k] != null && String(args[k]).trim()) {
      (patch as Record<string, string>)[k] = String(args[k]).trim();
    }
  }
  if (!Object.keys(patch).length) {
    throw new Error(
      "请至少提供一项权限设置字段：external_access_entity / link_share_entity / share_entity / manage_collaborator_entity / copy_entity / security_entity / comment_entity",
    );
  }
  return feishuUpdatePermissionPublic(
    String(args.token),
    String(args.type || "docx"),
    patch,
    ctx.prisma,
    ctx.config,
  );
}

async function feishuLookupUserTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const mobiles = Array.isArray(args.mobiles)
    ? args.mobiles.map(String)
    : args.mobile
      ? [String(args.mobile)]
      : [];
  const emails = Array.isArray(args.emails)
    ? args.emails.map(String)
    : args.email
      ? [String(args.email)]
      : [];
  return feishuBatchGetUserIds(
    { mobiles, emails, includeResigned: args.includeResigned === true },
    ctx.config,
    ctx.prisma,
  );
}

async function feishuAddCollaboratorByContactTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAddCollaboratorByContact(
    String(args.token),
    String(args.type || "docx"),
    {
      mobile: args.mobile != null ? String(args.mobile) : undefined,
      email: args.email != null ? String(args.email) : undefined,
      perm: String(args.perm || "view"),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuRefreshTokenTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const refreshToken = await getCredentialValue(ctx.prisma, "feishu", "feishu_refresh_token");
  if (refreshToken) {
    const token = await refreshUserAccessToken(ctx.prisma, refreshToken, ctx.config);
    return { success: true, source: "credential", token: token.slice(0, 8) + "..." };
  }
  const fileResult = await refreshFileToken();
  if (fileResult.success) return { source: "file", ...fileResult };
  return {
    source: "file",
    ...fileResult,
    success: false,
    hint: "refresh 失败时请调用 feishu_authorize（会打开浏览器，用户点一次同意即可落盘新 token）",
  };
}

/** 浏览器 OAuth：token 过期且无法 refresh 时由 Agent 自行拉起，无需人工改 .env */
async function feishuAuthorizeTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const timeoutSec = Number(args.timeoutSec || 180);
  const result = await authorizeUserViaBrowser({
    timeoutSec: Number.isFinite(timeoutSec) ? timeoutSec : 180,
    openBrowser: args.openBrowser !== false,
    scope: args.scope ? String(args.scope) : undefined,
  });
  if (!result.success) {
    throw new Error(
      result.error ||
        "飞书授权失败。请确认开放平台已添加重定向 http://localhost:8088，并开通 offline_access / 文档 / 画板权限。",
    );
  }
  const status = getFeishuFileTokenStatus();
  return {
    ...result,
    fileStatus: status,
    message:
      "授权成功，token 已写入 content/cookies/feishu_oauth.json。后续过期会自动 refresh；refresh 也失效时再调本工具。",
  };
}

export const feishuDefs: NativeToolDefinition[] = [
  {
    name: "feishu_send_text",
    concurrencyClass: "D",
    description: "向飞书用户/群发送文本（优先 tenant token；也支持 user token）。",
    parameters: zodParams(
      z.object({
        receiveId: z.string().describe("接收者 open_id / chat_id"),
        receiveIdType: z.enum(["open_id", "chat_id", "user_id"]).describe("默认 open_id").optional(),
        text: z.string(),
      }),
    ),
  },
  {
    name: "feishu_send_message",
    concurrencyClass: "D",
    description: "向飞书发送任意类型消息（text/post/image/interactive 等）。",
    parameters: zodParams(
      z.object({
        receiveId: z.string(),
        receiveIdType: z.enum(["open_id", "chat_id", "user_id"]).describe("默认 open_id").optional(),
        msgType: z.string().describe("消息类型：text/post/image/interactive"),
        content: z.record(z.unknown()).describe("消息内容对象"),
      }),
    ),
  },
  {
    name: "feishu_get_doc",
    concurrencyClass: "B",
    description: "获取飞书文档详情（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_create_doc",
    concurrencyClass: "D",
    description: "创建飞书文档（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        title: z.string(),
        folderToken: z.string().describe("可选父文件夹 token").optional(),
      }),
    ),
  },
  {
    name: "feishu_update_doc",
    concurrencyClass: "D",
    description:
      "仅改标题或已有块：title 和/或 blocks（docx batch_update requests，必须带已有 block_id）。" +
      "新建段落/表格/画板禁止用本工具——请用 feishu_append_doc_text 或 feishu_append_doc_blocks。需 user_access_token。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
        title: z.string().optional(),
        blocks: z
          .array(z.unknown())
          .describe("可选：batch_update requests（改已有块）；新建内容勿传")
          .optional(),
      }),
    ),
  },
  {
    name: "feishu_append_doc_text",
    reentrant: true,
    concurrencyClass: "D",
    description:
      "【写正文首选】把 Markdown 追加到飞书文档末尾：服务端解析为原生块（标题/加粗/列表/分割线/代码/公式/表格）。" +
      "普通块走 docx children；GFM 表格对标 MetaBlog：建空表 → PATCH 各 cell 自带 text child（原生表格，不是管道符）。" +
      "规范：段落顶格；标题 `# `（# 后空格）；无序列表只用 `- `；加粗 `**重点**`；分割线 `---`；" +
      "表格须含表头+`|---|` 分隔行+数据行（≤9×9）；行内公式 `$...$`、块级 `$$...$$`。" +
      "禁止把 `#`/`**`/`|...|` 当纯文本指望飞书渲染。create_doc 后立刻用本工具灌内容。需 user_access_token。",
    parameters: zodParams(
      z.object({
        documentId: z.string().describe("文档 document_id；Wiki 节点用返回的 obj_token"),
        text: z
          .string()
          .describe("Markdown 全文（含 GFM 表格/公式会转成飞书原生块；非 raw 字符串堆叠）"),
      }),
    ),
  },
  {
    name: "feishu_append_doc_blocks",
    concurrencyClass: "D",
    description:
      "在文档根（或指定父块）下创建子块。用于画板壳 block_type:43 board:{}、标题块、表格壳等。" +
      "普通长文优先 feishu_append_doc_text。示例 children: [{block_type:2,text:{elements:[{text_run:{content:\"hi\"}}]}},{block_type:43,board:{}}]。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
        children: z.array(z.unknown()).describe("docx children 块数组（单次最多 50）"),
        parentBlockId: z.string().describe("父块 id，默认=documentId（根）").optional(),
        index: z.number().describe("插入位置，默认末尾").optional(),
      }),
    ),
  },
  {
    name: "feishu_delete_doc",
    concurrencyClass: "D",
    destructive: true,
    description: "删除飞书云文档（drive files DELETE，type=docx）。需 user_access_token；可能走审批。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_search_docs",
    concurrencyClass: "B",
    description: "搜索飞书文档（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        query: z.string(),
      }),
    ),
  },
  {
    name: "feishu_list_permission_members",
    reentrant: true,
    concurrencyClass: "B",
    description: "列出飞书云文档协作者（drive permissions members）。token 为 document_id / 文件 token；type 默认 docx。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("云文档 token（docx 即 document_id）"),
        type: z
          .enum(["doc", "docx", "sheet", "file", "wiki", "bitable", "folder", "mindnote", "minutes", "slides"])
          .describe("默认 docx")
          .optional(),
      }),
    ),
  },
  {
    name: "feishu_add_permission_member",
    concurrencyClass: "D",
    description:
      "为飞书云文档添加协作者。memberType：openid/email/openchat/unionid 等；perm：view/edit/full_access。需 docs:permission.member:create。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("云文档 token"),
        type: z.string().describe("默认 docx").optional(),
        memberType: z.string().describe("默认 openid").optional(),
        memberId: z.string().describe("与 memberType 对应的协作者 ID / 邮箱"),
        perm: z.enum(["view", "edit", "full_access"]).describe("默认 view").optional(),
      }),
    ),
  },
  {
    name: "feishu_update_permission_member",
    concurrencyClass: "D",
    description: "更新飞书云文档协作者权限（view→edit 等）。需 docs:permission.member:update。",
    parameters: zodParams(
      z.object({
        token: z.string(),
        type: z.string().describe("默认 docx").optional(),
        memberType: z.string().describe("默认 openid").optional(),
        memberId: z.string(),
        perm: z.enum(["view", "edit", "full_access"]).describe("默认 edit").optional(),
      }),
    ),
  },
  {
    name: "feishu_remove_permission_member",
    concurrencyClass: "D",
    destructive: true,
    description: "移除飞书云文档协作者。需 docs:permission.member:delete；可能走审批。",
    parameters: zodParams(
      z.object({
        token: z.string(),
        type: z.string().describe("默认 docx").optional(),
        memberType: z.string().describe("默认 openid").optional(),
        memberId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_get_permission_public",
    reentrant: true,
    concurrencyClass: "B",
    description:
      "读取飞书云文档「权限设置」（可见性）：外部分享、链接分享、谁可管理协作者/复制/打印下载/评论等。对应 UI 权限设置面板。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("document_id / 文件 token"),
        type: z.string().describe("默认 docx").optional(),
      }),
    ),
  },
  {
    name: "feishu_update_permission_public",
    concurrencyClass: "D",
    description:
      "更新飞书云文档「权限设置」（增量）。字段映射 UI：external_access_entity=允许分享到组织外；link_share_entity=链接分享；" +
      "share_entity+manage_collaborator_entity=谁可查看/添加/移除协作者；copy_entity=谁可复制；security_entity=谁可创建副本/打印/下载；comment_entity=谁可评论。" +
      "示例：组织内链接可读 → link_share_entity=tenant_readable；互联网可读 → external_access_entity=open + link_share_entity=anyone_readable。",
    parameters: zodParams(
      z.object({
        token: z.string(),
        type: z.string().describe("默认 docx").optional(),
        external_access_entity: z.enum(["open", "closed", "allow_share_partner_tenant"]).optional(),
        link_share_entity: z
          .enum([
            "tenant_readable",
            "tenant_editable",
            "partner_tenant_readable",
            "partner_tenant_editable",
            "anyone_readable",
            "anyone_editable",
            "closed",
          ])
          .optional(),
        share_entity: z.enum(["anyone", "same_tenant"]).optional(),
        manage_collaborator_entity: z
          .enum(["collaborator_can_view", "collaborator_can_edit", "collaborator_full_access"])
          .optional(),
        copy_entity: z.enum(["anyone_can_view", "anyone_can_edit", "only_full_access"]).optional(),
        security_entity: z.enum(["anyone_can_view", "anyone_can_edit", "only_full_access"]).optional(),
        comment_entity: z.enum(["anyone_can_view", "anyone_can_edit"]).optional(),
      }),
    ),
  },
  {
    name: "feishu_lookup_user",
    reentrant: true,
    concurrencyClass: "B",
    description:
      "用手机号/邮箱查飞书用户 open_id（contact batch_get_id，应用身份）。加协作者前可先查。" +
      "需开通 contact:user.id:readonly（或 contact:contact:readonly_as_app）并发布。仅邮箱时可直接 add_permission_member(memberType=email)。",
    parameters: zodParams(
      z.object({
        mobile: z.string().describe("单个手机号").optional(),
        email: z.string().describe("单个邮箱").optional(),
        mobiles: z.array(z.string()).optional(),
        emails: z.array(z.string()).optional(),
        includeResigned: z.boolean().optional(),
      }),
    ),
  },
  {
    name: "feishu_add_collaborator_by_contact",
    concurrencyClass: "D",
    description:
      "用手机号或邮箱把用户加为文档协作者并设权限（view/edit/full_access）。邮箱直加；手机号先查 open_id 再加。" +
      "手机号路径需通讯录查 ID 权限。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("document_id"),
        type: z.string().describe("默认 docx").optional(),
        mobile: z.string().optional(),
        email: z.string().optional(),
        perm: z.enum(["view", "edit", "full_access"]).describe("默认 view").optional(),
      }),
    ),
  },
  {
    name: "feishu_get_wiki_space",
    concurrencyClass: "B",
    description: "获取飞书 Wiki 空间信息（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        spaceId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_get_wiki_nodes",
    concurrencyClass: "B",
    description: "获取飞书 Wiki 节点列表（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        spaceId: z.string(),
        parentNodeToken: z.string().describe("可选父节点 token").optional(),
      }),
    ),
  },
  {
    name: "feishu_create_wiki_node",
    concurrencyClass: "D",
    description: "在飞书 Wiki 空间创建节点（默认 obj_type=docx）。需 user_access_token。",
    parameters: zodParams(
      z.object({
        spaceId: z.string(),
        title: z.string(),
        parentNodeToken: z.string().describe("可选父节点 token").optional(),
        objType: z.string().describe("默认 docx").optional(),
      }),
    ),
  },
  {
    name: "feishu_create_spreadsheet",
    concurrencyClass: "D",
    description: "创建飞书表格（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        title: z.string(),
        folderToken: z.string().optional(),
      }),
    ),
  },
  {
    name: "feishu_append_spreadsheet_values",
    concurrencyClass: "D",
    description: "向飞书表格追加数据（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        spreadsheetToken: z.string(),
        range: z.string().describe("如 sheet1!A1"),
        values: z.array(z.unknown()).describe("二维数组"),
      }),
    ),
  },
  {
    name: "feishu_token_status",
    reentrant: true, // 只读 credential 状态（getUserAccessTokenStatus 不触发刷新写库）
    concurrencyClass: "B",
    description: "查询飞书 user_access_token 状态（Credential 表或文件缓存）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "feishu_refresh_token",
    concurrencyClass: "D",
    description:
      "用 refresh_token 静默续期飞书 user_access_token（Credential 或 feishu_oauth.json）。失败时请改调 feishu_authorize。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "feishu_authorize",
    concurrencyClass: "D",
    description:
      "打开浏览器完成飞书 OAuth（含 offline_access + 文档/知识库/画板 scope），写入 content/cookies/feishu_oauth.json。" +
      "仅在 feishu_token_status 无效且 feishu_refresh_token 失败、或新增权限后需要重新授权时调用；已有有效 token 勿重复调用。" +
      "用户需在弹出页点一次同意。本地回调默认 http://localhost:8088（占用时自动尝试相邻端口）。",
    parameters: zodParams(
      z.object({
        timeoutSec: z.number().describe("等待用户授权秒数，默认 180").optional(),
        openBrowser: z.boolean().describe("是否自动打开浏览器，默认 true").optional(),
        scope: z.string().describe("可选自定义 scope（空格分隔）").optional(),
      }),
    ),
  },
  {
    name: "feishu_list_doc_whiteboards",
    reentrant: true,
    concurrencyClass: "B",
    description:
      "列出飞书文档内的画板（board-v1）。文档块 block_type=43，返回 whiteboardId（= block.board.token）。编辑画板前先调此工具拿 id。需 board:whiteboard:node:read + 文档读权限。",
    parameters: zodParams(
      z.object({
        documentId: z.string().describe("文档 document_id / token"),
      }),
    ),
  },
  {
    name: "feishu_list_whiteboard_nodes",
    reentrant: true,
    concurrencyClass: "B",
    description: "获取画板全部节点树（GET board/v1/.../nodes）。需 board:whiteboard:node:read。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string().describe("画板 id（feishu_list_doc_whiteboards 返回）"),
      }),
    ),
  },
  {
    name: "feishu_create_whiteboard_nodes",
    concurrencyClass: "D",
    destructive: true,
    // 画板节点创建（非 delete API）——日常绘图不应被 destructive 审批闸拦住
    approvalExempt: true,
    description:
      "在画板上批量创建节点（原生 board-v1 节点 JSON：sticky_note / composite_shape / connector / mind_map 等）。overwrite=true 时先清空再写入。一般流程图优先用 feishu_whiteboard_from_diagram（mermaid/plantuml）。需 board:whiteboard:node:create。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        nodes: z.array(z.record(z.unknown())).describe("whiteboard.node[]，见飞书 board-v1 数据结构"),
        overwrite: z.boolean().describe("是否覆盖整板，默认 false").optional(),
        clientToken: z.string().describe("幂等 token（≥10 字符）").optional(),
      }),
    ),
  },
  {
    name: "feishu_whiteboard_from_diagram",
    concurrencyClass: "D",
    destructive: true,
    // 图表写入创建路径（非 delete API）——与 feishu_create_whiteboard_nodes 同档豁免
    approvalExempt: true,
    description:
      "用 Mermaid / PlantUML / SVG 源码写入飞书画板（POST .../nodes/plantuml）。推荐路径：先 feishu_list_doc_whiteboards 取 whiteboardId，再传 mermaid/plantuml 代码；默认 overwrite=true 覆盖旧图。需 board:whiteboard:node:create。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        code: z.string().describe("Mermaid / PlantUML / SVG 源码"),
        format: z.enum(["mermaid", "plantuml", "svg"]).describe("默认 mermaid").optional(),
        overwrite: z.boolean().describe("默认 true：覆盖整板").optional(),
        clientToken: z.string().describe("幂等 token（≥10 字符）").optional(),
      }),
    ),
  },
  {
    name: "feishu_delete_whiteboard_nodes",
    concurrencyClass: "D",
    destructive: true,
    description: "批量删除画板节点（含子节点递归）。单次最多 100 个 id。需 board:whiteboard:node:delete。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        ids: z.array(z.string()).describe("节点 id 列表"),
        clientToken: z.string().optional(),
      }),
    ),
  },
  {
    name: "feishu_get_whiteboard_theme",
    reentrant: true,
    concurrencyClass: "B",
    description: "获取画板主题。",
    parameters: zodParams(z.object({ whiteboardId: z.string() })),
  },
  {
    name: "feishu_update_whiteboard_theme",
    concurrencyClass: "D",
    description: "更新画板主题：classic / minimalist_gray / retro / vibrant_color / default。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        theme: z.enum(["classic", "minimalist_gray", "retro", "vibrant_color", "default"]),
      }),
    ),
  },
];

export const feishuHandlers: Record<string, NativeToolHandler> = {
  feishu_send_text: feishuSendTextTool,
  feishu_send_message: feishuSendMessageTool,
  feishu_get_doc: feishuGetDocTool,
  feishu_create_doc: feishuCreateDocTool,
  feishu_update_doc: feishuUpdateDocTool,
  feishu_append_doc_text: feishuAppendDocTextTool,
  feishu_append_doc_blocks: feishuAppendDocBlocksTool,
  feishu_delete_doc: feishuDeleteDocTool,
  feishu_search_docs: feishuSearchDocsTool,
  feishu_list_permission_members: feishuListPermissionMembersTool,
  feishu_add_permission_member: feishuAddPermissionMemberTool,
  feishu_update_permission_member: feishuUpdatePermissionMemberTool,
  feishu_remove_permission_member: feishuRemovePermissionMemberTool,
  feishu_get_permission_public: feishuGetPermissionPublicTool,
  feishu_update_permission_public: feishuUpdatePermissionPublicTool,
  feishu_lookup_user: feishuLookupUserTool,
  feishu_add_collaborator_by_contact: feishuAddCollaboratorByContactTool,
  feishu_get_wiki_space: feishuGetWikiSpaceTool,
  feishu_get_wiki_nodes: feishuGetWikiNodesTool,
  feishu_create_wiki_node: feishuCreateWikiNodeTool,
  feishu_create_spreadsheet: feishuCreateSpreadsheetTool,
  feishu_append_spreadsheet_values: feishuAppendSpreadsheetValuesTool,
  feishu_token_status: feishuTokenStatusTool,
  feishu_refresh_token: feishuRefreshTokenTool,
  feishu_authorize: feishuAuthorizeTool,
  feishu_list_doc_whiteboards: feishuListDocWhiteboardsTool,
  feishu_list_whiteboard_nodes: feishuListWhiteboardNodesTool,
  feishu_create_whiteboard_nodes: feishuCreateWhiteboardNodesTool,
  feishu_whiteboard_from_diagram: feishuWhiteboardFromDiagramTool,
  feishu_delete_whiteboard_nodes: feishuDeleteWhiteboardNodesTool,
  feishu_get_whiteboard_theme: feishuGetWhiteboardThemeTool,
  feishu_update_whiteboard_theme: feishuUpdateWhiteboardThemeTool,
};
