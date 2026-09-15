import "@fontsource-variable/plus-jakarta-sans";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Gmail Agent mount point is missing");
createRoot(root).render(<App />);
