/**
 * Native 集成域 — git_*（本地+远端仓库操作）/ yuque_* / github_* / feishu_* / send_email / 浏览器登录态
 *
 * PR-4c：从 nativeTools.ts 迁出，handler 与 schema 保持原语义不变。
 * git_* 归此域：clone/pull/push 均与远端交互，本地只读命令一并收拢避免拆散。
 */
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveSafePath, assertPathWithinProjectRoot } from "../../safePath.js";
import {
  getGitHubToken,
  parseRepo,
  githubGetRepo,
  githubCreateRepo,
  githubUpdateRepo,
  githubDeleteRepo,
  githubGetFile,
  githubCreateFile,
  githubUpdateFile,
  githubDeleteFile,
  githubListIssues,
  githubGetIssue,
  githubCreateIssue,
  githubUpdateIssue,
  githubCreateIssueComment,
  githubListPullRequests,
  githubGetPullRequest,
  githubCreatePullRequest,
  githubUpdatePullRequest,
  githubMergePullRequest,
  githubListBranches,
  githubGetBranch,
  githubCreateBranch,
  githubDeleteBranch,
  githubListWorkflows,
  githubTriggerWorkflow,
  githubCreateRelease,
  githubSearchRepos,
} from "../../githubClient.js";
import { executeGitHubTool, listGitHubTools } from "../../external/githubToolExecutor.js";
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
} from "../../feishuClient.js";
import type { FeishuPermissionPublicPatch } from "../../feishuClient.js";
import { getCredentialValue } from "../../credentialVault.js";
import {
  authorizeUserViaBrowser,
  refreshTokenManually as refreshFileToken,
  getTokenStatus as getFeishuFileTokenStatus,
} from "../../external/larkTokenManager.js";
import {
  getYuqueCredentials,
  getYuquePersonalToken,
  yuqueListBooks,
  yuqueGetBookToc,
  yuqueCreateBook,
  yuqueUpdateBook,
  yuqueDeleteBook,
  yuqueGetDocWeb,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueListRepos,
  yuqueCreateRepo,
  yuqueUpdateRepo,
  yuqueDeleteRepo,
  yuqueListDocs,
  yuqueGetDocV2,
  yuqueCreateDocV2,
  yuqueUpdateDocV2,
  yuqueDeleteDocV2,
  yuqueProbeSession,
} from "../../yuqueClient.js";
import { captureZhihuLoginState } from "../../metablog/auth/zhihuLogin.js";
import { listSavedCookiePlatforms, loadCookies } from "../../cookieJar.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import { registerNativeDomain } from "./registerDomain.js";
import { emailDefs, emailHandlers } from "./integration/email.js";
import { gitDefs, gitHandlers } from "./integration/git.js";
import { yuqueDefs, yuqueHandlers } from "./integration/yuque.js";
import { githubDefs, githubHandlers } from "./integration/github.js";
import { feishuDefs, feishuHandlers } from "./integration/feishu.js";
import { agentPlatformDefs, agentPlatformHandlers } from "./integration/agentPlatform.js";
import { tikhubDefs, tikhubHandlers } from "./integration/tikhub.js";

const execFileAsync = promisify(execFile);

// ─── Git 仓库操作（已拆出到 ./integration/git.ts）───

// ─── 语雀（已拆出到 ./integration/yuque.ts）───

// ─── GitHub + 浏览器登录态（已拆出到 ./integration/github.ts）───

// ─── 飞书（已拆出到 ./integration/feishu.ts）───

// ─── 邮件通知工具（已拆出到 ./integration/email.ts）───

const INTEGRATION_DEFS: NativeToolDefinition[] = [
  ...gitDefs,
  ...yuqueDefs,
  ...githubDefs,
  ...feishuDefs,
  ...emailDefs,
  ...agentPlatformDefs,
  ...tikhubDefs,
];

const INTEGRATION_HANDLERS: Record<string, NativeToolHandler> = {
  ...gitHandlers,
  ...yuqueHandlers,
  ...githubHandlers,
  ...feishuHandlers,
  ...emailHandlers,
  ...agentPlatformHandlers,
  ...tikhubHandlers,
};

export function registerIntegrationTools(): void {
  registerNativeDomain(INTEGRATION_DEFS, INTEGRATION_HANDLERS);
}




