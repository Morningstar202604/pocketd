import { simpleGit, type SimpleGit } from "simple-git";
import { WORKSPACE } from "./runtime.js";

let client: SimpleGit | null = null;

export function git(): SimpleGit {
  if (!client) {
    client = simpleGit({ baseDir: WORKSPACE, maxConcurrentProcesses: 1, trimmed: false });
  }
  return client;
}

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runGit(args: string[]): Promise<GitRunResult> {
  try {
    const stdout = await git().raw(args);
    return { code: 0, stdout: stdout ?? "", stderr: "" };
  } catch (err) {
    const e = err as { message?: string; git?: { stderr?: string; code?: number } };
    return {
      code: typeof e.git?.code === "number" ? e.git.code : 1,
      stdout: "",
      stderr: e.git?.stderr || e.message || String(err),
    };
  }
}
