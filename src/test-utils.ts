import { beforeAll, beforeEach, afterEach, afterAll } from "@jest/globals";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { Wait } from "testcontainers";
import { driver as neo4jDriver, auth, Driver, Session } from "neo4j-driver";
import { genkit } from "genkit";
import { gemini15Flash, googleAI } from "@genkit-ai/googleai";
import { neo4j } from ".";
import { mockEmbedder } from "./dummyEmbedder";

export interface Neo4jTestStartupContext {
  neo4jContainer: StartedNeo4jContainer;
  driver: Driver;
  session: Session;
  ai: ReturnType<typeof genkit>;
  clientParams: any;
}

export const geminiModel = "googleai/gemini-2.5-flash";

export function setupNeo4jTestEnvironment(
  neo4jVersion: string = "2026.01.4",
  indexId: string = "genkit-test-index",
  beforeAllCallback: (ctx: Neo4jTestStartupContext) => any = () => {},
  beforeEachCallback: (ctx: Neo4jTestStartupContext) => any = () => {},
): Neo4jTestStartupContext {
  // We an empty object that will be populated by the hooks.
  const setupCtx = {} as Neo4jTestStartupContext;
  const CLEANUP_QUERY = `MATCH (n) DETACH DELETE n`;

  beforeAll(async () => {
    setupCtx.neo4jContainer = await new Neo4jContainer(`neo4j:${neo4jVersion}`)
      .withWaitStrategy(Wait.forLogMessage("Started."))
      .start();

    const uri = setupCtx.neo4jContainer.getBoltUri();
    const username = setupCtx.neo4jContainer.getUsername();
    const password = setupCtx.neo4jContainer.getPassword();

    setupCtx.driver = neo4jDriver(uri, auth.basic(username, password));

    beforeAllCallback(setupCtx);
  }, 240000);

  beforeEach(async () => {
    setupCtx.clientParams = {
      url: setupCtx.neo4jContainer.getBoltUri(),
      username: setupCtx.neo4jContainer.getUsername(),
      password: setupCtx.neo4jContainer.getPassword(),
      database: "neo4j",
    };

    setupCtx.ai = genkit({
      plugins: [
        googleAI(),
        neo4j([
          {
            indexId,
            embedder: mockEmbedder,
            clientParams: setupCtx.clientParams,
            ragModel: geminiModel,
          },
        ]),
      ],
    });

    setupCtx.session = setupCtx.driver.session();

    beforeEachCallback(setupCtx);
  });

  afterEach(async () => {
    try {
      await setupCtx.session.run(CLEANUP_QUERY);
    } finally {
      await setupCtx.session.close();
    }
  });

  afterAll(async () => {
    await setupCtx.driver.close();
    await setupCtx.neo4jContainer.stop();
  });

  return setupCtx;
}
