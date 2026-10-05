import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Director } from "./pages/Director";
import { Output } from "./pages/Output";
import { Phone } from "./pages/Phone";
import { appPath, currentAppPath } from "./basePath";
import "./styles.css";
import "./imageMotion.css";

function App() {
  const path = currentAppPath();
  if (path === "/director") return <Director />;
  if (path === "/output") return <Output />;
  if (path === "/phone") return <Phone />;

  return (
    <main className="landing-shell">
      <p className="eyebrow">YouTube Overlay</p>
      <h1>General Conference Director</h1>
      <p>Choose which screen this browser should open.</p>
      <div className="landing-actions">
        <a className="primary-link" href={appPath("director")}>Director console</a>
        <a className="secondary-link" href={appPath("output")}>TV output</a>
        <a className="download-link" href={appPath("downloads/youtube-overlay-tv.apk")} download>
          Download Superbox APK
        </a>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
