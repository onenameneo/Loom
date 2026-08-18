import type { FileMentionRef } from "./fileMentions";

export interface ComposerBudgetImage {
  data: string;
  mimeType: string;
}

export interface ComposerBudgetPreviewInput {
  text?: string;
  images?: ComposerBudgetImage[];
  skillIds?: string[];
  mentions?: FileMentionRef[];
}
