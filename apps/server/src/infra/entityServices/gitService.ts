/**
 * GitRepo Service（从 services.ts 拆出的叶子）。
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type {
  CreateGitRepoInput,
  UpdateGitRepoInput,
  ListGitReposInput,
  GitRepoPathInput,
} from "@knowpilot/shared";
import { BaseService } from "../../services.js";
import { resolveSafePath } from "../safePath.js";

export class GitService extends BaseService<CreateGitRepoInput, UpdateGitRepoInput, ListGitReposInput, any> {
  readonly entityName = "git";
  protected get delegate() { return this.prisma.gitRepo; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(_input: ListGitReposInput) { return {}; }
  protected buildCreateData(input: CreateGitRepoInput) { return input; }
  protected buildUpdateData(input: UpdateGitRepoInput) { const { id: _id, ...data } = input; return data; }

  protected override async validateCreate(input: CreateGitRepoInput): Promise<void> {
    await this.assertUnique("path", input.path, "创建");
    // 安全：注册阶段即校验 path 在 projectRoot 之内，堵住后续 git commit/push 对任意磁盘路径的操作
    resolveSafePath(this.config, input.path);
  }
  protected override async validateUpdate(input: UpdateGitRepoInput, _existing: any): Promise<void> {
    if (input.path) resolveSafePath(this.config, input.path);
  }
  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name, path: existing.path };
  }

  private async resolveRepoPath(input: GitRepoPathInput): Promise<string> {
    // 安全：所有 Git 操作的 cwd 都必须经 resolveSafePath 校验并解析为绝对路径
    if (input.repoPath) return resolveSafePath(this.config, input.repoPath);
    if (input.repoId) {
      const repo = await this.getById(input.repoId);
      return resolveSafePath(this.config, repo.path);
    }
    return this.config.projectRoot;
  }

  private async runGit(cwd: string, args: string[]): Promise<string> {
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return (stdout || stderr || "").trim();
  }

  async status(input: GitRepoPathInput) {
    const cwd = await this.resolveRepoPath(input);
    return { path: cwd, status: await this.runGit(cwd, ["status", "--porcelain", "-b"]) };
  }

  async log(input: GitRepoPathInput & { limit?: number }) {
    const cwd = await this.resolveRepoPath(input);
    const limit = String(input.limit || 10);
    const output = await this.runGit(cwd, ["log", `--max-count=${limit}`, "--oneline", "--decorate"]);
    return { path: cwd, log: output.split("\n").filter(Boolean) };
  }

  async diff(input: GitRepoPathInput & { staged?: boolean }) {
    const cwd = await this.resolveRepoPath(input);
    const args = input.staged ? ["diff", "--cached"] : ["diff"];
    return { path: cwd, diff: (await this.runGit(cwd, args)).slice(0, 12000) };
  }

  async commit(input: GitRepoPathInput & { message: string }) {
    const cwd = await this.resolveRepoPath(input);
    await this.runGit(cwd, ["add", "-A"]);
    const output = await this.runGit(cwd, ["commit", "-m", input.message]);
    return { path: cwd, output };
  }

  async pull(input: GitRepoPathInput) {
    const cwd = await this.resolveRepoPath(input);
    return { path: cwd, output: await this.runGit(cwd, ["pull"]) };
  }

  async push(input: GitRepoPathInput) {
    const cwd = await this.resolveRepoPath(input);
    return { path: cwd, output: await this.runGit(cwd, ["push"]) };
  }
}
