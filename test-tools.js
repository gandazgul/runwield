import { createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition } from "npm:@mariozechner/pi-coding-agent@^0.68.1";
console.log({
  bash: createBashToolDefinition().name,
  grep: createGrepToolDefinition().name,
  find: createFindToolDefinition().name,
  ls: createLsToolDefinition().name,
  read: createReadToolDefinition().name,
  write: createWriteToolDefinition().name,
  edit: createEditToolDefinition().name,
});
