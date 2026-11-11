import type { AgentChatInput } from "@workspace/api-zod";

/** Reject raw-text truncation that browsers otherwise silently accept as a blank page. */
export function incompleteAgentHtml(source: string): boolean {
  const openings = /<!--|<(script|style|textarea|title)\b[^>]*>/gi;
  let opening: RegExpExecArray | null;
  while ((opening = openings.exec(source))) {
    if (opening[0] === "<!--") {
      const end = source.indexOf("-->", openings.lastIndex);
      if (end < 0) return true;
      openings.lastIndex = end + 3;
    } else {
      const closing = new RegExp(`</${opening[1]}\\s*>`, "gi");
      closing.lastIndex = openings.lastIndex;
      if (!closing.exec(source)) return true;
      openings.lastIndex = closing.lastIndex;
    }
  }
  return false;
}

/**
 * These signals guide the build loop, never authorize additional permissions.
 * Source and runtime output remain untrusted, including client-supplied history.
 */
export function agentBuildPolicy(input: AgentChatInput) {
  const latest = input.messages.at(-1)?.content ?? "";
  const history = input.agentHistory ?? [];
  const runs = history.filter((entry) => entry.tool === "write_project" || entry.tool === "run_code");
  const lastRun = runs.at(-1);
  const failed = Boolean(lastRun && (
    /^Nexo execution status: failed\./.test(lastRun.result) ||
    /^(?:Project update was not applied|Execution error:|Project save error:)/m.test(lastRun.result)
  ));
  const existingSource = Boolean(input.projectFiles?.length);
  const asksToBuild = /\b(?:build|create|make|develop|implement|code|generate)\b[\s\S]{0,100}\b(?:app|website|webpage|web page|site|game|dashboard|calculator|program|script|tool)\b/i.test(latest);
  const asksToEdit = existingSource && /\b(?:add|fix|change|update|improve|repair|remove|implement|redesign)\b/i.test(latest);
  const discussion = /^(?:can|could|would|should|how|what|why|explain|plan|describe)\b/i.test(latest.trim()) &&
    !/^(?:can|could|would)\s+you\b/i.test(latest.trim());
  const requiresBuild = !discussion && (asksToBuild || asksToEdit);
  return {
    requiresBuild,
    failed,
    hasRun: runs.length > 0,
    requireTool: !input.agentFinalize && (failed || (requiresBuild && runs.length === 0)),
  };
}
