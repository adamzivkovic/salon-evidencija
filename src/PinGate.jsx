import React, { useState, useRef, useEffect } from "react";
import { Lock } from "lucide-react";
import { APP_PIN } from "./appLock";

const FONT_DISPLAY = "'Fraunces', serif";
const FONT_BODY = "'Work Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

export default function PinGate({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, APP_PIN.length);
    setPin(digits);
    setError(false);
    if (digits.length === APP_PIN.length) {
      if (digits === APP_PIN) {
        onUnlock();
      } else {
        setError(true);
        setTimeout(() => setPin(""), 400);
      }
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card} onClick={() => inputRef.current?.focus()}>
        <Lock size={26} color="#C4914B" />
        <div style={styles.title}>Salon 2CATS</div>
        <p style={styles.subtitle}>Unesi šifru za pristup</p>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={pin}
          onChange={handleChange}
          style={{ ...styles.input, ...(error ? styles.inputError : {}) }}
          maxLength={APP_PIN.length}
        />

        <div style={styles.dots}>
          {Array.from({ length: APP_PIN.length }).map((_, i) => (
            <span key={i} style={{ ...styles.dot, ...(i < pin.length ? styles.dotFilled : {}) }} />
          ))}
        </div>

        {error && <p style={styles.errorText}>Pogrešna šifra, pokušaj ponovo.</p>}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#FBF6EE", fontFamily: FONT_BODY, padding: 20,
  },
  card: {
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
    gap: 10, background: "#FFFDF9", border: "1px solid #EFE3D0", borderRadius: 16,
    padding: "32px 28px", maxWidth: 320, width: "100%",
  },
  title: { fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: "#2B1B1F" },
  subtitle: { fontSize: 13, color: "#8A7368", margin: "0 0 8px" },
  input: {
    position: "absolute", opacity: 0, height: 1, width: 1, pointerEvents: "none",
  },
  dots: { display: "flex", gap: 10, cursor: "text" },
  dot: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #E8DCC8", background: "#FBF6EE" },
  dotFilled: { background: "#7A2E3D", borderColor: "#7A2E3D" },
  errorText: { color: "#A13A3A", fontSize: 12.5, marginTop: 4 },
};
