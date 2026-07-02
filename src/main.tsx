import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (rootEl === null) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
