import { genkit } from "genkit";
import { neo4j } from "./src"; // Your local plugin
import { googleAI } from "@genkit-ai/googleai";
import { geminiModel } from "./src/utils";

const indexIdA = "lino-memory-index";
const indexIdB = "anonymous-index";

const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        indexId: indexIdA,
        embedder: "mock-embedder" as any,
        clientParams: {
          url: "bolt://localhost:7687",
          username: "neo4j",
          password: "password",
        },
        enableAgentMemoryTools: true,
      },
      {
        indexId: indexIdB,
        embedder: "mock-embedder" as any,
        clientParams: {
          url: "bolt://localhost:7687",
          username: "neo4j",
          password: "password",
        },
        enableAgentMemoryTools: true,
      },
    ]),
  ],
  model: geminiModel,
});

async function runAgent() {
  console.log("🚀 Starting Genkit Cognitive Agent with Neo4j Memory...");

  // Retrieve the tools registered by your plugin
  const addEntityToolA = await ai.registry.lookupAction(
    `/tool/neo4j/${indexIdA}/addMemoryEntity`,
  );
  const searchToolA = await ai.registry.lookupAction(
    `/tool/neo4j/${indexIdA}/searchMemoryEntities`,
  );
  const searchToolB = await ai.registry.lookupAction(
    `/tool/neo4j/${indexIdB}/searchMemoryEntities`,
  );

  if (!addEntityToolA || !searchToolA || !searchToolB) {
    throw new Error(
      "Required tools not found! Check your plugin registration.",
    );
  }

  //  Storing a Fact (Long-term Memory) in Index A
  console.log(`\n Information Ingestion (Index: ${indexIdA}) `);

  const ingestPrompt = `
    Lino Banfi is a legendary Italian actor known for his iconic role as Oronzo Canà. 
    He is a master of comedy and deeply loved in Italy. 
    Please save this information to your memory using the appropriate tools.
  `;

  const ingestResponse = await ai.generate({
    prompt: ingestPrompt,
    tools: [addEntityToolA],
    config: { temperature: 0.1 }, // Keep it deterministic for testing
  });

  console.log("Agent's Action Response:", ingestResponse.text);

  // Allow a small delay for Neo4j indexing
  console.log("⏳ Waiting 2 seconds for vector indexing...");
  await new Promise((resolve) => setTimeout(resolve, 2000));

  //  Knowledge Retrieval (Index A)
  console.log(`\n Semantic Retrieval (Index: ${indexIdA}) `);

  const queryPrompt =
    "Who is Lino Banfi and what is his most famous character?";

  const queryResponse = await ai.generate({
    prompt: queryPrompt,
    tools: [searchToolA],
  });

  console.log("Agent's Final Answer (Expected: Found):", queryResponse.text);

  //  Isolation Test (Index B)
  // This scenario verifies that memory is isolated between different indexIds.
  // Even if Lino Banfi was stored in Index A, Index B should be empty and the LLM
  // should not be able to retrieve that information using tools restricted to Index B.
  console.log(`\n Memory Isolation Test (Index: ${indexIdB}) `);
  console.log("Asking the same question using tools from a DIFFERENT index...");

  const isolationResponse = await ai.generate({
    prompt: queryPrompt,
    tools: [searchToolB],
  });

  console.log(
    "Agent's Final Answer (Expected: Not Found/I don't know):",
    isolationResponse.text,
  );

  //  Knowledge Graph Expansion (Index A)
  const relTool = await ai.registry.lookupAction(
    `/tool/neo4j/${indexIdA}/addMemoryRelationship`,
  );

  if (relTool) {
    console.log(" Knowledge Graph Expansion ");
    // Manually linking Lino to the concept of Italian Cinema
    await relTool({
      sourceId: "Lino Banfi",
      targetId: "Italian Cinema",
      type: "LEGEND_OF",
      description:
        "Lino Banfi is a foundational figure in Italian comedic cinema.",
    });
    console.log("✅ Relationship 'LEGEND_OF' created in Neo4j.");
  }
}

runAgent().catch(console.error);
