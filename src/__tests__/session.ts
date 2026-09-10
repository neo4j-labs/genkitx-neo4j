import { describe, expect, test, jest } from "@jest/globals";
import { Session } from "neo4j-driver";
import { Neo4jSessionStore, Neo4jSessionStoreConfig } from "../session";
import { setupNeo4jTestEnvironment } from "../test-utils";

jest.setTimeout(30000);

describe("Neo4jSessionStore", () => {
  let store: Neo4jSessionStore;
  let neo4jSession: Session;
  const config: Neo4jSessionStoreConfig = {
    url: process.env.NEO4J_URI as string,
    username: process.env.NEO4J_USERNAME as string,
    password: process.env.NEO4J_PASSWORD as string,
    sessionLabel: "GenkitSessionTest",
    messageLabel: "MessageTest",
    nextMessageRelType: "NEXT_TEST",
    lastMessageRelType: "LAST_MESSAGE_TEST",
  };

  const setupCtx = setupNeo4jTestEnvironment(
    "5.26.16",
    "genkit-test-index",
    (ctx) => {
      config.url = ctx.neo4jContainer.getBoltUri();
      config.username = ctx.neo4jContainer.getUsername();
      config.password = ctx.neo4jContainer.getPassword();
    },
    (_) => {
      store = new Neo4jSessionStore(config);
    },
  );

  test("should save and retrieve session data and verify the graph structure", async () => {
    const sessionId = "test-session-1";
    const sessionData = {
      id: sessionId,
      state: { user: "Bob" },
      threads: {
        main: [
          { content: [{ text: "hi" }], role: "user" as const, metadata: {} },
          {
            content: [{ text: "hello" }],
            role: "model" as const,
            metadata: {},
          },
        ],
      },
    };

    await store.save(sessionId, sessionData);

    // Verify the graph structure: 1 Session Node, 2 Message Nodes, and relationships
    const graphResult = await setupCtx.session.run(
      `MATCH (s:\`${config.sessionLabel}\` {sessionId: $sessionId})
       MATCH p=(s)-[:${config.lastMessageRelType}]->(lastNode)-[:${config.nextMessageRelType}*0..1]->(firstNode)
       RETURN s, lastNode, firstNode`,
      { sessionId },
    );
    expect(graphResult.records.length).toBe(1);
    const lastNode = graphResult.records[0].get("lastNode");
    const firstNode = graphResult.records[0].get("firstNode");
    expect(lastNode).toBeDefined();
    expect(firstNode).toBeDefined();

    // Verify the retrieved data via the get method
    const retrievedData = await store.get(sessionId);
    expect(retrievedData).toEqual(sessionData);
  });

  test("should save and retrieve first 2 session message data and verify the graph structure", async () => {
    const sessionId = "test-session-1";
    const firstMessage = {
      content: [{ text: "hi" }],
      role: "user" as const,
      metadata: {},
    };
    const secondMessage = {
      content: [{ text: "hello" }],
      role: "model" as const,
      metadata: {},
    };
    const thirdMessage = {
      content: [{ text: "hi again" }],
      role: "user" as const,
      metadata: {},
    };
    const fourthMessage = {
      content: [{ text: "hello again" }],
      role: "model" as const,
      metadata: {},
    };
    const fifthMessage = {
      content: [{ text: "hi again again" }],
      role: "user" as const,
      metadata: {},
    };
    const sixthMessage = {
      content: [{ text: "hello again again" }],
      role: "model" as const,
      metadata: {},
    };

    const sessionData = {
      id: sessionId,
      state: { user: "Bob" },
      threads: {
        main: [
          firstMessage,
          secondMessage,
          thirdMessage,
          fourthMessage,
          fifthMessage,
          sixthMessage,
        ],
      },
    };

    await store.save(sessionId, sessionData);

    // -- set window size 2
    store.setWindowSize(2);

    // Verify the graph structure: 1 Session Node, 2 Message Nodes, and relationships
    const graphResult = await setupCtx.session.run(
      `MATCH (s:\`${config.sessionLabel}\` {sessionId: $sessionId})
       MATCH p=(s)-[:${config.lastMessageRelType}]->(lastNode)-[:${config.nextMessageRelType}*0..1]->(firstNode)
       RETURN s, lastNode, firstNode`,
      { sessionId },
    );
    expect(graphResult.records.length).toBe(1);
    const lastNode = graphResult.records[0].get("lastNode");
    const firstNode = graphResult.records[0].get("firstNode");
    expect(lastNode).toBeDefined();
    expect(firstNode).toBeDefined();

    // Verify the retrieved data via the get method
    const retrievedData = await store.get(sessionId);
    console.log("Retrieved Data:", retrievedData);

    // expected only last 3 messages
    const expectedRetrievedData = {
      id: sessionId,
      state: { user: "Bob" },
      threads: {
        main: [thirdMessage, fourthMessage, fifthMessage, sixthMessage],
      },
    };
    expect(retrievedData).toEqual(expectedRetrievedData);

    // -- cleanup: reset with default size
    store.setWindowSize(Neo4jSessionStore.DEFAULT_SIZE);
  });

  test("should remove messages", async () => {
    const sessionId = "test-session-1";
    const message = {
      content: [{ text: "hi" }],
      role: "user" as const,
      metadata: {},
    };

    const sessionData = {
      id: sessionId,
      state: { user: "Bob" },
      threads: {
        main: [message],
      },
    };

    await store.save(sessionId, sessionData);

    // -- set size 1
    store.setWindowSize(2);

    const graphMessageQuery = `MATCH (s:\`${config.sessionLabel}\` {sessionId: $sessionId})
       MATCH p=(s)-[:${config.lastMessageRelType}]->(lastNode)-[:${config.nextMessageRelType}*0..1]->(firstNode)
       RETURN s, lastNode, firstNode`;

    // Verify the graph structure: 1 Session Node, 2 Message Nodes, and relationships
    const graphResult = await setupCtx.session.run(graphMessageQuery, {
      sessionId,
    });
    expect(graphResult.records.length).toBe(1);
    const lastNode = graphResult.records[0].get("lastNode");
    const firstNode = graphResult.records[0].get("firstNode");
    expect(lastNode).toBeDefined();
    expect(firstNode).toBeDefined();

    // Verify the retrieved data via the get method
    const retrievedData = await store.get(sessionId);
    console.log("Retrieved Data:", retrievedData);

    expect(retrievedData).toEqual(sessionData);

    // -- delete messages
    await store.clear(sessionId);

    const retrievedDataAfterDelete = await store.get(sessionId);
    expect(retrievedDataAfterDelete).toBeUndefined();

    const graphResultAfterDelete = await setupCtx.session.run(
      graphMessageQuery,
      { sessionId },
    );
    expect(graphResultAfterDelete.records.length).toBe(0);
  });

  test("should return undefined for a non-existent session", async () => {
    const sessionId = "non-existent-session";
    const retrievedData = await store.get(sessionId);
    expect(retrievedData).toBeUndefined();
  });

  test("should update an existing session and append new nodes", async () => {
    const sessionId = "test-session-2";
    const initialData = {
      id: sessionId,
      state: { user: "Alice" },
      threads: {
        main: [
          { content: [{ text: "hello" }], role: "user" as const, metadata: {} },
        ],
      },
    };

    await store.save(sessionId, initialData);

    const updatedData = {
      id: sessionId,
      state: { user: "Alice" },
      threads: {
        main: [
          { content: [{ text: "hi" }], role: "user" as const, metadata: {} },
        ],
      },
    };

    await store.save(sessionId, updatedData);

    // Verify there is only 1 Session node
    const sessionNodesCount = await setupCtx.session.run(
      `MATCH (s:\`${config.sessionLabel}\` {sessionId: $sessionId}) RETURN count(s) AS count`,
      { sessionId },
    );
    expect(sessionNodesCount.records[0].get("count").toInt()).toBe(1);

    // Verify the total message nodes is 2
    const messageNodesCount = await setupCtx.session.run(
      `MATCH (n:\`${config.messageLabel}\` {threadId: 'main'}) RETURN count(n) AS count`,
    );
    expect(messageNodesCount.records[0].get("count").toInt()).toBe(2);

    // Verify the LAST_MESSAGE relationship points to the final node
    const lastNodeResult = await setupCtx.session.run(
      `MATCH (s:\`${config.sessionLabel}\` {sessionId: $sessionId})-[:${config.lastMessageRelType}]->(m)
       RETURN m.content AS lastMessageContent`,
      { sessionId },
    );
    expect(lastNodeResult.records.length).toBe(1);
    expect(lastNodeResult.records[0].get("lastMessageContent")).toContain("hi");

    // Verify the retrieved data is the updated version
    const retrievedData = await store.get(sessionId);
    const expectedData = updatedData;
    expectedData.threads = {
      main: [
        ...initialData.threads.main,
        { content: [{ text: "hi" }], role: "user" as const, metadata: {} },
      ],
    };
    expect(retrievedData).toEqual(expectedData);
  });

  test("should work with custom node labels", async () => {
    const customConfig = {
      ...config,
      sessionLabel: "CustomSession",
      messageLabel: "CustomMessage",
    };
    const customStore = new Neo4jSessionStore(customConfig);
    const sessionId = "custom-labels-session";
    const sessionData = {
      id: sessionId,
      state: { test: "custom labels" },
      threads: {
        main: [
          {
            content: [{ text: "This uses a custom session and message label" }],
            role: "user" as const,
            metadata: {},
          },
        ],
      },
    };

    await customStore.save(sessionId, sessionData);

    // Verify that the nodes were created with the custom labels
    const sessionNodeCount = await setupCtx.session.run(
      `MATCH (s:CustomSession {sessionId: $sessionId}) RETURN count(s) AS count`,
      { sessionId },
    );
    expect(sessionNodeCount.records[0].get("count").toInt()).toBe(1);

    const messageNodeCount = await setupCtx.session.run(
      `MATCH (m:CustomMessage {threadId: 'main'}) RETURN count(m) AS count`,
    );
    expect(messageNodeCount.records[0].get("count").toInt()).toBe(1);

    // Clean up nodes created with custom labels
    await setupCtx.session.run(`MATCH (n:CustomSession) DETACH DELETE n`);
    await setupCtx.session.run(`MATCH (n:CustomMessage) DETACH DELETE n`);
  });

  test("should work with custom relationship types", async () => {
    const customConfig = {
      ...config,
      nextMessageRelType: "THREAD_NEXT",
      lastMessageRelType: "THREAD_HEAD",
    };
    const customStore = new Neo4jSessionStore(customConfig);
    const sessionId = "custom-rels-session";
    const sessionData = {
      id: sessionId,
      state: { test: "custom relations" },
      threads: {
        main: [
          {
            content: [{ text: "First message" }],
            role: "user" as const,
            metadata: {},
          },
          {
            content: [{ text: "Second message" }],
            role: "model" as const,
            metadata: {},
          },
        ],
      },
    };

    await customStore.save(sessionId, sessionData);

    // Verify that the custom relationships exist
    const relResult = await setupCtx.session.run(
      `MATCH (s:\`${config.sessionLabel}\` {sessionId: $sessionId})-[:THREAD_HEAD]->(lastMsg)
       MATCH (s)-[:THREAD_HEAD]->(lastMsg)<-[:THREAD_NEXT]-(firstMsg)
       RETURN count(lastMsg) as lastMsgCount, count(firstMsg) as firstMsgCount`,
      { sessionId },
    );

    const record = relResult.records[0];
    expect(record.get("lastMsgCount").toInt()).toBe(1); // One LAST_MESSAGE relationship
    expect(record.get("firstMsgCount").toInt()).toBe(1); // One NEXT relationship

    // Clean up nodes created with custom labels
    await setupCtx.session.run(
      `MATCH (n:\`${config.sessionLabel}\`) DETACH DELETE n`,
    );
    await setupCtx.session.run(
      `MATCH (n:\`${config.messageLabel}\`) DETACH DELETE n`,
    );
  });
});
