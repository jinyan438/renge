import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { installAndroidBackgroundTimerShim } from "./androidBackgroundRuntime";
import { AppErrorBoundary } from "./AppErrorBoundary";
import "./index.css";
import "./styles.css";
import "./settings-desktop.css";
import "./workspace-desktop.css";
import "./chat-conversation.css";

installAndroidBackgroundTimerShim();

const App = lazy(() => import("./App").then((module) => ({ default: module.App })));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<div className="app-boot">正在启动 Renge...</div>}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>,
);
