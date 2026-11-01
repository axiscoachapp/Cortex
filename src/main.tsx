import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// After a deploy, an open tab may request lazy chunks that no longer exist
// (the SPA rewrite serves HTML instead). Reload once to pick up the new build.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const key = 'cortex-chunk-reload';
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return; // avoid a reload loop
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // storage unavailable: still try once
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
