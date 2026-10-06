/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  testPathIgnorePatterns: ["/node_modules/", "/lib/"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          isolatedModules: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@neo4j-labs/agent-memory$":
      "<rootDir>/node_modules/@neo4j-labs/agent-memory/dist/index.js",
  },
};
