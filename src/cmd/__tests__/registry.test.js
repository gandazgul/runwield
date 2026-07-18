import { assertEquals } from "@std/assert";
import {
    getCliCommandDefinitions,
    getCommandDefinition,
    getSlashCommandDefinition,
    getSlashCommandDefinitions,
    hasCommandSurface,
} from "../registry.js";

Deno.test("getCommandDefinition resolves alias", () => {
    const command = getCommandDefinition("agents");
    assertEquals(command?.name, "agent");
});

Deno.test("getCliCommandDefinitions excludes slash-only commands", () => {
    const commands = getCliCommandDefinitions();
    assertEquals(commands.some((command) => command.name === "export"), false);
    assertEquals(commands.some((command) => command.name === "settings"), false);
    assertEquals(commands.some((command) => command.name === "router"), true);
    assertEquals(commands.some((command) => command.name === "acp"), true);
});

Deno.test("getSlashCommandDefinitions excludes cli-only commands", () => {
    const commands = getSlashCommandDefinitions();
    assertEquals(commands.some((command) => command.name === "plans"), false);
    assertEquals(commands.some((command) => command.name === "acp"), false);
    assertEquals(commands.some((command) => command.name === "theme"), true);
    assertEquals(commands.some((command) => command.name === "settings"), true);
});

Deno.test("registry surfaces capture theme and model CLI support", () => {
    const theme = getCommandDefinition("theme");
    const model = getCommandDefinition("model");
    assertEquals(theme ? hasCommandSurface(theme, "cli") : false, true);
    assertEquals(theme ? hasCommandSurface(theme, "slash") : false, true);
    assertEquals(model ? hasCommandSurface(model, "cli") : false, true);
    assertEquals(model ? hasCommandSurface(model, "slash") : false, true);
});

Deno.test("getSlashCommandDefinition resolves slash aliases", () => {
    const command = getSlashCommandDefinition("models");
    assertEquals(command?.name, "model");
});

Deno.test("context command is a slash-only built-in", () => {
    const command = getCommandDefinition("context");
    assertEquals(command?.name, "context");
    assertEquals(command ? hasCommandSurface(command, "cli") : true, false);
    assertEquals(command ? hasCommandSurface(command, "slash") : false, true);
    assertEquals(getCliCommandDefinitions().some((definition) => definition.name === "context"), false);
    assertEquals(getSlashCommandDefinition("context")?.name, "context");
    assertEquals(getSlashCommandDefinitions().some((definition) => definition.name === "context"), true);
});
