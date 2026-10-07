import { genkit } from "genkit";
import { neo4j } from "./src"; // Import YOUR local plugin!

async function runIntegrationTest() {
  const indexId = "memory-test";

  console.log("Initializing Genkit with YOUR neo4j plugin...");

  const ai = genkit({
    plugins: [
      neo4j([
        {
          indexId: indexId,
          // Adding a mock embedder to satisfy TypeScript
          embedder: "mock-embedder" as any,
          // Provide the Official Driver with the URL of the REAL Neo4j Database
          clientParams: {
            url: "bolt://localhost:7687",
            username: "neo4j",
            password: "password", // Use your Docker password
          },
          // 2. Enable memory tools (which will point internally to http://localhost:3001)
          enableAgentMemoryTools: true,
          // NOTE: your plugin must be modified so as not to crash the HTTP client if it receives "bolt://"
        },
      ]),
    ],
  });

  console.log("Retrieving Tools from the Genkit internal registry...");
  const addAction = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/addMemoryEntity`,
  );
  const searchAction = await ai.registry.lookupAction(
    `/tool/neo4j/${indexId}/searchMemoryEntities`,
  );

  if (!addAction || !searchAction) {
    throw new Error("❌ Tools were not registered! Check your plugin.");
  }
  console.log("✅ Tools registered successfully in Genkit!");

  console.log("Executing 'addMemoryEntity' tool...");
  const addResult = await addAction({
    name: "TestGenkitVector",
    entityType: "PLUGIN",
    description: "Created with Genkit and local embedding",
  });
  console.log("✅ Tool Result (Add):", addResult);

  // ADD THIS PAUSE
  console.log("⏳ Waiting 2 seconds for Neo4j to index the vector...");
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("Executing 'searchMemoryEntities' tool...");
  const searchResult = await searchAction({
    query: "TestGenkitVector", // <-- Search for the new name
  });
  console.log("✅ Tool Result (Search):", searchResult);
}

runIntegrationTest();
