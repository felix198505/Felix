import type { Context } from "hono";
import type { AiAnalysis } from "../shared/types";
import type { AppEnv } from "./env";

// Etappe 3: KI-Analyse. Bis dahin bleiben neue Karten im Status „ausstehend“.

export function kickAnalysis(_c: Context<AppEnv>, _cardId: number, _requestedBy: string | null): void {}

export function kickBrainstorm(_c: Context<AppEnv>, _brainstormId: number): void {}

export async function applyAiItem(_c: Context<AppEnv>, _a: AiAnalysis, _itemId: string, _text?: string): Promise<void> {}

export async function retryPending(_env: import("./env").Env): Promise<void> {}
