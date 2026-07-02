import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Global error listener to display error overlays for debugging client-side crashes
const showErrorOverlay = (message, source, lineno, colno, error) => {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100vw";
  container.style.height = "100vh";
  container.style.backgroundColor = "rgba(10, 10, 12, 0.98)";
  container.style.color = "#ff4a4a";
  container.style.fontFamily = "monospace";
  container.style.padding = "40px";
  container.style.boxSizing = "border-box";
  container.style.zIndex = "999999";
  container.style.overflowY = "auto";
  
  const title = document.createElement("h1");
  title.innerText = "⚠️ Frontend Runtime Exception";
  title.style.margin = "0 0 20px 0";
  title.style.fontSize = "24px";
  container.appendChild(title);

  const errorText = document.createElement("div");
  errorText.innerHTML = `<strong>Error:</strong> ${message}<br><br><strong>Location:</strong> ${source}:${lineno}:${colno}<br><br><strong>Stack:</strong><br><pre style="white-space: pre-wrap; background: #1a1a1f; padding: 16px; border-radius: 6px; border: 1px solid #333; color: #ccc;">${error?.stack || "No stack trace available"}</pre>`;
  container.appendChild(errorText);

  document.body.appendChild(container);
};

window.addEventListener("error", (event) => {
  showErrorOverlay(event.message, event.filename, event.lineno, event.colno, event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  const err = event.reason;
  showErrorOverlay(err?.message || "Unhandled Promise Rejection", "", 0, 0, err);
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
