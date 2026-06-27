import { create } from "zustand";
import { trpc } from "../trpc.js";
import type {
  CreateSessionInput, UpdateSessionInput, ListSessionsInput,
  CreateMessageInput, UpdateMessageInput, ListMessagesInput,
  CreateFileInput, UpdateFileInput, ListFilesInput,
  CreateLogInput, ListLogsInput,
  CreateMcpServerInput, UpdateMcpServerInput, ListMcpServersInput,
  CreateMemoryInput, UpdateMemoryInput, ListMemoriesInput,
  CreateGitRepoInput, UpdateGitRepoInput, ListGitReposInput,
  CreateTaskInput, UpdateTaskInput, ListTasksInput,
  CreateTriggerInput, UpdateTriggerInput, ListTriggersInput,
  CreateApprovalInput, UpdateApprovalInput, ListApprovalsInput
} from "../trpc.js";

// Session Store
export const useSessionStore = create<any>((set) => ({
  sessions: [],
  total: 0,
  loading: false,
  error: null,
  listSessions: async (input: ListSessionsInput) => {
    set({ loading: true });
    try {
      const res = await trpc.session.list.query(input);
      set({ sessions: res.items, total: res.total, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },
  createSession: async (input: CreateSessionInput) => {
    try {
      const res = await trpc.session.create.mutate(input);
      set((state: any) => ({ sessions: [res, ...state.sessions] }));
      return res;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },
  updateSession: async (input: UpdateSessionInput) => {
    try {
      const res = await trpc.session.update.mutate(input);
      set((state: any) => ({
        sessions: state.sessions.map((s: any) => s.id === res.id ? res : s)
      }));
      return res;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },
  deleteSession: async (id: string) => {
    try {
      await trpc.session.delete.mutate({ id });
      set((state: any) => ({ sessions: state.sessions.filter((s: any) => s.id !== id) }));
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  }
}));

// Message Store
export const useMessageStore = create<any>((set) => ({
  messages: [],
  loading: false,
  error: null,
  listMessages: async (input: ListMessagesInput) => {
    set({ loading: true });
    try {
      const res = await trpc.message.list.query(input);
      set({ messages: res.items, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },
  createMessage: async (input: CreateMessageInput) => {
    try {
      const res = await trpc.message.create.mutate(input);
      set((state: any) => ({ messages: [...state.messages, res] }));
      return res;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },
  updateMessage: async (input: UpdateMessageInput) => {
    try {
      const res = await trpc.message.update.mutate(input);
      set((state: any) => ({
        messages: state.messages.map((m: any) => m.id === res.id ? res : m)
      }));
      return res;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },
  deleteMessage: async (id: string) => {
    try {
      await trpc.message.delete.mutate({ id });
      set((state: any) => ({ messages: state.messages.filter((m: any) => m.id !== id) }));
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  }
}));

// File Store
export const useFileStore = create<any>((set) => ({
  files: [],
  total: 0,
  loading: false,
  listFiles: async (input: ListFilesInput) => {
    set({ loading: true });
    const res = await trpc.file.list.query(input);
    set({ files: res.items, total: res.total, loading: false });
  },
  createFile: async (input: CreateFileInput) => {
    return trpc.file.create.mutate(input);
  },
  updateFile: async (input: UpdateFileInput) => {
    return trpc.file.update.mutate(input);
  },
  deleteFile: async (id: string) => {
    return trpc.file.delete.mutate({ id });
  }
}));

// Log Store
export const useLogStore = create<any>((set) => ({
  logs: [],
  total: 0,
  loading: false,
  listLogs: async (input: ListLogsInput) => {
    set({ loading: true });
    const res = await trpc.log.list.query(input);
    set({ logs: res.items, total: res.total, loading: false });
  },
  createLog: async (input: CreateLogInput) => {
    return trpc.log.create.mutate(input);
  },
  clearAllLogs: async () => {
    return trpc.log.clearAll.mutate();
  }
}));

// MCP Server Store
export const useMcpStore = create<any>((set) => ({
  servers: [],
  total: 0,
  loading: false,
  listServers: async (input: ListMcpServersInput) => {
    set({ loading: true });
    const res = await trpc.mcp.list.query(input);
    set({ servers: res.items, total: res.total, loading: false });
  },
  createServer: async (input: CreateMcpServerInput) => {
    return trpc.mcp.create.mutate(input);
  },
  updateServer: async (input: UpdateMcpServerInput) => {
    return trpc.mcp.update.mutate(input);
  },
  deleteServer: async (id: string) => {
    return trpc.mcp.delete.mutate({ id });
  }
}));

// Memory Store
export const useMemoryStore = create<any>((set) => ({
  memories: [],
  total: 0,
  loading: false,
  listMemories: async (input: ListMemoriesInput) => {
    set({ loading: true });
    const res = await trpc.memory.list.query(input);
    set({ memories: res.items, total: res.total, loading: false });
  },
  createMemory: async (input: CreateMemoryInput) => {
    return trpc.memory.create.mutate(input);
  },
  updateMemory: async (input: UpdateMemoryInput) => {
    return trpc.memory.update.mutate(input);
  },
  deleteMemory: async (id: string) => {
    return trpc.memory.delete.mutate({ id });
  }
}));

// Git Store
export const useGitStore = create<any>((set) => ({
  repos: [],
  total: 0,
  loading: false,
  listRepos: async (input: ListGitReposInput) => {
    set({ loading: true });
    const res = await trpc.git.list.query(input);
    set({ repos: res.items, total: res.total, loading: false });
  },
  createRepo: async (input: CreateGitRepoInput) => {
    return trpc.git.create.mutate(input);
  },
  updateRepo: async (input: UpdateGitRepoInput) => {
    return trpc.git.update.mutate(input);
  },
  deleteRepo: async (id: string) => {
    return trpc.git.delete.mutate({ id });
  }
}));

// Task Store
export const useTaskStore = create<any>((set) => ({
  tasks: [],
  total: 0,
  loading: false,
  listTasks: async (input: ListTasksInput) => {
    set({ loading: true });
    const res = await trpc.task.list.query(input);
    set({ tasks: res.items, total: res.total, loading: false });
  },
  createTask: async (input: CreateTaskInput) => {
    return trpc.task.create.mutate(input);
  },
  updateTask: async (input: UpdateTaskInput) => {
    return trpc.task.update.mutate(input);
  },
  deleteTask: async (id: string) => {
    return trpc.task.delete.mutate({ id });
  }
}));

// Trigger Store
export const useTriggerStore = create<any>((set) => ({
  triggers: [],
  total: 0,
  loading: false,
  listTriggers: async (input: ListTriggersInput) => {
    set({ loading: true });
    const res = await trpc.trigger.list.query(input);
    set({ triggers: res.items, total: res.total, loading: false });
  },
  createTrigger: async (input: CreateTriggerInput) => {
    return trpc.trigger.create.mutate(input);
  },
  updateTrigger: async (input: UpdateTriggerInput) => {
    return trpc.trigger.update.mutate(input);
  },
  deleteTrigger: async (id: string) => {
    return trpc.trigger.delete.mutate({ id });
  }
}));

// Approval Store
export const useApprovalStore = create<any>((set) => ({
  approvals: [],
  total: 0,
  loading: false,
  listApprovals: async (input: ListApprovalsInput) => {
    set({ loading: true });
    const res = await trpc.approval.list.query(input);
    set({ approvals: res.items, total: res.total, loading: false });
  },
  createApproval: async (input: CreateApprovalInput) => {
    return trpc.approval.create.mutate(input);
  },
  updateApproval: async (input: UpdateApprovalInput) => {
    return trpc.approval.update.mutate(input);
  },
  deleteApproval: async (id: string) => {
    return trpc.approval.delete.mutate({ id });
  }
}));
