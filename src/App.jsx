import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [autoMonitorOn, setAutoMonitorOn] = useState(false);
  const [history, setHistory] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // ⚙️ Azure Speech config (front-end)
  const speechKey = import.meta.env.VITE_AZURE_SPEECH_KEY;
  const speechRegion = import.meta.env.VITE_AZURE_SPEECH_REGION;

  // 🎥 Ask for camera when component mounts
  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error(err);
        setError("Could not access camera. Check browser permissions.");
      }
    }

    setupCamera();
  }, []);

  // 📝 Push a new snapshot into history (max 6 items)
  const pushToHistory = useCallback((analysis) => {
    const status = analysis?.aiDecision?.status ?? "UNKNOWN";
    const summary =
      analysis?.aiDecision?.reason ||
      analysis?.sceneDescription?.slice(0, 120) ||
      "No summary";

    const entry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status,
      summary,
    };

    setHistory((prev) => [entry, ...prev].slice(0, 6));
  }, []);

  // 🎯 Capture frame and call backend
  const captureAndAnalyze = useCallback(
    async (isAuto = false) => {
      if (!videoRef.current || !canvasRef.current) return;

      if (!isAuto) {
        setLoading(true);
        setResult(null);
      }
      setError("");

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      // Set canvas to match video size
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 540;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg");
      const base64 = dataUrl.split(",")[1];

      try {
        const response = await axios.post("http://localhost:5000/analyze-room", {
          imageBase64: base64,
        });

        const data = response.data;
        setResult(data);
        pushToHistory(data);
      } catch (err) {
        console.error(err);
        if (!isAuto) {
          setError(
            err.response?.data?.error ||
              "Analysis failed. Make sure the backend is running on port 5000."
          );
        }
      } finally {
        if (!isAuto) setLoading(false);
      }
    },
    [pushToHistory]
  );

  // 🔁 Auto-monitor every 10 seconds
  useEffect(() => {
    if (!autoMonitorOn) return;

    const id = setInterval(() => {
      captureAndAnalyze(true);
    }, 10000); // 10s

    return () => clearInterval(id);
  }, [autoMonitorOn, captureAndAnalyze]);

  // 🗣 Speak status via Azure Speech
  const handleSpeakStatus = async () => {
    if (!result) {
      console.warn("No analysis result available to speak.");
      return;
    }

    if (!speechKey || !speechRegion) {
      console.error("Missing Speech config. Check VITE_AZURE_SPEECH_KEY and VITE_AZURE_SPEECH_REGION.");
      setError(
        "Speech is not configured. Add VITE_AZURE_SPEECH_KEY and VITE_AZURE_SPEECH_REGION in your .env.local file."
      );
      return;
    }

    if (isSpeaking) return;

    const status = result.aiDecision?.status ?? "unknown";
    const reason = result.aiDecision?.reason ?? "No detailed reason.";
    const action = result.aiDecision?.action ?? "No specific action suggested.";

    const text = `Current room status is ${status}. ${reason}. Suggested action: ${action}.`;
    console.log("Speaking with text:", text);

    try {
      setIsSpeaking(true);

      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
        speechKey,
        speechRegion
      );
      speechConfig.speechSynthesisVoiceName = "en-US-JennyNeural";

      // Use default speaker output for audio
      const audioConfig = SpeechSDK.AudioConfig.fromDefaultSpeakerOutput();

      const synthesizer = new SpeechSDK.SpeechSynthesizer(
        speechConfig,
        audioConfig
      );

      await new Promise((resolve, reject) => {
        synthesizer.speakTextAsync(
          text,
          () => {
            synthesizer.close();
            resolve();
          },
          (err) => {
            console.error("Speech synthesis error:", err);
            synthesizer.close();
            reject(err);
          }
        );
      });
    } catch (err) {
      console.error("Speech error:", err);
      setError(
        "Could not play speech. Check browser audio permissions and console logs for details."
      );
    } finally {
      setIsSpeaking(false);
    }
  };

  // 🧠 Derived UI data
  const status = result?.aiDecision?.status ?? "NO DATA";
  const isEmergency = status === "EMERGENCY";
  const isWarning = status === "WARNING";
  const isNormal = status === "NORMAL"; // currently unused but fine

  // These rely on backend enhancements
  const peopleCount =
    result?.peopleCount ??
    result?.vision?.peopleCount ??
    result?.aiDecision?.peopleCount ??
    null;

  const fallRisk = result?.signals?.fallRisk ?? false;
  const voiceStress = result?.signals?.voiceStress ?? false;

  const snapshotsCount = history.length;
  const alertsCount = history.filter(
    (h) => h.status === "WARNING" || h.status === "EMERGENCY"
  ).length;

  const currentStatusLabel = result ? status : "No data";

  // 🔧 Small helper for status pill colours
  const statusPillStyle = (s) => {
    let bg = "#4b5563";
    if (s === "NORMAL") bg = "#16a34a";
    if (s === "WARNING") bg = "#f97316";
    if (s === "EMERGENCY") bg = "#b91c1c";

    return {
      background: bg,
      color: "white",
      padding: "0.2rem 0.7rem",
      borderRadius: "999px",
      fontSize: "0.8rem",
      fontWeight: 600,
    };
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        background:
          "radial-gradient(120% 160% at 0% 0%, #1f2937 0%, #020617 45%, #000 100%)",
        color: "#e5e7eb",
      }}
    >
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          padding: "24px 32px 40px",
        }}
      >
        {/* HEADER */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1.5rem",
            alignItems: "center",
            marginBottom: "1.75rem",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "2.4rem",
                margin: 0,
                letterSpacing: "-0.04em",
              }}
            >
              Smart Safe Room AI
            </h1>
            <p style={{ opacity: 0.8, marginTop: "0.3rem" }}>
              Webcam-based room understanding with Azure Vision, OpenAI & Speech.
            </p>
          </div>

          <button
            onClick={() => setAutoMonitorOn((prev) => !prev)}
            style={{
              borderRadius: "999px",
              padding: "0.6rem 1.3rem",
              border: "1px solid rgba(148, 163, 184, 0.6)",
              background: autoMonitorOn
                ? "rgba(34,197,94,0.15)"
                : "rgba(15,23,42,0.8)",
              color: autoMonitorOn ? "#bbf7d0" : "#e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.9rem",
            }}
          >
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "999px",
                background: autoMonitorOn ? "#22c55e" : "#64748b",
                boxShadow: autoMonitorOn
                  ? "0 0 10px rgba(34,197,94,0.9)"
                  : "none",
              }}
            />
            {autoMonitorOn ? "Auto-monitor ON" : "Enable auto-monitor"}
          </button>
        </header>

        {/* STATS ROW */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          {/* Current status */}
          <div
            style={{
              background: "rgba(15,23,42,0.9)",
              borderRadius: "0.9rem",
              padding: "0.9rem 1.1rem",
              border: "1px solid rgba(30,64,175,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
            }}
          >
            <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              Current status
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "999px",
                  background: isEmergency
                    ? "#b91c1c"
                    : isWarning
                    ? "#f97316"
                    : "#22c55e",
                }}
              />
              <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                {currentStatusLabel}
              </span>
            </div>
          </div>

          {/* Snapshots */}
          <div
            style={{
              background: "rgba(15,23,42,0.9)",
              borderRadius: "0.9rem",
              padding: "0.9rem 1.1rem",
              border: "1px solid rgba(30,64,175,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
            }}
          >
            <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              Snapshots this session
            </span>
            <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>
              {snapshotsCount}
            </span>
          </div>

          {/* Alerts */}
          <div
            style={{
              background: "rgba(15,23,42,0.9)",
              borderRadius: "0.9rem",
              padding: "0.9rem 1.1rem",
              border: "1px solid rgba(30,64,175,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
            }}
          >
            <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              Alerts (warning / emergency)
            </span>
            <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>
              {alertsCount}
            </span>
          </div>
        </section>

        {/* MAIN CONTENT ROW */}
        <section
          style={{
            display: "flex",
            gap: "1.5rem",
            alignItems: "flex-start",
          }}
        >
          {/* LEFT: CAMERA + ACTION */}
          <div style={{ flex: "0 0 48%" }}>
            <div
              style={{
                background: "rgba(15,23,42,0.95)",
                borderRadius: "1rem",
                padding: "1rem",
                border: "1px solid rgba(30,64,175,0.6)",
                boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{
                  width: "100%",
                  maxWidth: "720px",
                  height: "540px",
                  borderRadius: "0.9rem",
                  border: "1px solid rgba(15,23,42,0.8)",
                  background: "black",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "0.9rem",
                  gap: "0.8rem",
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => captureAndAnalyze(false)}
                  disabled={loading}
                  style={{
                    borderRadius: "999px",
                    border: "none",
                    padding: "0.85rem 1.6rem",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    background: loading
                      ? "#4b5563"
                      : "linear-gradient(135deg,#22c55e,#16a34a)",
                    color: "white",
                    cursor: loading ? "default" : "pointer",
                    boxShadow: loading
                      ? "none"
                      : "0 18px 40px rgba(22,163,74,0.5)",
                  }}
                >
                  {loading ? "Analyzing…" : "Analyze Current Frame"}
                </button>

                <span
                  style={{
                    fontSize: "0.8rem",
                    opacity: 0.7,
                    whiteSpace: "nowrap",
                  }}
                >
                  Tip: enable auto-monitor for continuous safety.
                </span>
              </div>
            </div>

            {error && (
              <p
                style={{
                  color: "#fecaca",
                  fontSize: "0.85rem",
                  marginTop: "0.6rem",
                }}
              >
                {error}
              </p>
            )}
          </div>

          {/* RIGHT: STATUS + ADVANCED SIGNALS + SESSION HISTORY */}
          <div
            style={{ flex: "1", display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {/* AI SAFETY STATUS */}
            <div
              style={{
                background: "rgba(15,23,42,0.95)",
                borderRadius: "1rem",
                padding: "1.1rem 1.3rem",
                border: "1px solid rgba(30,64,175,0.6)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.75rem",
                  gap: "0.75rem",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>AI Safety Status</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={statusPillStyle(status)}>{status}</span>
                  <button
                    onClick={handleSpeakStatus}
                    disabled={!result || isSpeaking}
                    style={{
                      borderRadius: "999px",
                      padding: "0.45rem 0.9rem",
                      border: "1px solid rgba(148,163,184,0.8)",
                      background: "rgba(15,23,42,0.9)",
                      color: "#e5e7eb",
                      fontSize: "0.8rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      cursor: !result || isSpeaking ? "default" : "pointer",
                    }}
                  >
                    <span role="img" aria-label="speaker">
                      🔊
                    </span>
                    {isSpeaking ? "Speaking…" : "Speak status"}
                  </button>
                </div>
              </div>

              {!result && (
                <p style={{ opacity: 0.8, fontSize: "0.9rem" }}>
                  No analysis yet. Point the camera at your room and click{" "}
                  <strong>“Analyze Current Frame”</strong>, or enable auto-monitoring.
                </p>
              )}

              {result && (
                <>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      opacity: 0.8,
                      marginBottom: "0.35rem",
                    }}
                  >
                    <strong>Scene description (from Vision):</strong>
                  </p>
                  <pre
                    style={{
                      background: "#020617",
                      borderRadius: "0.7rem",
                      padding: "0.6rem 0.75rem",
                      whiteSpace: "pre-wrap",
                      fontSize: "0.82rem",
                      border: "1px solid rgba(30,64,175,0.7)",
                      maxHeight: "150px",
                      overflowY: "auto",
                    }}
                  >
                    {result.sceneDescription}
                  </pre>

                  <div style={{ marginTop: "0.7rem", fontSize: "0.88rem" }}>
                    <p style={{ margin: "0.25rem 0" }}>
                      <strong>Reason: </strong>
                      {result.aiDecision?.reason}
                    </p>
                    <p style={{ margin: "0.25rem 0" }}>
                      <strong>Suggested action: </strong>
                      {result.aiDecision?.action}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* ADVANCED SIGNALS */}
            <div
              style={{
                background: "rgba(15,23,42,0.95)",
                borderRadius: "1rem",
                padding: "0.9rem 1.1rem",
                border: "1px solid rgba(30,64,175,0.6)",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  marginBottom: "0.6rem",
                  fontSize: "0.95rem",
                  opacity: 0.9,
                }}
              >
                Advanced safety signals (from Azure, optional)
              </h3>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "0.8rem",
                  fontSize: "0.82rem",
                }}
              >
                {/* Multi-person */}
                <div
                  style={{
                    background: "#020617",
                    borderRadius: "0.7rem",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid rgba(30,64,175,0.7)",
                  }}
                >
                  <div style={{ opacity: 0.75, marginBottom: "0.25rem" }}>
                    Multi-person presence
                  </div>
                  <div style={{ fontWeight: 600 }}>
                    {peopleCount == null ? "N/A" : `${peopleCount} person(s)`}{" "}
                  </div>
                  <div style={{ opacity: 0.7, marginTop: "0.1rem" }}>
                    {peopleCount == null
                      ? "No detection results for this frame."
                      : peopleCount === 0
                      ? "No people detected in the current frame."
                      : peopleCount === 1
                      ? "One person detected in the room."
                      : "Multiple people detected – room may be crowded."}
                  </div>
                </div>

                {/* Fall risk */}
                <div
                  style={{
                    background: "#020617",
                    borderRadius: "0.7rem",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid rgba(30,64,175,0.7)",
                  }}
                >
                  <div style={{ opacity: 0.75, marginBottom: "0.25rem" }}>
                    Fall / posture anomaly
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: fallRisk ? "#f97316" : "#22c55e",
                    }}
                  >
                    {fallRisk ? "Possible fall detected" : "No fall signal"}
                  </div>
                  <div style={{ opacity: 0.7, marginTop: "0.1rem" }}>
                    {fallRisk
                      ? "Azure Vision bounding boxes suggest an unusual (lying) posture."
                      : "No unusual posture detected in this frame."}
                  </div>
                </div>

                {/* Voice stress */}
                <div
                  style={{
                    background: "#020617",
                    borderRadius: "0.7rem",
                    padding: "0.55rem 0.7rem",
                    border: "1px solid rgba(30,64,175,0.7)",
                  }}
                >
                  <div style={{ opacity: 0.75, marginBottom: "0.25rem" }}>
                    Voice stress / tone
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: voiceStress ? "#f97316" : "#22c55e",
                    }}
                  >
                    {voiceStress ? "Elevated stress" : "No stress signal"}
                  </div>
                  <div style={{ opacity: 0.7, marginTop: "0.1rem" }}>
                    {voiceStress
                      ? "Audio analysis detected elevated stress in the voice."
                      : "No audio stress analysis has been performed yet (microphone input is disabled)."}
                  </div>
                </div>
              </div>
            </div>

            {/* SESSION HISTORY */}
            <div
              style={{
                background: "rgba(15,23,42,0.95)",
                borderRadius: "1rem",
                padding: "0.9rem 1.1rem",
                border: "1px solid rgba(30,64,175,0.6)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.5rem",
                  fontSize: "0.9rem",
                }}
              >
                <span style={{ opacity: 0.9 }}>Session history</span>
                <span style={{ opacity: 0.6 }}>
                  Last {history.length} snapshot{history.length !== 1 ? "s" : ""}
                </span>
              </div>

              {history.length === 0 && (
                <p style={{ opacity: 0.8, fontSize: "0.85rem" }}>
                  No history yet. Each analysis will appear here with time and
                  status.
                </p>
              )}

              {history.length > 0 && (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.45rem",
                  }}
                >
                  {history.map((item) => (
                    <li
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.6rem",
                        fontSize: "0.83rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.15rem",
                          flex: 1,
                        }}
                      >
                        <span style={{ opacity: 0.6 }}>{item.time}</span>
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.summary}
                        </span>
                      </div>
                      <span style={statusPillStyle(item.status)}>
                        {item.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
