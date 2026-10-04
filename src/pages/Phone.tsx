import { useEffect, useRef } from 'react';
import { useBroadcaster } from '../media/useBroadcaster';
import './phone.css';

type PhoneSource = 'phone1' | 'phone2' | 'phone3' | 'phone4';

const PHONE_LABELS: Record<PhoneSource, string> = {
  phone1: 'Phone camera 1',
  phone2: 'Phone camera 2',
  phone3: 'Phone camera 3',
  phone4: 'Phone camera 4',
};

function isPhoneSource(value: string | null): value is PhoneSource {
  return value === 'phone1' || value === 'phone2' || value === 'phone3' || value === 'phone4';
}

const STATUS_LABELS = {
  idle: 'Not started',
  requesting: 'Waiting for permission',
  connecting: 'Connecting',
  ready: 'Ready for director',
  reconnecting: 'Reconnecting',
  error: 'Needs attention',
} as const;

export function Phone() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const broadcaster = useBroadcaster();
  const params = new URLSearchParams(window.location.search);
  const sourceValue = params.get('source');
  const sourceValid = isPhoneSource(sourceValue);
  const source = sourceValid ? sourceValue : null;
  const token = params.get('token') ?? '';
  const inviteValid = sourceValid && token.length > 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = broadcaster.localStream;
    if (broadcaster.localStream) void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === broadcaster.localStream) video.srcObject = null;
    };
  }, [broadcaster.localStream]);

  function start() {
    if (source) void broadcaster.start({ source, token });
  }

  return (
    <main className="phone-shell">
      <header className="phone-header">
        <p className="eyebrow">YouTube Overlay</p>
        <h1>{source ? PHONE_LABELS[source] : 'Phone camera'}</h1>
        <p className="phone-intro">Connect this phone as a live camera and microphone input for the director.</p>
      </header>

      {!inviteValid ? (
        <section className="phone-card phone-invalid" role="alert">
          <span className="phone-icon" aria-hidden="true">!</span>
          <h2>This invite link is incomplete</h2>
          <p>Ask the director for a new source-specific phone link.</p>
        </section>
      ) : (
        <>
          <section className="phone-card phone-preview-card" aria-label="Phone camera preview">
            <div className="phone-preview-frame">
              {broadcaster.localStream ? (
                <video ref={videoRef} autoPlay muted playsInline aria-label="Muted local camera preview" />
              ) : (
                <div className="phone-preview-placeholder">
                  <span className="phone-camera-icon" aria-hidden="true">◉</span>
                  <strong>Camera preview</strong>
                  <span>Your camera stays off until you press Start.</span>
                </div>
              )}
              {broadcaster.localStream && <span className="preview-muted">Local preview muted</span>}
            </div>

            <div className="phone-status-row">
              <span className={`phone-status-dot ${broadcaster.status}`} aria-hidden="true" />
              <span>{STATUS_LABELS[broadcaster.status]}</span>
            </div>
            {broadcaster.error && <p className="phone-error" role="alert">{broadcaster.error}</p>}
          </section>

          <section className="phone-card phone-actions">
            <p className="phone-permission-note">Camera and microphone access is requested only when you press Start.</p>
            {broadcaster.localStream ? (
              <div className="phone-button-stack">
                {broadcaster.status === 'error' && (
                  <button className="phone-start-button" type="button" onClick={start}>Retry connection</button>
                )}
                <button className="phone-stop-button" type="button" onClick={broadcaster.stop}>Stop camera</button>
              </div>
            ) : (
              <button className="phone-start-button" type="button" onClick={start} disabled={broadcaster.status === 'requesting'}>
                {broadcaster.status === 'requesting' ? 'Starting…' : 'Start camera'}
              </button>
            )}
            <p className="phone-network-note">Some restrictive networks require a TURN relay for camera connections.</p>
          </section>
        </>
      )}
    </main>
  );
}
