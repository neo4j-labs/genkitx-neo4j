import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { openAI, gpt4o } from "genkitx-openai";
import { neo4j } from "./src";
import { geminiModel } from "./src/utils";

const indexIdMain = "omni-agentic-test-index";
const indexIdIsolated = "isolated-test-index";
const DB_URL = "bolt://localhost:7687";
const DB_USER = "neo4j";
const DB_PASS = "password";

const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        indexId: indexIdMain,
        embedder: "mock-embedder" as any,
        clientParams: { url: DB_URL, username: DB_USER, password: DB_PASS },
        enableAgentMemoryTools: true,
      },
      {
        indexId: indexIdIsolated,
        embedder: "mock-embedder" as any,
        clientParams: { url: DB_URL, username: DB_USER, password: DB_PASS },
        enableAgentMemoryTools: true,
      },
    ]),
  ],
});

async function runOmniAgent() {
  console.log("Starting Omni-Agentic Test (Gemini + Multi-Tier Memory)...");

  const toolsMain = [
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/addMemoryMessage`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/getMemoryConversation`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/addMemoryEntity`,
    ),
    await ai.registry.lookupAction(`/tool/neo4j/${indexIdMain}/addMemoryFact`),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/addMemoryPreference`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/addMemoryRelationship`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/searchMemoryEntities`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/getRelatedMemoryEntities`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/mergeDuplicateMemoryEntities`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/startReasoningTrace`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/addReasoningStep`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/recordMemoryToolCall`,
    ),
    await ai.registry.lookupAction(
      `/tool/neo4j/${indexIdMain}/completeReasoningTrace`,
    ),
  ];

  const systemPrompt = `
    You are an AI assistant with access to multi-tier memory:
    Short-term (Messages)
    2. Long-term (Entities, Facts, Preferences, Relationships)
    3. Reasoning (Traces, Steps, ToolCalls)

    GUIDELINES:
    - Use tools to store and retrieve context effectively. 
    - Always start a reasoning trace for complex requests.
    - IMPORTANT: Always provide a final conversational response to the user summarizing what you did or what you found. Never leave the response empty.
    `;

  // Populate Main Index ---
  console.log("\nKnowledge Ingestion (Main Index) ---");
  console.log(
    "\n User: I'm Lino Banfi, a developer from Italy. I'm building a Genkit plugin for Neo4j.",
  );

  const response = await ai.generate({
    model: geminiModel,
    system: systemPrompt,
    prompt:
      "I'm Lino Banfi, a developer from Italy. I'm building a Genkit plugin for Neo4j. Store my preferences and project info.",
    tools: toolsMain,
    maxTurns: 15,
  });

  console.log("\n Agent Response:", response.text);

  // Verify Main Index ---
  console.log("\nVerification (Main Index) ---");
  console.log("\n User: What do you remember about my background?");
  const response2 = await ai.generate({
    model: geminiModel,
    system: systemPrompt,
    prompt: "What do you remember about my background?",
    tools: toolsMain,
    maxTurns: 15,
  });

  console.log("\n Agent Response (Expected: Found):", response2.text);

  // Memory Isolation Test (Isolated Index) ---
  console.log("\nMemory Isolation Test (Isolated Index) ---");
  console.log("\n User: What do you remember about my background?");
  const response3 = await ai.generate({
    model: geminiModel,
    system: systemPrompt,
    prompt: "What do you remember about my background?",
    tools: toolsMain,
    maxTurns: 15,
  });

  console.log(
    "\n Agent Response (Expected: Not Found/I don't know):",
    response3.text,
  );
}

runOmniAgent().catch(console.error);
