import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Director } from "./pages/Director";
import { Output } from "./pages/Output";
import "./styles.css";

function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/director") return <Director />;
  if (path === "/output") return <Output />;

  return (
    <main className="landing-shell">
      <p className="eyebrow">YouTube Overlay</p>
      <h1>General Conference Director</h1>
      <p>Choose which screen this browser should open.</p>
      <div className="landing-actions">
        <a className="primary-link" href="/director">Director console</a>
        <a className="secondary-link" href="/output">TV output</a>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
