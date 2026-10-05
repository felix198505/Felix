import { useEffect, useState } from "react";
import { flushOutbox, outbox } from "../offline";
import { useStore } from "../store";

/** Hinweisleiste: offline und/oder Ideen, die noch hochgeladen werden müssen */
export function OfflineBar() {
  const { offline, reload, toast } = useStore();
  const [waiting, setWaiting] = useState(outbox().length);
  useEffect(() => {
    const on = () => setWaiting(outbox().length);
    window.addEventListener("ib-outbox", on);
    return () => window.removeEventListener("ib-outbox", on);
  }, []);
  if (!offline && !waiting) return null;
  return (
    <div className="offline-bar no-print">
      {offline ? "📡 Offline – ihr seht den letzten bekannten Stand. Neue Ideen werden gespeichert und später hochgeladen." : "⏳ Ideen warten aufs Hochladen."}
      {waiting > 0 && (
        <b>
          {" "}
          {waiting} {waiting === 1 ? "Idee wartet" : "Ideen warten"}.
        </b>
      )}
      {!offline && waiting > 0 && (
        <button
          className="btn small"
          onClick={async () => {
            const n = await flushOutbox();
            if (n) toast(`${n} hochgeladen`);
            reload();
          }}
        >
          Jetzt hochladen
        </button>
      )}
    </div>
  );
}
