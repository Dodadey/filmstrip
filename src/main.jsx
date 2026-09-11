import React from "react";
import { createRoot } from "react-dom/client";
import Filmstrip from "./App.jsx";

createRoot(document.getElementById("root")).render(<Filmstrip />);

// Register the service worker so the app opens without a connection.
// Scope is relative, so this works from a project subpath on GitHub Pages.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
