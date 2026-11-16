/** Pure text transformation only: never executes code or accesses storage. */
export type ProjectEdit = { path: string; oldText: string; newText: string };
export const projectEditParameters = {
  type: "object",
  properties: {
    entrypoint: { type: "string", description: "Existing project file to run, usually index.html." },
    edits: {
      type: "array", minItems: 1, maxItems: 16,
      items: {
        type: "object",
        properties: {
          path: { type: "string", maxLength: 160 },
          oldText: { type: "string", minLength: 1, maxLength: 2000 },
          newText: { type: "string", maxLength: 2000 },
        },
        required: ["path", "oldText", "newText"],
        additionalProperties: false,
      },
    },
  },
  required: ["entrypoint", "edits"],
  additionalProperties: false,
};
export const projectEditDescription = "Make a small exact-match change to existing user-selected project source. Prefer this over write_project for follow-up edits to avoid repeating whole files. Supply 1–16 edits, at most 8000 total path/search/replacement characters, and the existing entrypoint. Each nonempty oldText must occur exactly once in its current file, including whitespace; edits match the original source, must not overlap, and are applied atomically. No creation, deletion, fuzzy matching, or editing unselected files. The browser validates and runs the combined project in isolation and returns diagnostics.";

export function validateProjectEdits(value: unknown): ProjectEdit[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error("Provide 1–16 exact-match edits.");
  let total = 0;
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid edit.");
    const { path, oldText, newText } = item;
    if (Object.keys(item).some(key => !["path", "oldText", "newText"].includes(key)) ||
        typeof path !== "string" || !path || path.length > 160 ||
        !/^[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").some(part => !part || part === "." || part === "..") ||
        typeof oldText !== "string" || !oldText.length || oldText.length > 2000 ||
        typeof newText !== "string" || newText.length > 2000) throw new Error("Invalid edit path or text size.");
    total += path.length + oldText.length + newText.length;
    if (total > 8000) throw new Error("Edits exceed the 8000-character limit.");
    return { path, oldText, newText };
  });
}

export function applyProjectEdits(
  files: { path: string; content: string }[], selectedPaths: readonly string[], value: unknown,
): { path: string; content: string }[] {
  const edits = validateProjectEdits(value);
  const ranges = new Map<string, { start: number; end: number; text: string }[]>();
  for (const edit of edits) {
    const file = files.find(file => file.path === edit.path);
    if (!file || !selectedPaths.includes(edit.path)) throw new Error(`Edit target is missing or not selected: ${edit.path}`);
    const start = file.content.indexOf(edit.oldText);
    if (start < 0) throw new Error(`Exact edit text was not found: ${edit.path}`);
    if (file.content.indexOf(edit.oldText, start + 1) >= 0) throw new Error(`Exact edit text is ambiguous: ${edit.path}`);
    const end = start + edit.oldText.length;
    const list = ranges.get(edit.path) ?? [];
    if (list.some(range => start < range.end && end > range.start)) throw new Error(`Edits overlap: ${edit.path}`);
    list.push({ start, end, text: edit.newText });
    ranges.set(edit.path, list);
  }
  return files.map(file => {
    let content = file.content;
    for (const range of (ranges.get(file.path) ?? []).sort((a, b) => b.start - a.start)) {
      content = content.slice(0, range.start) + range.text + content.slice(range.end);
    }
    return { ...file, content };
  });
}
