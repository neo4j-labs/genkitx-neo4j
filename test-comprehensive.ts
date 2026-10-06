import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import { neo4j } from "./src";

const indexId = "comprehensive-test-index";
const DB_URL = "bolt://localhost:7687";
const DB_USER = "neo4j";
const DB_PASS = "password";

const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        indexId: indexId,
        embedder: "mock-embedder" as any,
        clientParams: { url: DB_URL, username: DB_USER, password: DB_PASS },
        enableAgentMemoryTools: true,
      },
    ]),
  ],
});

async function testTools() {
  console.log("🧪 Testing Comprehensive Memory Tools (Manual Execution)...");

  const sessionId = "test-session-" + Date.now();

  // Short-Term Memory
  const addMsg = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addMemoryMessage`,
  );
  console.log("Adding message...");
  await (addMsg as any)({ sessionId, role: "user", content: "Hello memory!" });

  const getConv = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/getMemoryConversation`,
  );
  console.log("Retrieving conversation...");
  const conv = await (getConv as any)({ sessionId });
  console.log("Conversation retrieved:", conv.messages.length, "messages");

  // 2. Long-Term Memory (Facts & Preferences)
  const addFact = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addMemoryFact`,
  );
  console.log("Adding fact...");
  await (addFact as any)({
    subject: "Neo4j",
    predicate: "is a",
    object: "Graph Database",
  });

  const addPref = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addMemoryPreference`,
  );
  console.log("Adding preference...");
  await (addPref as any)({
    category: "coding",
    preference: "likes graph databases",
  });

  // 3. Reasoning Memory
  const startTrace = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/startReasoningTrace`,
  );
  console.log("Starting trace...");
  const traceResult = await (startTrace as any)({
    sessionId,
    task: "Verify tools",
  });
  const traceId = traceResult.traceId;

  const addStep = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addReasoningStep`,
  );
  console.log("Adding step...");
  const stepResult = await (addStep as any)({
    traceId,
    thought: "All tools seem to work",
    action: "complete_test",
  });

  const recordTool = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/recordMemoryToolCall`,
  );
  console.log("Recording tool call...");
  await (recordTool as any)({
    stepId: stepResult.stepId,
    toolName: "test-tool",
    arguments: { arg1: "val1" },
    status: "success",
  });

  const completeTrace = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/completeReasoningTrace`,
  );
  console.log("Completing trace...");
  await (completeTrace as any)({ traceId, outcome: "Success", success: true });

  console.log("✅ All tools verified successfully!");
}

testTools().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
