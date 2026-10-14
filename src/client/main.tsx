import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/player.css";
import "./styles/tv.css";
import "./styles/admin.css";

createRoot(document.getElementById("root")!).render(<App />);
