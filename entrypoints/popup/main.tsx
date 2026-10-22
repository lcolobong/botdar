import { render } from "preact";
import "@/src/ui/card.css";
import "@/src/ui/pages.css";
import { applyPageTheme } from "@/src/ui/pageTheme";
import { App } from "@/src/ui/popup/App";

applyPageTheme();
const root: HTMLElement | null = document.getElementById("app");
if (root !== null) render(<App />, root);
