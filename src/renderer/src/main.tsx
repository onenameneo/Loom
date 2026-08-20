import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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
    <App />
  </StrictMode>,
);

requestAnimationFrame(() => window.api?.lifecycle.ready());
