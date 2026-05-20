import { Trade, UserProfile, DailyBias } from "../types";
import { calculateStats } from "../lib/statsUtils";
import { cleanThinkingTags, isInsideThinkingBlock } from "../lib/thinkingCleaner";

const BASE_URL = "/api/nvidia";
export const NVIDIA_CHAT_MODEL_ID = "stepfun-ai/step-3.5-flash";

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
};

export const MODAL_MODELS = {
  deepseek: {
    id: NVIDIA_CHAT_MODEL_ID,
    name: "NVIDIA Research",
    description: "GPT OSS on NVIDIA for research with no account-data access",
    type: "fast" as const,
    assistantMode: "research" as const,
    maxTokens: 420,
    historyLimit: 3,
  },
  kimi: {
    id: NVIDIA_CHAT_MODEL_ID,
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
You are JournalFX Research.

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
  let rolePrompt = `You are the JournalFX Mentor. Your mission is to help ${userProfile?.name?.split(" ")[0] || "Trader"} improve trading performance using the provided private journal context.\n\n`;
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
  };
};

async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  onStream?: (text: string) => void,
  signal?: AbortSignal,
  timeoutMs = 25000
): Promise<string> {
  const combined = createCombinedSignal(signal, timeoutMs);
  try {
  const response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        ...(onStream ? { stream: true } : {}),
      }),
      signal: combined.signal as any,
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        throw new Error('NVIDIA_API_KEY is missing or invalid. Add NVIDIA_API_KEY to your .env.local file.');
      }
      throw new Error(`NVIDIA API error (${response.status})`);
    }

    if (onStream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        if (combined.signal.aborted) {
          if (signal?.aborted) {
            throw new Error("Generation aborted");
          }
          throw new Error(`NVIDIA API timeout after ${timeoutMs}ms`);
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

            if (reasoningContent) {
              continue;
            }

            if (content) {
              fullText += content;

              if (!isInsideThinkingBlock(fullText)) {
                onStream(cleanThinkingTags(fullText));
              }
            }
          } catch {}
        }
      }

      return cleanThinkingTags(fullText);
    }

    const json = await response.json();
    const message = json.choices?.[0]?.message;
    const content = message?.content || "";
    return cleanThinkingTags(content);
  } catch (error: any) {
    if (combined.signal.aborted && !signal?.aborted) {
      throw new Error(`NVIDIA API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    combined.cleanup();
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
    return chatCompletion(modelId, messages, maxTokens, undefined, signal, 30000);
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
    signal?: AbortSignal
  ) {
    if (signal?.aborted) {
      throw new Error("Generation aborted");
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

      const timeoutMs = payload.assistantMode === "research" ? 30000 : 45000;
      return chatCompletion(
        payload.modelId,
        payload.messages,
        payload.maxTokens,
        onStream,
        signal,
        timeoutMs
      );
    } catch (error: any) {
      console.error("NVIDIA AI Error:", error);
      throw error;
    }
  },
};
