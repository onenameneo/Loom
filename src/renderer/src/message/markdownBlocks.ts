/**
 * Split Markdown at top-level blank lines while respecting fenced code.
 * Completed blocks keep their own React keys during streaming, so only the
 * unfinished tail needs to be parsed again.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  if (!markdown) return [];
  const blocks: string[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let current: string[] = [];
  let fenced = false;

  const flush = () => {
    if (current.length === 0) return;
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of lines) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fenced && !line.trim()) {
      flush();
      continue;
    }
    current.push(line);
    if (fence) fenced = !fenced;
  }
  flush();
  return blocks;
}
