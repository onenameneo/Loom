import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker.js?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

type MonacoWorkerFactory = new () => Worker;

type MonacoEnvironmentWithWorkers = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker;
  };
};

export function installMonacoWorkerEnvironment(): void {
  const globalWithMonaco = globalThis as MonacoEnvironmentWithWorkers;
  globalWithMonaco.MonacoEnvironment = {
    getWorker: (_workerId, label) => {
      const Factory = workerFactoryFor(label);
      return new Factory();
    },
  };
}

export function workerFactoryFor(label: string): MonacoWorkerFactory {
  switch (label) {
    case "json":
      return JsonWorker;
    case "css":
    case "scss":
    case "less":
      return CssWorker;
    case "html":
    case "handlebars":
    case "razor":
      return HtmlWorker;
    case "typescript":
    case "javascript":
      return TypeScriptWorker;
    default:
      return EditorWorker;
  }
}

installMonacoWorkerEnvironment();
