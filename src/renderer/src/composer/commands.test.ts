import { describe, expect, it } from "vitest";
import { visibleCommands } from "./commands";

describe("composer command visibility", () => {
  it("keeps the plus menu focused on image attachments", () => {
    expect(visibleCommands("insert", { canRegenerate: false }).map((command) => command.id)).toEqual(["insert-image"]);
  });

  it("does not expose removed persona or attach slash commands", () => {
    expect(visibleCommands("action", { canRegenerate: false }).map((command) => command.id)).not.toEqual(expect.arrayContaining(["persona", "attach"]));
  });
});
