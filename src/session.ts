import { SessionData, SessionStore } from "@genkit-ai/ai/session";
import { Driver, auth, driver as neo4jDriver } from "neo4j-driver";
import { safeIdent } from "./filter-utils";

export interface Neo4jSessionStoreConfig {
  url: string;
  username: string;
  password?: string;
  database?: string;
  sessionLabel?: string;
  messageLabel?: string;
  nextMessageRelType?: string;
  lastMessageRelType?: string;
}

export class Neo4jSessionStore<S = any> implements SessionStore<S> {
  private driver: Driver;
  private config: Neo4jSessionStoreConfig;
  private readonly sessionLabel: string;
  private readonly messageLabel: string;
  private readonly nextMessageRelType: string;
  private readonly lastMessageRelType: string;

  public static readonly DEFAULT_SIZE = 100;
  private windowSize: number;

  constructor(config: Neo4jSessionStoreConfig) {
    this.config = config;
    this.sessionLabel = safeIdent(config.sessionLabel || "GenkitSession");
    this.messageLabel = safeIdent(config.messageLabel || "Message");
    this.nextMessageRelType = safeIdent(config.nextMessageRelType || "NEXT");
    this.lastMessageRelType = safeIdent(
      config.lastMessageRelType || "LAST_MESSAGE",
    );
    this.driver = neo4jDriver(
      this.config.url,
      auth.basic(this.config.username, this.config.password || ""),
      {},
    );
    this.windowSize = Neo4jSessionStore.DEFAULT_SIZE;
  }

  public setWindowSize(size: number) {
    this.windowSize = size;
  }
  private async getStoredMessages(
    tx: any,
    sessionId: string,
  ): Promise<
    Array<{
      content: string;
      role: string;
      metadata: string;
      threadId: string;
    }>
  > {
    const result = await tx.run(
      `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
     OPTIONAL MATCH (s)-[:${this.lastMessageRelType}]->(lastMessage)
     OPTIONAL MATCH p=(firstMessage)-[:${this.nextMessageRelType}*0..]->(lastMessage)
     WITH p
     ORDER BY length(p) DESC
     LIMIT 1
     WITH CASE WHEN p IS NULL THEN [] ELSE nodes(p) END AS messages
     UNWIND messages AS message
     RETURN message.content AS content,
            message.role AS role,
            message.metadata AS metadata,
            message.threadId AS threadId`,
      { sessionId },
    );

    return result.records.map((record: any) => ({
      content: record.get("content"),
      role: record.get("role"),
      metadata: record.get("metadata"),
      threadId: record.get("threadId"),
    }));
  }
  async get(sessionId: string): Promise<SessionData<S> | undefined> {
    const session = this.driver.session({ database: this.config.database });
    try {
      const getMessageQuery = `MATCH (chatSession:\`${this.sessionLabel}\` {sessionId: $sessionId})
      WITH chatSession
      MATCH (chatSession)-[:${this.lastMessageRelType}]->(lastMessage)
      MATCH p=(lastMessage)<-[:${this.nextMessageRelType}*0..${this.windowSize * 2 - 1}]-()
      WITH chatSession, p, length(p) AS length
      ORDER BY length DESC LIMIT 1
      UNWIND reverse(nodes(p)) AS messageNode
      RETURN chatSession.state AS state, messageNode`;
      const result = await session.run(getMessageQuery, { sessionId });

      if (result.records.length === 0) {
        return undefined;
      }

      const record = result.records[0];
      const state = JSON.parse(record.get("state") || "{}");
      const messages: any[] = result.records.map((r) => {
        const node = r.get("messageNode");
        return {
          content: JSON.parse(node.properties.content),
          role: node.properties.role,
          metadata: JSON.parse(node.properties.metadata),
          threadId: node.properties.threadId,
        };
      });

      const threads: Record<string, any[]> = {};
      messages.forEach((msg) => {
        if (!threads[msg.threadId]) {
          threads[msg.threadId] = [];
        }
        threads[msg.threadId].push({
          content: msg.content,
          role: msg.role,
          metadata: msg.metadata,
        });
      });

      return {
        id: sessionId,
        state,
        threads,
      } as SessionData<S>;
    } finally {
      await session.close();
    }
  }

  async save(sessionId: string, sessionData: SessionData<S>): Promise<void> {
    const session = this.driver.session({ database: this.config.database });
    try {
      const tx = session.beginTransaction();
      const sessionResult = await tx.run(
        `MERGE (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
         SET s.state = $state
         RETURN s`,
        { sessionId, state: JSON.stringify(sessionData.state) },
      );
      const sessionNodeId = sessionResult.records[0].get("s").identity;

      let lastNodeId = null;

      const findLastNodeResult = await tx.run(
        `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
         OPTIONAL MATCH (s)-[r:\`${this.lastMessageRelType}\`]->(lastNode)
         RETURN lastNode`,
        { sessionId },
      );
      if (findLastNodeResult.records[0].get("lastNode")) {
        lastNodeId = findLastNodeResult.records[0].get("lastNode").identity;
      }

      const storedMessages = await this.getStoredMessages(tx, sessionId);

      const incomingMessages = Object.entries(
        sessionData.threads ?? {},
      ).flatMap(([threadId, messages]) =>
        (messages ?? []).map((msg) => ({
          threadId,
          msg,
          content: JSON.stringify(msg.content),
          role: msg.role,
          metadata: JSON.stringify(msg.metadata || {}),
        })),
      );

      const incomingStartsWithStoredHistory =
        incomingMessages.length >= storedMessages.length &&
        storedMessages.every((stored, index) => {
          const incoming = incomingMessages[index];

          return (
            incoming &&
            incoming.threadId === stored.threadId &&
            incoming.content === stored.content &&
            incoming.role === stored.role &&
            incoming.metadata === stored.metadata
          );
        });

      const messagesToAppend = incomingStartsWithStoredHistory
        ? incomingMessages.slice(storedMessages.length)
        : incomingMessages;

      for (const { threadId, msg, content, metadata } of messagesToAppend) {
        const createMessageResult = await tx.run(
          `CREATE (m:\`${this.messageLabel}\` {
               content: $content,
               role: $role,
               metadata: $metadata,
               threadId: $threadId,
               timestamp: timestamp()
             })
             RETURN m`,
          { content, role: msg.role, metadata, threadId },
        );

        const newMessageNodeId =
          createMessageResult.records[0].get("m").identity;

        if (lastNodeId !== null) {
          await tx.run(
            `MATCH (n1), (n2)
               WHERE id(n1) = $lastNodeId AND id(n2) = $newMessageNodeId
               CREATE (n1)-[:${this.nextMessageRelType}]->(n2)`,
            { lastNodeId, newMessageNodeId },
          );
        }
        lastNodeId = newMessageNodeId;
      }

      if (lastNodeId !== null) {
        await tx.run(
          `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
           OPTIONAL MATCH (s)-[r:\`${this.lastMessageRelType}\`]->()
           DELETE r
           WITH s
           MATCH (lastNode) WHERE id(lastNode) = $lastNodeId
           CREATE (s)-[:${this.lastMessageRelType}]->(lastNode)`,
          { sessionId, lastNodeId },
        );
      }

      await tx.commit();
    } finally {
      await session.close();
    }
  }

  async clear(sessionId: string): Promise<void> {
    const session = this.driver.session({ database: this.config.database });
    try {
      await session.run(
        `MATCH (s:\`${this.sessionLabel}\` {sessionId: $sessionId})
   OPTIONAL MATCH (s)-[:${this.lastMessageRelType}]->(lastMessage)
                  <-[:${this.nextMessageRelType}*0..]-(m)
   DETACH DELETE s, m`,
        { sessionId },
      );
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
