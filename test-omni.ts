import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { neo4j } from "./src";
import { Neo4jSessionStore } from "./src/session";
import { geminiModel } from "./src/utils";

const indexId = "lino-omni-index";

// Centralized DB configuration
const DB_URL = "bolt://localhost:7687";
const DB_USER = "neo4j";
const DB_PASS = "password"; // Make sure it's the correct one for your local DB

// Initialize Genkit Session Store (Short-term memory TCK Bronze)
const sessionStore = new Neo4jSessionStore({
  url: DB_URL,
  username: DB_USER,
  password: DB_PASS,
  useTckFormat: true, // CRITICAL: Matches the Python backend's expected schema
});

// 2. Initialize Genkit and the Plugin (Long-term & Reasoning TCK Silver/Gold)
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

async function runOmni() {
  console.log("🚀 Starting Multi-Memory Agent on Neo4j...");

  // Retrieve ALL tools exposed by your plugin following TCK specs
  const addEntity = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addMemoryEntity`,
  );
  const searchEntities = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/searchMemoryEntities`,
  );
  const addRelation = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addMemoryRelationship`,
  );
  const startTrace = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/startReasoningTrace`,
  );

  const availableTools = [
    addEntity,
    searchEntities,
    addRelation,
    startTrace,
  ].filter(Boolean) as any[];

  // 3. Define the session ID for Genkit
  const sessionId = "lino-session-" + Date.now();
  console.log(`\n💬 Starting session: ${sessionId}`);

  // Enhanced system prompt to force the use of relationships
  const systemPrompt = `
    You are an expert archivist of Italian cinema. 
    Use the tools at your disposal to build a precise Knowledge Graph:
    Use 'addMemoryEntity' to save actors, movies, and characters as separate entities (e.g., entityType: 'PERSON', 'MOVIE', 'CHARACTER').
    2. STRICTLY use 'addMemoryRelationship' to connect them. For example:
       - (Actor) -[ACTED_IN]-> (Movie)
       - (Actor) -[PLAYS_ROLE]-> (Character)
    3. If you have the 'startReasoningTrace' tool, use it to track your logic.
  `;

  // INTERACTION 1: Building the Knowledge Graph ---
  console.log("\n👤 User: Inserting complex relational data...");
  const prompt1 = `
    Lino Banfi is a famous Italian actor. 
    He acted in the movie "L'allenatore nel pallone" where he played the character "Oronzo Canà".
    He also acted in the movie "Vieni avanti cretino" playing the character "Pasquale Baudaffi".
    Please extract all these entities and link them properly with relationships.
  `;

  const response1 = await ai.generate({
    model: geminiModel,
    messages: [
      { role: "system", content: [{ text: systemPrompt }] },
      { role: "user", content: [{ text: prompt1 }] },
    ],
    tools: availableTools,
    config: { temperature: 0.1 }, // Low temperature to favor precise tool usage
  });

  console.log("🤖 Gemini Action Log (Graph Building):", response1.text);

  // Saving the first interaction in the store
  await sessionStore.saveSnapshot(sessionId, (current) => ({
    sessionId,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    state: {
      custom: {
        state: {},
        threads: {
          main: [
            {
              content: [{ text: prompt1 }],
              role: "user",
              metadata: {},
            },
            {
              content: [{ text: response1.text }],
              role: "model",
              metadata: {},
            },
          ],
        },
      },
      messages: current?.state?.messages ?? [],
    },
  }));

  console.log(
    "⏳ Waiting 3 seconds for Neo4j vector indexing and graph settlement...",
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // INTERACTION 2: Semantic Retrieval traversing Relationships ---
  console.log("\n👤 User: Relational Question...");
  const prompt2 =
    "Who is Pasquale Baudaffi, and who plays him? Mention any other movies that actor has been in. Use your search tools.";

  // Retrieve the history (the short-term memory chain)
  const previousSession = await sessionStore.getSnapshot({ sessionId });

  const history =
    (previousSession?.state?.custom as any)?.threads?.main?.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    })) || [];

  const response2 = await ai.generate({
    model: geminiModel,
    messages: [
      { role: "system", content: [{ text: systemPrompt }] },
      ...history,
      { role: "user", content: [{ text: prompt2 }] },
    ],
    tools: availableTools,
    config: { temperature: 0.3 },
  });

  console.log("🤖 Gemini Answer (Semantic Retrieval):", response2.text);

  // Updating the store with the second interaction
  await sessionStore.saveSnapshot(sessionId, (current) => {
    const currentCustom = current?.state?.custom as
      | {
          state?: Record<string, unknown>;
          threads?: Record<string, any[]>;
        }
      | undefined;

    const existingMain = currentCustom?.threads?.main ?? [];

    return {
      sessionId,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      state: {
        custom: {
          state: currentCustom?.state ?? {},
          threads: {
            ...currentCustom?.threads,
            main: [
              ...existingMain,
              {
                content: [{ text: prompt2 }],
                role: "user",
                metadata: {},
              },
              {
                content: [{ text: response2.text }],
                role: "model",
                metadata: {},
              },
            ],
          },
        },
        messages: current?.state?.messages ?? [],
      },
    };
  });

  await sessionStore.close();

  console.log("\n✅ Test completed!");
  console.log("🔍 To verify the graph in Neo4j Browser, run:");
  console.log(
    "   MATCH (n)-[r]->(m) WHERE NOT type(r) IN ['FIRST_MESSAGE', 'NEXT_MESSAGE', 'LAST_MESSAGE'] RETURN n,r,m",
  );
}

runOmni().catch(console.error);
