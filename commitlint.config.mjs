export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", [
      "feat", "fix", "docs", "style", "refactor",
      "perf", "test", "build", "ci", "chore", "revert",
    ]],
    "scope-enum": [2, "always", [
      "imap", "smtp", "http", "agent", "alerts", "pass",
      "config", "deps", "release", "ci", "docs", "tests", "web",
    ]],
  },
};
