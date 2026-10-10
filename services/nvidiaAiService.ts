import { Trade, UserProfile, DailyBias } from "../types";
import { calculateStats } from "../lib/statsUtils";
import { cleanAssistantResponse, isInsideThinkingBlock } from "../lib/thinkingCleaner";

const BASE_URL = "/api/nvidia";
export const NVIDIA_CHAT_MODEL_ID = "nvidia/nemotron-3.5-lightning-30b-a3b";
// Bullet-proofing: automatic fallback when the primary model is deprecated,
// rate-limited upstream, times out, or returns an empty answer. Verified live
// against the NVIDIA Integrate API (the account allowlist rejects most other
// models with 404 "Not found for account").
export const NVIDIA_FALLBACK_MODEL_ID = "openai/gpt-oss-20b";

type AssistantMode = "research" | "mentor";
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type HistoryMessage = { role: "user" | "assistant"; content: string };
export type AssistantContextSummary = {
  mode: AssistantMode;
  sourceLabel: string;
  historyUsed: number;
  maxTokens: number;
  privateDataAllowed: boolean;
  promptScope: string;
  modelUsed?: string;
  fellBack?: boolean;
};

export type AiErrorCode =
  | "aborted"
  | "auth"
  | "not-configured"
  | "model-not-found"
  | "rate-limit"
  | "timeout"
  | "network"
  | "empty"
  | "server"
  | "unknown";

export class AiRequestError extends Error {
  code: AiErrorCode;
  status?: number;
  modelId?: string;
  endpointCode?: string;
  retryWithFallback: boolean;

  constructor(
    message: string,
    code: AiErrorCode,
    opts: { status?: number; modelId?: string; endpointCode?: string; retryWithFallback?: boolean } = {}
  ) {
    super(message);
    this.name = "AiRequestError";
    this.code = code;
    this.status = opts.status;
    this.modelId = opts.modelId;
    this.endpointCode = opts.endpointCode;
    this.retryWithFallback = opts.retryWithFallback ?? false;
  }
}

export type AiResponse = {
  text: string;
  modelId: string;
  fellBack: boolean;
  fallbackReason?: AiErrorCode;
};

// Timeout budget. Streaming totals are generous because chunk flow proves
// liveness; the first-token watchdog catches stalls quickly instead.
export const AI_TIMEOUTS = {
  researchTotalMs: 30000,
  mentorTotalMs: 45000,
  researchStreamTotalMs: 90000,
  mentorStreamTotalMs: 120000,
  firstTokenMs: 20000,
  retryDelayMs: 600,
} as const;

export type AiAttemptOptions = {
  timeoutMs?: number;
  firstTokenTimeoutMs?: number;
  retryDelayMs?: number;
};

export const classifyAiError = (error: any): AiErrorCode => {
  if (error instanceof AiRequestError) return error.code;
  if ((error as any)?.name === "AbortError") return "aborted";
  const message = String(error?.message ?? error ?? "");
  if (message === "Generation aborted") return "aborted";
  if (/not configured/i.test(message)) return "not-configured";
  if (/unauthorized|unauthorised|401|sign in/i.test(message)) return "auth";
  if (/not found|deprecated|410|404/i.test(message)) return "model-not-found";
  if (/rate limit|429|slow down/i.test(message)) return "rate-limit";
  if (/timeout|timed out|took too long|504|upstream/i.test(message)) return "timeout";
  if (/failed to fetch|network|load failed|connection/i.test(message)) return "network";
  if (/empty response/i.test(message)) return "empty";
  if (/internal error|proxy|5\d\d/i.test(message)) return "server";
  return "unknown";
};

export const describeAiError = (error: any): string => {
  const code = classifyAiError(error);
  switch (code) {
    case "aborted":
      return "Generation stopped.";
    case "auth":
      return "AI request was rejected (sign-in expired or API key invalid). Please sign in again — if it persists, check the server API key.";
    case "not-configured":
      return "AI not configured. Please add the NVIDIA API key to the server environment.";
    case "model-not-found":
      return "The AI model is unavailable (retired or unknown) and the backup also failed. Please try again later.";
    case "rate-limit":
      return "Rate limit hit. Please wait a moment and try again.";
    case "timeout":
      return "The AI service took too long to respond. Try a shorter prompt.";
    case "network":
      return "Could not reach the AI service. Check your connection and try again.";
    case "empty":
      return "The AI returned an empty response. Please try again with a slightly different prompt.";
    case "server":
      return "The AI service had an internal error. Please try again in a moment.";
    default:
      return "Failed to generate response. Please try again.";
  }
};

export const MODAL_MODELS = {
  deepseek: {
    id: NVIDIA_CHAT_MODEL_ID,
    fallbackId: NVIDIA_FALLBACK_MODEL_ID,
    name: "NVIDIA Research",
    description: "GPT OSS on NVIDIA for research with no account-data access",
    type: "fast" as const,
    assistantMode: "research" as const,
    maxTokens: 420,
    historyLimit: 3,
  },
  kimi: {
    id: NVIDIA_CHAT_MODEL_ID,
    fallbackId: NVIDIA_FALLBACK_MODEL_ID,
    name: "NVIDIA Mentor",
    description: "GPT OSS on NVIDIA for account-aware mentoring and coaching",
    type: "thinking" as const,
    assistantMode: "mentor" as const,
    maxTokens: 900,
    historyLimit: 5,
  },
};

export type ModalModelType = keyof typeof MODAL_MODELS;

const SPECIALIZED_PROMPTS = {
  psychology: {
    system: "You are a trading psychology expert specializing in emotional state management and mental peak performance.",
    templates: {
      insights: "Generate a daily Key Insights & Warnings brief from the user's private journal context. Include: 1) 3 to 5 key insights grounded in the data 2) 2 to 3 warnings or risks 3) one immediate action. Keep it concise, practical, and specific.",
      tilt: "Create a comprehensive tilt management protocol for handling trading drawdown. Include: 1) Early warning signs identification 2) Immediate action steps 3) Reset rituals 4) Journaling prompts 5) Return-to-trading criteria",
      mindset: "Analyze the user's trading psychology based on their trade data. Include: 1) Emotional pattern analysis 2) Risk tolerance assessment 3) Confidence calibration 4) Recommended mindset shifts 5) Daily mental warmup routine",
      focus: "Design a focus enhancement protocol. Include: 1) Pre-session preparation ritual 2) Attention anchors 3) Distraction mitigation 4) Peak state triggers 5) Session closure analysis",
    },
  },
  scaling: {
    system: "You are a risk management and capital growth specialist for traders.",
    templates: {
      roadmap: "Design a 90-day capital scaling roadmap. Include: 1) Current risk parameters analysis 2) Phase-by-phase progression 3) Risk-adjusted position sizing 4) Milestone markers 5) Drawdown contingencies",
      risk: "Analyze current risk parameters and suggest optimizations. Include: 1) Current risk per trade assessment 2) Correlation analysis 3) Position sizing recommendations 4) Exposure limits 5) Emergency protocols",
      compound: "Create a compounding strategy. Include: 1) Base capital calculation 2) Growth targets 3) Risk scaling formula 4) Performance thresholds 5) Capital preservation rules",
    },
  },
};

const truncateText = (text: string, maxLength = 1000) => {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
};

const limitConversationHistory = (
  history: HistoryMessage[],
  maxMessages: number
): HistoryMessage[] =>
  history.slice(-maxMessages).map((message) => ({
    role: message.role,
    content: truncateText(message.content, 700),
  }));

const buildCompactAnalyticsSnapshot = (analyticsSnapshot: any = null) => {
  if (!analyticsSnapshot) {
    return null;
  }

  const pairPerformance = analyticsSnapshot?.trades?.pairPerformance ?? [];
  const sessionPerformance = analyticsSnapshot?.time?.sessions ?? [];
  const dailyBias = analyticsSnapshot?.dailyBias ?? [];

  return {
    overview: analyticsSnapshot?.overview ?? null,
    equity: analyticsSnapshot?.equity
      ? {
          currentBalance: analyticsSnapshot.equity.currentBalance,
          maxDrawdownPercent: analyticsSnapshot.equity.maxDrawdownPercent,
        }
      : null,
    psychology: analyticsSnapshot?.psychology
      ? {
          disciplineScore: analyticsSnapshot.psychology.disciplineScore,
          psychologyInsights: analyticsSnapshot.psychology.psychologyInsights,
        }
      : null,
    leaders: {
      bestPairs: pairPerformance.slice(0, 3),
      worstPairs: pairPerformance.slice(-3),
      bestSessions: [...sessionPerformance]
        .sort((a, b) => (b?.pnl ?? 0) - (a?.pnl ?? 0))
        .slice(0, 3),
    },
    recentBias: dailyBias.slice(-5),
  };
};

const buildMentorDataSummary = (
  trades: Trade[],
  userProfile: UserProfile | null,
  dailyBias: DailyBias[] = [],
  analyticsSnapshot: any = null
) => {
  const sortedTrades = [...trades].sort((a, b) => {
    const dateTimeA = new Date(`${a.date}T${a.time || "00:00"}`);
    const dateTimeB = new Date(`${b.date}T${b.time || "00:00"}`);
    return dateTimeB.getTime() - dateTimeA.getTime();
  });

  const stats = calculateStats(sortedTrades);
  const now = Date.now();
  const last30Days = sortedTrades.filter((trade) => {
    const tradeTime = new Date(`${trade.date}T${trade.time || "00:00"}`).getTime();
    return tradeTime >= now - 30 * 24 * 60 * 60 * 1000;
  });
  const last7Days = sortedTrades.filter((trade) => {
    const tradeTime = new Date(`${trade.date}T${trade.time || "00:00"}`).getTime();
    return tradeTime >= now - 7 * 24 * 60 * 60 * 1000;
  });

  const last30Stats = calculateStats(last30Days);
  const last7Stats = calculateStats(last7Days);

  const emotionData = sortedTrades.reduce((acc, trade) => {
    const emotion = trade.mindset || "Neutral";
    const current = acc[emotion] || { trades: 0, pnl: 0 };
    current.trades += 1;
    current.pnl += trade.pnl;
    acc[emotion] = current;
    return acc;
  }, {} as Record<string, { trades: number; pnl: number }>);

  return {
    profile: {
      trader: userProfile?.name || "Trader",
      plan: userProfile?.plan || null,
      experience: userProfile?.experienceLevel || null,
      riskPerTrade: userProfile?.defaultRR || null,
      startingBalance: userProfile?.initialBalance || null,
      currency: userProfile?.currencySymbol || "$",
    },
    overview: {
      totalTrades: stats.totalTrades,
      netProfit: Number(stats.netProfit.toFixed(2)),
      winRate: Number(stats.winRate.toFixed(2)),
      profitFactor: Number(stats.profitFactor.toFixed(2)),
      avgWin: Number(stats.avgWin.toFixed(2)),
      avgLoss: Number(stats.avgLoss.toFixed(2)),
      bestPair: stats.bestPair ? { symbol: stats.bestPair.symbol, pnl: Number(stats.bestPair.pnl.toFixed(2)) } : null,
      worstPair: stats.worstPair ? { symbol: stats.worstPair.symbol, pnl: Number(stats.worstPair.pnl.toFixed(2)) } : null,
    },
    momentum: {
      last30Days: {
        trades: last30Stats.totalTrades,
        pnl: Number(last30Stats.netProfit.toFixed(2)),
        winRate: Number(last30Stats.winRate.toFixed(1)),
      },
      last7Days: {
        trades: last7Stats.totalTrades,
        pnl: Number(last7Stats.netProfit.toFixed(2)),
        winRate: Number(last7Stats.winRate.toFixed(1)),
      },
    },
    behavior: {
      emotionPnl: emotionData,
      dailyBias: dailyBias.slice(-5),
    },
    recentTrades: sortedTrades.slice(0, 8).map((trade) => ({
      id: trade.ticketId || trade.id.slice(0, 8),
      date: trade.date,
      pair: trade.pair,
      direction: trade.direction,
      pnl: Number(trade.pnl.toFixed(2)),
      result: trade.result,
      emotion: trade.mindset || "Neutral",
      mistake: trade.tradingMistake || "",
      adherence: trade.planAdherence || "No Plan",
    })),
    analytics: buildCompactAnalyticsSnapshot(analyticsSnapshot),
  };
};

const buildResearchSystemPrompt = () => `
You are JFX-JOURNAL Research.

ROLE
- Help the trader research markets, trading concepts, risk frameworks, session behavior, playbook ideas, and execution theory.
- You do NOT have access to the user's trading journal, trade history, account metrics, psychology logs, or private trading data.
- If the user asks about their own trades, performance, psychology, risk settings, or journal, clearly say Research mode cannot access that data and they should switch to Mentor mode.
- If the user requests trade-specific analysis, refuse to use private data and offer a general research alternative.

MARKET DATA & MONITORING
- Live market data is available via the app's Data Tools panel with two sources:
  - **FMP Data**: earnings calendar, treasury rates, stock quotes, company profiles, key metrics, financial statements, ratios, price change, DCF valuation
  - **Finnhub Data**: market news, company news, insider transactions, analyst recommendations, economic calendar (CPI, GDP, jobs, etc.), SEC filings, earnings surprises, peer companies, market status
- If the user asks about live market data that the Data Tools can provide, guide them to use the Data Tools button in the input bar (Research mode) or ask the user to type their request.
- If market data is included in the user message or history, summarize it in clean Markdown.
- Never emit raw tool syntax such as \`<tool_call>\`, \`<function=...>\`, or skill names as the answer.
- If live market data is unavailable, say so plainly instead of inventing data.

STYLE
- Be concise, practical, and well-structured.
- Lead with the answer, then use 3 to 6 bullets when helpful.
- Use Markdown headings only when they materially improve readability.

GUARDRAILS
- Never claim you reviewed the user's private data.
- Never invent live prices, current news, or broker-specific facts that were not provided.
- Never include internal reasoning or hidden analysis.

Respond with clean final Markdown only.
`.trim();

const buildMentorSystemPrompt = (
  query: string,
  userProfile: UserProfile | null,
  mentorDataSummary: ReturnType<typeof buildMentorDataSummary>,
  isPlanMode: boolean,
  isSpecialAnalysis: boolean
) => {
  let rolePrompt = `You are the JFX-JOURNAL Mentor. Your mission is to help ${userProfile?.name?.split(" ")[0] || "Trader"} improve trading performance using the provided private journal context.\n\n`;
  const normalizedQuery = query.toLowerCase();

  if (
    normalizedQuery.includes("key insights") ||
    normalizedQuery.includes("warnings") ||
    normalizedQuery.includes("insight") ||
    normalizedQuery.includes("warning") ||
    normalizedQuery.includes("psychology") ||
    normalizedQuery.includes("tilt") ||
    normalizedQuery.includes("mindset") ||
    normalizedQuery.includes("emotion")
  ) {
    const psychologyType = normalizedQuery.includes("key insights") || normalizedQuery.includes("insight") || normalizedQuery.includes("warning")
      ? "insights"
      : normalizedQuery.includes("tilt")
      ? "tilt"
      : normalizedQuery.includes("mindset")
        ? "mindset"
        : "focus";
    rolePrompt = `${SPECIALIZED_PROMPTS.psychology.system}\n\n${SPECIALIZED_PROMPTS.psychology.templates[psychologyType]}\n\n`;
  } else if (
    normalizedQuery.includes("scale") ||
    normalizedQuery.includes("growth") ||
    normalizedQuery.includes("compound") ||
    normalizedQuery.includes("risk") ||
    normalizedQuery.includes("position")
  ) {
    const scalingType =
      normalizedQuery.includes("scale") || normalizedQuery.includes("growth")
        ? "roadmap"
        : normalizedQuery.includes("risk")
          ? "risk"
          : "compound";
    rolePrompt = `${SPECIALIZED_PROMPTS.scaling.system}\n\n${SPECIALIZED_PROMPTS.scaling.templates[scalingType]}\n\n`;
  }

  return `${rolePrompt}
CORE RULES
- Be concise. Prefer short paragraphs or focused bullets.
- Use only the provided mentor context as factual source-of-truth for private performance claims.
- If a metric is missing, say it is unavailable.
- Do not invent trades, numbers, or account settings.
- Never include internal reasoning or chain-of-thought.

RESPONSE MODES
- If this is a deep analysis request (${isSpecialAnalysis}), use exact section tags when the prompt asks for them.
- If strategy plan mode is ${isPlanMode}, favor structure, rules, and checklists over narrative.
- Allowed structured tags: [SECTION:...] only when a prompt explicitly asks for sections.
- Do not use widget tags, checklist widgets, Mermaid widgets, XML-like tool tags, or hidden UI syntax.
- Write checklists as normal Markdown bullets or numbered steps.

COMMUNICATION
- Start directly with the answer.
- Keep default answers compact.
- Use Markdown only when it helps readability.

MENTOR CONTEXT
${JSON.stringify(mentorDataSummary, null, 2)}

Respond in valid Markdown for performance coaching.
`.trim();
};

export const getAssistantMode = (modelType: ModalModelType): AssistantMode =>
  MODAL_MODELS[modelType].assistantMode;

export const buildAiRequestPayload = ({
  query,
  trades,
  userProfile,
  dailyBias = [],
  analyticsSnapshot = null,
  isSpecialAnalysis = false,
  history = [],
  modelType = "deepseek",
  isPlanMode = false,
}: {
  query: string;
  trades: Trade[];
  userProfile: UserProfile | null;
  dailyBias?: DailyBias[];
  analyticsSnapshot?: any;
  isSpecialAnalysis?: boolean;
  history?: HistoryMessage[];
  modelType?: ModalModelType;
  isPlanMode?: boolean;
}) => {
  const modelConfig = MODAL_MODELS[modelType];
  const assistantMode = modelConfig.assistantMode;
  const messages: ChatMessage[] = [{ role: "system", content: "/no_think" }];
  const summary: AssistantContextSummary = assistantMode === "research"
    ? {
        mode: assistantMode,
        sourceLabel: "Public research only",
        historyUsed: 0,
        maxTokens: modelConfig.maxTokens,
        privateDataAllowed: false,
        promptScope: "Market concepts, setups, and general trading research",
      }
    : {
        mode: assistantMode,
        sourceLabel: "Private journal context",
        historyUsed: Math.min(history.length, modelConfig.historyLimit),
        maxTokens: modelConfig.maxTokens,
        privateDataAllowed: true,
        promptScope: "Mentor coaching, performance review, and strategy planning",
      };

  if (assistantMode === "research") {
    messages.push({ role: "system", content: buildResearchSystemPrompt() });
  } else {
    const mentorDataSummary = buildMentorDataSummary(trades, userProfile, dailyBias, analyticsSnapshot);
    messages.push({
      role: "system",
      content: buildMentorSystemPrompt(query, userProfile, mentorDataSummary, isPlanMode, isSpecialAnalysis),
    });
  }

  if (assistantMode !== "research") {
    messages.push(...limitConversationHistory(history, modelConfig.historyLimit));
  }
  messages.push({ role: "user", content: query });

  return {
    assistantMode,
    maxTokens: modelConfig.maxTokens,
    messages,
    modelId: modelConfig.id,
    contextSummary: summary,
  };
};

const createCombinedSignal = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const timeoutController = new AbortController();
  const timer = globalThis.setTimeout(() => timeoutController.abort(), timeoutMs);
  const onAbort = () => timeoutController.abort();
  const cleanup = () => {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: timeoutController.signal,
    cleanup,
    abort: () => timeoutController.abort(),
  };
};

const parseEndpointError = (errorText: string): { message: string; code?: string } => {
  try {
    const json = JSON.parse(errorText);
    const message =
      json?.error?.message || json?.error || json?.details || json?.message || "";
    const code =
      typeof json?.code === "string"
        ? json.code
        : typeof json?.error?.code === "string"
          ? json.error.code
          : undefined;
    return { message: String(message), code };
  } catch {
    return { message: "" };
  }
};

async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  onStream?: (text: string) => void,
  signal?: AbortSignal,
  timeoutMs = 25000,
  firstTokenTimeoutMs: number = AI_TIMEOUTS.firstTokenMs
): Promise<string> {
  const combined = createCombinedSignal(signal, timeoutMs);
  // First-token watchdog: a connection that never yields anything stalls the
  // whole UX. Firing it trips the same timeout path below, which retries /
  // fails over to the backup model automatically.
  let gotFirstToken = false;
  const firstTokenTimer = globalThis.setTimeout(() => {
    if (!gotFirstToken) combined.abort();
  }, Math.max(1000, firstTokenTimeoutMs));
  try {
    const { getSessionToken } = await import("../lib/supabase");
    const token = await getSessionToken();
    let response: Response;
    try {
      response = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          // NVIDIA reasoning models can put their hidden reasoning in `content`
          // unless this is explicitly disabled.
          chat_template_kwargs: { enable_thinking: false },
          ...(onStream ? { stream: true } : {}),
        }),
        signal: combined.signal as any,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        if (signal?.aborted) {
          throw new AiRequestError("Generation aborted", "aborted", { modelId: model });
        }
        throw new AiRequestError(`NVIDIA API timeout after ${timeoutMs}ms`, "timeout", {
          modelId: model,
          retryWithFallback: true,
        });
      }
      throw new AiRequestError(
        `Could not reach the AI service (${error?.message || "network error"}).`,
        "network",
        { modelId: model, retryWithFallback: true }
      );
    }

    // Non-streaming: response headers mean the upstream is alive and working.
    // Streaming keeps the watchdog armed until the first delta arrives, so a
    // stalled-open SSE connection still fails over quickly.
    if (!onStream) {
      gotFirstToken = true;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const { message: parsedError, code: endpointCode } = parseEndpointError(errorText);
      console.warn(`[NVIDIA AI] HTTP ${response.status} (model ${model}):`, errorText.slice(0, 500));

      if (response.status === 401 || response.status === 403) {
        throw new AiRequestError("NVIDIA API request was rejected (unauthorized).", "auth", {
          status: response.status,
          modelId: model,
          endpointCode,
        });
      }
      if (endpointCode === "ai_not_configured" || /not configured/i.test(parsedError)) {
        throw new AiRequestError("NVIDIA API key is not configured on the server.", "not-configured", {
          status: response.status,
          modelId: model,
          endpointCode: endpointCode ?? "ai_not_configured",
        });
      }
      if (response.status === 404 || response.status === 410) {
        throw new AiRequestError(
          parsedError || `NVIDIA model '${model}' was not found or has been deprecated.`,
          "model-not-found",
          { status: response.status, modelId: model, endpointCode, retryWithFallback: true }
        );
      }
      if (response.status === 429) {
        // Our own proxy says "slow down" — retrying immediately (even on the
        // fallback model) would 429 again. An upstream quota 429 MAY succeed
        // on a different model, so only those retry with fallback.
        const localRateLimit = /slow down|rate limiter/i.test(parsedError + " " + errorText);
        throw new AiRequestError(
          parsedError || "Rate limit hit. Please wait a moment.",
          "rate-limit",
          {
            status: response.status,
            modelId: model,
            endpointCode,
            retryWithFallback: !localRateLimit,
          }
        );
      }
      const isServer = response.status >= 500;
      if (response.status === 504 || response.status === 408 || endpointCode === "upstream_timeout") {
        throw new AiRequestError(
          parsedError || "The AI service took too long to respond.",
          "timeout",
          { status: response.status, modelId: model, endpointCode, retryWithFallback: true }
        );
      }
      throw new AiRequestError(parsedError || `NVIDIA API error (${response.status})`, isServer ? "server" : "unknown", {
        status: response.status,
        modelId: model,
        endpointCode,
        retryWithFallback: isServer,
      });
    }

    if (onStream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        if (combined.signal.aborted) {
          if (signal?.aborted) {
            throw new AiRequestError("Generation aborted", "aborted", { modelId: model });
          }
          throw new AiRequestError(`NVIDIA API timeout after ${timeoutMs}ms`, "timeout", {
            modelId: model,
            retryWithFallback: true,
          });
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            const content = delta?.content;
            const reasoningContent = delta?.reasoning_content;

            if (reasoningContent || content) {
              // Any delta proves the stream is alive (reasoning-style models
              // emit reasoning deltas before user-facing content).
              gotFirstToken = true;
            }

            if (reasoningContent) {
              continue;
            }

            if (content) {
              fullText += content;

              if (!isInsideThinkingBlock(fullText)) {
                onStream(cleanAssistantResponse(fullText));
              }
            }
          } catch {}
        }
      }

      const cleaned = cleanAssistantResponse(fullText);
      if (!cleaned) {
        throw new AiRequestError("The AI returned an empty response.", "empty", {
          modelId: model,
          retryWithFallback: true,
        });
      }
      return cleaned;
    }

    const json = await response.json().catch(() => ({} as any));
    const message = json.choices?.[0]?.message;
    // Some served models (e.g. gpt-oss) put reasoning in
    // `reasoning_content`/`reasoning` and leave `content` null — that is NOT
    // a user-facing answer, so it must not leak through.
    const content = typeof message?.content === "string" ? message.content : "";
    const cleaned = cleanAssistantResponse(content);
    if (!cleaned) {
      throw new AiRequestError("The AI returned an empty response.", "empty", {
        modelId: model,
        retryWithFallback: true,
      });
    }
    return cleaned;
  } catch (error: any) {
    if (error instanceof AiRequestError) {
      throw error;
    }
    if (combined.signal.aborted && !signal?.aborted) {
      throw new AiRequestError(`NVIDIA API timeout after ${timeoutMs}ms`, "timeout", {
        modelId: model,
        retryWithFallback: true,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(firstTokenTimer);
    combined.cleanup();
  }
}

const TRANSIENT_RETRY_CODES: AiErrorCode[] = ["network", "timeout", "server"];

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiRequestError("Generation aborted", "aborted"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new AiRequestError("Generation aborted", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

async function completeWithFallback(
  modelId: string,
  fallbackId: string | undefined,
  messages: ChatMessage[],
  maxTokens: number,
  onStream: ((text: string) => void) | undefined,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  attemptOpts: AiAttemptOptions = {}
): Promise<AiResponse> {
  const firstTokenTimeoutMs = attemptOpts.firstTokenTimeoutMs ?? AI_TIMEOUTS.firstTokenMs;
  const retryDelayMs = attemptOpts.retryDelayMs ?? AI_TIMEOUTS.retryDelayMs;

  const attempt = (id: string, tokens: number) =>
    chatCompletion(id, messages, tokens, onStream, signal, timeoutMs, firstTokenTimeoutMs);

  try {
    try {
      const text = await attempt(modelId, maxTokens);
      return { text, modelId, fellBack: false };
    } catch (error: any) {
      // One quick retry on the SAME model for transient blips (packet loss,
      // cold upstream, brief 5xx) before paying the cost of failover. Hard
      // failures (auth, 404, local rate limit, abort) skip straight through.
      const transient =
        error instanceof AiRequestError &&
        TRANSIENT_RETRY_CODES.includes(error.code) &&
        !signal?.aborted;
      if (!transient) {
        throw error;
      }
      await sleepWithAbort(retryDelayMs, signal);
      const text = await attempt(modelId, maxTokens);
      return { text, modelId, fellBack: false };
    }
  } catch (error: any) {
    const canRetry =
      error instanceof AiRequestError &&
      error.retryWithFallback &&
      !!fallbackId &&
      fallbackId !== modelId;
    if (!canRetry) {
      throw error;
    }
    // Reasoning-style fallback models need headroom to finish thinking before
    // emitting content; give the backup a larger token budget (server clamps
    // at 4096 anyway).
    const fallbackTokens = Math.min(Math.max(maxTokens * 2, 900), 2000);
    try {
      const text = await attempt(fallbackId, fallbackTokens);
      return {
        text,
        modelId: fallbackId,
        fellBack: true,
        fallbackReason: error.code,
      };
    } catch (fallbackError) {
      console.error("NVIDIA AI fallback failed:", fallbackError);
      throw fallbackError;
    }
  }
}

export const modalResearchService = {
  async generateRuleSuggestions(prompt: string, signal?: AbortSignal): Promise<string> {
    const modelId = MODAL_MODELS.deepseek.id;
    const maxTokens = 600;
    const messages: ChatMessage[] = [
      { role: "system", content: "/no_think" },
      { role: "user", content: prompt },
    ];
    const result = await completeWithFallback(
      modelId,
      MODAL_MODELS.deepseek.fallbackId,
      messages,
      maxTokens,
      undefined,
      signal,
      30000
    );
    return result.text;
  },

  async generateResponseWithMeta(
    query: string,
    trades: Trade[],
    userProfile: UserProfile | null,
    dailyBias: DailyBias[] = [],
    analyticsSnapshot: any = null,
    isSpecialAnalysis: boolean = false,
    history: HistoryMessage[] = [],
    modelType: ModalModelType = "deepseek",
    isPlanMode: boolean = false,
    onStream?: (text: string) => void,
    signal?: AbortSignal,
    opts: AiAttemptOptions = {}
  ): Promise<AiResponse> {
    if (signal?.aborted) {
      throw new AiRequestError("Generation aborted", "aborted");
    }

    try {
      const payload = buildAiRequestPayload({
        query,
        trades,
        userProfile,
        dailyBias,
        analyticsSnapshot,
        isSpecialAnalysis,
        history,
        modelType,
        isPlanMode,
      });

      const streaming = typeof onStream === "function";
      const timeoutMs =
        opts.timeoutMs ??
        (payload.assistantMode === "research"
          ? streaming
            ? AI_TIMEOUTS.researchStreamTotalMs
            : AI_TIMEOUTS.researchTotalMs
          : streaming
            ? AI_TIMEOUTS.mentorStreamTotalMs
            : AI_TIMEOUTS.mentorTotalMs);
      return await completeWithFallback(
        payload.modelId,
        MODAL_MODELS[modelType].fallbackId,
        payload.messages,
        payload.maxTokens,
        onStream,
        signal,
        timeoutMs,
        opts
      );
    } catch (error: any) {
      console.error("NVIDIA AI Error:", error);
      throw error;
    }
  },

  async generateResponse(
    query: string,
    trades: Trade[],
    userProfile: UserProfile | null,
    dailyBias: DailyBias[] = [],
    analyticsSnapshot: any = null,
    isSpecialAnalysis: boolean = false,
    history: HistoryMessage[] = [],
    modelType: ModalModelType = "deepseek",
    isPlanMode: boolean = false,
    onStream?: (text: string) => void,
    signal?: AbortSignal,
    opts: AiAttemptOptions = {}
  ): Promise<string> {
    const result = await modalResearchService.generateResponseWithMeta(
      query,
      trades,
      userProfile,
      dailyBias,
      analyticsSnapshot,
      isSpecialAnalysis,
      history,
      modelType,
      isPlanMode,
      onStream,
      signal,
      opts
    );
    return result.text;
  },
};
