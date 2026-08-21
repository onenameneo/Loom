import type { FileMentionRef } from "./fileMentions";
import type { SelectionContextNote } from "./selectionContext";

export interface ComposerBudgetImage {
  data: string;
  mimeType: string;
}

export interface ComposerBudgetPreviewInput {
  text?: string;
  images?: ComposerBudgetImage[];
  skillIds?: string[];
  mentions?: FileMentionRef[];
  selectionNotes?: SelectionContextNote[];
}
