import type { Context } from "hono";
import { addHistory, getSetting, nowIso, setSetting } from "./db";
import type { AppEnv } from "./env";
import { kickAnalysis } from "./ai";

/** Fünf Beispielkarten für den Start. Die KI-Analyse läuft danach automatisch. */
const EXAMPLES = [
  {
    title: "Wartungsabo für Markisen und Überdachungen",
    description:
      "Bestandskunden ein jährliches Wartungspaket anbieten: Reinigung, Dichtungen prüfen, Markisentuch und Motor checken. Bringt planbare Einnahmen im Winter und hält den Kontakt für Folgeaufträge.",
    column: "ausarbeiten",
    by: "felix",
    category: "Vertrieb",
    comment: { by: "tim", text: "Gute Idee. Wir haben ca. 300 Bestandskunden der letzten 5 Jahre in der Kartei." },
  },
  {
    title: "Nach jeder Montage Google-Bewertung anfragen",
    description: "Kunden direkt nach der Abnahme per QR-Code oder SMS um eine Bewertung bitten. Ziel: mehr Sterne als die Konkurrenz in der Region.",
    column: "entscheiden",
    by: "tim",
    category: "Marketing",
    benefit: 4,
    effort: 1,
  },
  {
    title: "Fotodokumentation der Montage per Handy",
    description: "Monteure fotografieren Untergrund, Befestigung und fertige Anlage nach festem Ablauf. Hilft bei Reklamationen und als Material für Social Media.",
    column: "eingang",
    by: "tim",
    category: "Montage",
  },
  {
    title: "Kaltwintergarten als Ausstellungsstück auf dem Hof",
    description: "Eine Musteranlage aufbauen, in der Kunden Glas, Schiebeelemente und Beschattung live erleben können. Termine vor Ort statt nur Prospekt.",
    column: "eingang",
    by: "felix",
    category: "Produkte",
  },
  {
    title: "Umwandlung in eine GmbH prüfen",
    description: "Haftung begrenzen und steuerliche Vor- und Nachteile klären. Ab welchem Gewinn lohnt sich das? Was kostet die Gründung, was ändert sich bei Buchhaltung und Versicherungen?",
    column: "parkplatz",
    by: "felix",
    category: "GmbH-Gründung",
    followUpDays: 0,
  },
];

export async function seedExamples(c: Context<AppEnv>): Promise<number> {
  const db = c.env.DB;
  if (await getSetting(db, "examples_seeded")) return 0;
  let pos = -1000;
  for (const ex of EXAMPLES) {
    const cat = await db.prepare("SELECT id FROM categories WHERE name = ?").bind(ex.category).first<{ id: number }>();
    const now = nowIso();
    const followUp = ex.followUpDays !== undefined ? new Date(Date.now() + ex.followUpDays * 86400000).toISOString().slice(0, 10) : null;
    const r = await db
      .prepare(
        `INSERT INTO cards (title, description, column_key, position, created_by, created_at, updated_at, category_id, benefit, effort, follow_up, ai_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .bind(ex.title, ex.description, ex.column, pos++, ex.by, now, now, cat?.id ?? null, ex.benefit ?? null, ex.effort ?? null, followUp)
      .run();
    const id = Number(r.meta.last_row_id);
    await addHistory(db, id, ex.by, "erstellt", "Beispielkarte");
    if (ex.comment) {
      await db.prepare("INSERT INTO comments (card_id, user_id, text, created_at) VALUES (?, ?, ?, ?)").bind(id, ex.comment.by, ex.comment.text, now).run();
    }
    kickAnalysis(c, id, null);
  }
  await setSetting(db, "examples_seeded", nowIso());
  return EXAMPLES.length;
}
