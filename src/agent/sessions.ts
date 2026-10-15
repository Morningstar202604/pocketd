import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { HOME_DIR } from "./runtime.js";

export interface StoredMessage {
  seq: number;
  role: string;
  payload: unknown;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export class SessionStore {
  private db: DatabaseSync;

  constructor(dbPath = join(HOME_DIR, "state", "sessions.db")) {
    mkdirSync(join(HOME_DIR, "state"), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        role       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
    `);
  }

  upsertSession(id: string, title: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      )
      .run(id, title.slice(0, 200), now, now);
  }

  appendMessage(sessionId: string, seq: number, role: string, payload: unknown): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO messages (session_id, seq, role, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, seq, role, JSON.stringify(payload ?? null), now);
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
  }

  replaceMessages(
    sessionId: string,
    title: string,
    messages: Array<{ role: string; payload: unknown }>,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      )
      .run(sessionId, title.slice(0, 200), now, now);
    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    const insert = this.db.prepare(
      `INSERT INTO messages (session_id, seq, role, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    messages.forEach((m, i) => {
      insert.run(sessionId, i, m.role, JSON.stringify(m.payload ?? null), now);
    });
  }

  listSessions(limit = 100): SessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.title, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
         ORDER BY s.updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      messageCount: Number(r.message_count ?? 0),
    }));
  }

  getMessages(sessionId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT seq, role, payload, created_at FROM messages
         WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      seq: Number(r.seq),
      role: String(r.role),
      payload: safeParse(String(r.payload)),
      createdAt: String(r.created_at),
    }));
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
