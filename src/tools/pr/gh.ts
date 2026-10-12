import { execFileSync } from "node:child_process";
import { getGitHubAuthEnv } from "../../core/github.js";

/**
 * Thin wrappers around the `gh` and `git` CLIs so every call in this folder uses
 * the same argv form, auth environment, and output encoding. Callers keep their
 * own error handling because each one reports a different, intentional message.
 */

/** Run `gh` authenticated with the managed GitHub credential; returns stdout. */
export function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8", env: getGitHubAuthEnv() });
}

/** Run `git` and capture stdout (no discarding of the child's output). */
export function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8" });
}

/** Run `git` for its side effect only; child output is piped and ignored. */
export function gitSilent(args: string[]): void {
  execFileSync("git", args, { stdio: "pipe" });
}

/** Run a `git` network write (push) with the managed GitHub credential. */
export function gitAuthenticated(args: string[]): void {
  execFileSync("git", args, { stdio: "pipe", env: getGitHubAuthEnv() });
}

/** Parse a `gh --json` payload, tolerating an empty body. */
export function parseGhJson<T>(raw: string): T {
  return JSON.parse(raw || "[]") as T;
}
