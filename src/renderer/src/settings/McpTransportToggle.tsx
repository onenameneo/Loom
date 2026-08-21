import { ToggleGroup } from "radix-ui";

export function McpTransportToggle({ value, onChange }: { value: "stdio" | "streamable-http"; onChange: (value: "stdio" | "streamable-http") => void }) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => { if (next === "stdio" || next === "streamable-http") onChange(next); }}
      className="mcp-segmented"
      aria-label="MCP 类型"
    >
      <ToggleGroup.Item value="stdio" className="mcp-segmented__item">STDIO</ToggleGroup.Item>
      <ToggleGroup.Item value="streamable-http" className="mcp-segmented__item">流式 HTTP</ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}
