import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { ToastProvider } from "./ui/ToastProvider";
import "@xyflow/react/dist/style.css";
import "./tokens.css";
import "./tailwind.css";
import "./shell.css";
import "./message/message.css";
import "./canvas/canvas.css";
import "./workbench/monacoEnvironment";
import "./workbench/files/files.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);

requestAnimationFrame(() => window.api?.lifecycle.ready());
