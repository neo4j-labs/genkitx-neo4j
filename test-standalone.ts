// NOTE: There is no import of 'genkit' or your plugin here.
// We are only importing the official Neo4j Labs client.

// @ts-ignore: Ignoring TS error for this direct test
// import { MemoryClient } from '@neo4j-labs/src/client.ts';
import { MemoryClient } from "../clients/typescript/src/index.ts";
// import { MemoryClient } from "@neo4j-labs/agent-memory";

async function runStandaloneTest() {
  console.log("Initializing MemoryClient towards the Python server...");
  // We are pointing to the Python server started with uvx
  const memoryClient = new MemoryClient({
    endpoint: "http://localhost:3001",
  });

  try {
    await memoryClient.connect();
    console.log("✅ Successfully connected to the server!");

    console.log("Adding an entity to Long-Term Memory...");
    const entity = await memoryClient.longTerm.addEntity(
      "StandaloneTestEntity",
      "CONCEPT",
      { description: "Created using only the official TypeScript client" },
    );
    console.log(`✅ Entity created! Assigned ID: ${entity.id}`);

    console.log("Executing a search to verify it's in the database...");
    const results = await memoryClient.longTerm.searchEntities(
      "StandaloneTestEntity",
    );

    console.log("✅ Results found:");
    results.forEach((res) => {
      console.log(` - Name: ${res.name} | Description: ${res.description}`);
    });
  } catch (error) {
    console.error("❌ Error during test:", error);
  } finally {
    console.log("Closing the connection.");
    await memoryClient.close();
  }
}

runStandaloneTest();
