import { useEffect, useRef, useState } from "react";

// Spracheingabe über die Spracherkennung des Browsers (Chrome, Edge, Safari)
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => !!getRecognition();

/** Mikrofon-Knopf: hängt das Gesprochene an den bestehenden Text an */
export function MicButton({ value, onChange, title = "Spracheingabe" }: { value: string; onChange: (v: string) => void; title?: string }) {
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const base = useRef("");

  useEffect(() => () => rec.current?.stop(), []);
  if (!speechSupported()) return null;

  function toggle() {
    if (on) {
      rec.current?.stop();
      return;
    }
    const R = getRecognition()!;
    const r = new R();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    base.current = value ? value.replace(/\s*$/, " ") : "";
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onChange((base.current + finalText + interim).replace(/\s+/g, " ").trimStart());
    };
    r.onend = () => setOn(false);
    r.onerror = (e) => {
      setOn(false);
      if (e.error === "not-allowed") alert("Bitte den Mikrofon-Zugriff für diese Seite erlauben.");
    };
    rec.current = r;
    r.start();
    setOn(true);
    navigator.vibrate?.(10);
  }

  return (
    <button type="button" className={"btn mic" + (on ? " live" : "")} onClick={toggle} title={on ? "Aufnahme beenden" : title} aria-label={title}>
      {on ? "■" : "🎙"}
    </button>
  );
}
