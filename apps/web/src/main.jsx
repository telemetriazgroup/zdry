import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { APP_ROOT, installHistorySlashFix } from "./api.js";
import "./styles.css";

installHistorySlashFix();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={APP_ROOT === "/" ? "/" : APP_ROOT.replace(/\/$/, "")}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
