import {
  isDefaultNodeTitle,
  isDefaultSessionTitle,
  type DefaultTitleState,
} from "../../../common/titleDefaults";
import type { TranslationKey } from "./I18nProvider";

type Translate = (key: TranslationKey) => string;

export function localizedSessionTitle(title: string, translate: Translate, titleState?: DefaultTitleState): string {
  return titleState === "default" || (!titleState && isDefaultSessionTitle(title))
    ? translate("title.defaultSession")
    : title;
}

export function localizedNodeTitle(title: string, translate: Translate, titleState?: DefaultTitleState): string {
  if (!(titleState === "default" || (!titleState && isDefaultNodeTitle(title)))) return title;
  return title === "起点" || title === "主线"
    ? translate("title.root")
    : translate("title.branch");
}
