const RESEARCH_INTENT = /\b(?:research|investigate|look into|look up|find out about|find information (?:about|on)|find (?:sources|studies|evidence|articles|papers|reports)|search (?:the )?(?:web|internet)|gather sources|collect evidence|literature review|compare evidence)\b/i;
const BUILD_INTENT = /\b(?:build|create|make|implement|develop|code|write|generate|fix|debug|refactor)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the|this|that|my|our)\s+)?(?:[\w-]+\s+){0,4}(?:app|website|web app|site|code|program|script|project|component|dashboard|tool|file|function|page|game|calculator)\b/i;

/** Route research-only prompts away from the coding Agent, but keep mixed build requests in Agent. */
export function isResearchOnlyRequest(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || !RESEARCH_INTENT.test(text)) return false;
  if (/\bhow\s+(?:do|can|could|to|should|would)\b/i.test(text)) return true;
  return !BUILD_INTENT.test(text);
}
