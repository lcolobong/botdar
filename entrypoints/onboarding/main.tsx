import { render } from "preact";
import "@/src/ui/badge.css";
import "@/src/ui/card.css";
import "@/src/ui/pages.css";
import { App } from "@/src/ui/onboarding/App";
import { applyPageTheme } from "@/src/ui/pageTheme";

applyPageTheme();
const root: HTMLElement | null = document.getElementById("app");
if (root !== null) render(<App />, root);
