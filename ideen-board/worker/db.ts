import type {
  AiAnalysis,
  AiFeedback,
  BoardData,
  Brainstorm,
  Card,
  CardDetail,
  Category,
  ChecklistItem,
  Comment,
  HistoryEntry,
  Vote,
} from "../shared/types";
import type { Env } from "./env";
import { listAttachments } from "./attachments";

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

/** Öffentliche Adresse der App: aus APP_URL oder der zuletzt genutzten https-Adresse */
export async function appUrl(env: Env): Promise<string> {
  return (env.APP_URL || (await getSetting(env.DB, "app_url")) || "").replace(/\/$/, "");
}

export async function getRev(db: D1Database): Promise<number> {
  return Number((await getSetting(db, "rev")) ?? "0");
}

/** Erhöht den Änderungszähler, damit alle Geräte neu laden. */
export async function bumpRev(db: D1Database): Promise<void> {
  await db.prepare("UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'").run();
}

export async function addHistory(
  db: D1Database,
  cardId: number,
  userId: string | null,
  action: string,
  detail = "",
): Promise<void> {
  await db
    .prepare("INSERT INTO history (card_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(cardId, userId, action, detail, nowIso())
    .run();
}

type CardRow = Omit<Card, "favorite_by" | "checklist" | "comment_count" | "votes">;

function assemble(
  rows: CardRow[],
  favs: { card_id: number; user_id: string }[],
  checklist: ChecklistItem[],
  commentCounts: { card_id: number; n: number }[],
  votes: Vote[],
): Card[] {
  const byCard = <T extends { card_id: number }>(list: T[]) => {
    const m = new Map<number, T[]>();
    for (const x of list) {
      const arr = m.get(x.card_id) ?? [];
      arr.push(x);
      m.set(x.card_id, arr);
    }
    return m;
  };
  const favMap = byCard(favs);
  const clMap = byCard(checklist);
  const vMap = byCard(votes);
  const ccMap = new Map(commentCounts.map((c) => [c.card_id, c.n]));
  return rows.map((r) => ({
    ...r,
    favorite_by: (favMap.get(r.id) ?? []).map((f) => f.user_id),
    checklist: (clMap.get(r.id) ?? []).sort((a, b) => a.position - b.position),
    comment_count: ccMap.get(r.id) ?? 0,
    votes: vMap.get(r.id) ?? [],
  }));
}

export async function loadCards(db: D1Database, where = "c.merged_into IS NULL AND c.deleted_at IS NULL", binds: unknown[] = []): Promise<Card[]> {
  const [rows, favs, cl, cc, votes] = await db.batch([
    db
      .prepare(
        `SELECT c.*,
           (SELECT json_extract(a.data, '$.kurzfassung') FROM ai_analyses a WHERE a.card_id = c.id ORDER BY a.version DESC LIMIT 1) AS ai_summary,
           (SELECT COUNT(*) FROM attachments f WHERE f.card_id = c.id) AS attachment_count
         FROM cards c WHERE ${where} ORDER BY c.column_key, c.position`,
      )
      .bind(...binds),
    db.prepare("SELECT card_id, user_id FROM favorites"),
    db.prepare("SELECT * FROM checklist_items"),
    db.prepare("SELECT card_id, COUNT(*) AS n FROM comments GROUP BY card_id"),
    db.prepare("SELECT card_id, user_id, vote FROM votes"),
  ]);
  return assemble(
    rows.results as CardRow[],
    favs.results as { card_id: number; user_id: string }[],
    cl.results as unknown as ChecklistItem[],
    cc.results as { card_id: number; n: number }[],
    votes.results as unknown as Vote[],
  );
}

export async function loadCard(db: D1Database, id: number): Promise<Card | null> {
  const cards = await loadCards(db, "c.id = ?", [id]);
  return cards[0] ?? null;
}

export function parseBrainstorm(row: Record<string, unknown>): Brainstorm {
  return { ...(row as unknown as Brainstorm), ai_data: row.ai_data ? JSON.parse(row.ai_data as string) : null };
}

export function parseAnalysis(row: Record<string, unknown>): AiAnalysis {
  return {
    ...(row as unknown as AiAnalysis),
    data: JSON.parse(row.data as string),
    item_state: JSON.parse((row.item_state as string) || "{}"),
  };
}

export async function loadBoard(env: Env, me: string): Promise<BoardData> {
  const db = env.DB;
  const [cards, cats, bs, settings] = await Promise.all([
    loadCards(db),
    db.prepare("SELECT * FROM categories ORDER BY sort, name").all<Category>(),
    db.prepare("SELECT * FROM brainstorms ORDER BY created_at DESC").all(),
    db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>(),
  ]);
  const s = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));
  return {
    rev: Number(s.rev ?? 0),
    me,
    cards,
    categories: cats.results,
    brainstorms: bs.results.map(parseBrainstorm),
    users: (await db.prepare("SELECT id, name, email FROM users").all<{ id: string; name: string; email: string | null }>()).results,
    settings: {
      mail_enabled: Boolean(env.RESEND_API_KEY && env.MAIL_FROM),
      pipedrive_enabled: Boolean(env.PIPEDRIVE_API_TOKEN),
      month_cost_eur: Number(s["ai_cost:" + nowIso().slice(0, 7)] ?? 0) * 0.92,
      examples_seeded: !!s.examples_seeded,
      company_context: s.company_context ?? "",
      ai_monthly_limit_eur: s.ai_monthly_limit_eur ?? "10",
      ai_enabled: Boolean(env.ANTHROPIC_API_KEY),
      ai_model: env.AI_MODEL || "claude-opus-5-5",
      ai_model_fast: env.AI_MODEL_FAST || "claude-sonnet-5-5",
      ai_guidance: s.ai_guidance ?? "",
    },
  };
}

export async function loadCardDetail(db: D1Database, id: number): Promise<CardDetail | null> {
  const card = await loadCard(db, id);
  if (!card) return null;
  const [comments, history, analyses, feedback] = await db.batch([
    db.prepare("SELECT * FROM comments WHERE card_id = ? ORDER BY created_at").bind(id),
    db.prepare("SELECT * FROM history WHERE card_id = ? ORDER BY created_at DESC, id DESC").bind(id),
    db.prepare("SELECT * FROM ai_analyses WHERE card_id = ? ORDER BY version DESC").bind(id),
    db.prepare("SELECT f.* FROM ai_feedback f JOIN ai_analyses a ON a.id = f.analysis_id WHERE a.card_id = ?").bind(id),
  ]);
  return {
    card,
    attachments: await listAttachments(db, id),
    comments: comments.results as unknown as Comment[],
    history: history.results as unknown as HistoryEntry[],
    analyses: (analyses.results as Record<string, unknown>[]).map((r) => ({
      ...parseAnalysis(r),
      feedback: (feedback.results as unknown as AiFeedback[]).filter((f) => f.analysis_id === r.id),
    })),
  };
}
