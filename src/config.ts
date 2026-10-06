export function getDefaultConfig() {
  const {
    NEO4J_URI: url,
    NEO4J_USERNAME: username,
    NEO4J_PASSWORD: password,
    NEO4J_DATABASE: database,
  } = process.env;

  if (!url || !username || !password) {
    throw new Error(
      "Please provide Neo4j connection details through environment variables: NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD are required.\n" +
        "For more details see https://neo4j.com/docs/api/javascript-driver/current/",
    );
  }

  return {
    url,
    username,
    password,
    ...(database && { database }),
  };
}
