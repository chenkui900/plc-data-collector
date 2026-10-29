module.exports = {
  apps: [{
    name: "plc-server",
    script: "server/src/index.ts",
    interpreter: "npx",
    interpreter_args: "tsx",
    env: {
      NODE_OPTIONS: "--experimental-sqlite"
    }
  }]
}