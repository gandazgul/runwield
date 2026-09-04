/**
 * @module acp/schema-conformance
 * Validates ACP frames against the JSON Schema published by @agentclientprotocol/sdk.
 *
 * The SDK keeps its generated zod schemas private, but ships `schema/schema.json`
 * as a public export. That file is the authority here, so a protocol change shows
 * up as a test failure instead of silently passing.
 *
 * Test support only. The ACP schema declares no `additionalProperties: false`,
 * so this checker covers the keywords the schema actually uses and nothing more.
 */

import acpSchemaDocument from "@agentclientprotocol/sdk/schema/schema.json" with { type: "json" };

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * The keywords the ACP schema actually uses. Values are optional because the
 * generated JSON gives sibling branches `undefined` for keys they do not set.
 */
type JsonSchemaNode = {
    $ref?: string;
    type?: string | string[];
    const?: JsonValue;
    enum?: readonly JsonValue[];
    required?: readonly string[];
    properties?: Record<string, JsonSchemaNode | undefined>;
    items?: JsonSchemaNode;
    allOf?: readonly JsonSchemaNode[];
    anyOf?: readonly JsonSchemaNode[];
    oneOf?: readonly JsonSchemaNode[];
    not?: JsonSchemaNode;
    minimum?: number;
};

type AcpSchemaDocument = {
    $defs: Record<string, JsonSchemaNode | undefined>;
};

const schema = acpSchemaDocument as AcpSchemaDocument;

const DEF_REF_PREFIX = "#/$defs/";

/**
 * Resolve a local `#/$defs/Name` reference.
 *
 * @param ref reference string from the schema
 */
function resolveRef(ref: string): JsonSchemaNode {
    if (!ref.startsWith(DEF_REF_PREFIX)) throw new Error(`Unsupported ACP schema reference: ${ref}`);
    const name = ref.slice(DEF_REF_PREFIX.length);
    const definition = schema.$defs[name];
    if (!definition) throw new Error(`Unknown ACP schema definition: ${name}`);
    return definition;
}

/**
 * Report whether a value matches one JSON Schema primitive type name.
 *
 * @param typeName JSON Schema type name
 * @param value value under test
 */
function matchesType(typeName: string, value: JsonValue): boolean {
    switch (typeName) {
        case "object":
            return typeof value === "object" && value !== null && !Array.isArray(value);
        case "array":
            return Array.isArray(value);
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number";
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "boolean":
            return typeof value === "boolean";
        case "null":
            return value === null;
        default:
            throw new Error(`Unsupported ACP schema type: ${typeName}`);
    }
}

/**
 * Collect schema violations for one value, resolving refs and combinators.
 *
 * @param node schema node to apply
 * @param value value under test
 * @param path JSON path used in messages
 */
function collectViolations(node: JsonSchemaNode, value: JsonValue, path: string): string[] {
    const violations: string[] = [];
    if (node.$ref) return collectViolations(resolveRef(node.$ref), value, path);

    if (node.type !== undefined) {
        const names = Array.isArray(node.type) ? node.type : [node.type];
        if (!names.some((name) => matchesType(name, value))) {
            violations.push(`${path}: expected type ${names.join("|")}, got ${JSON.stringify(value)}`);
            return violations;
        }
    }
    if (node.const !== undefined && JSON.stringify(value) !== JSON.stringify(node.const)) {
        violations.push(`${path}: expected const ${JSON.stringify(node.const)}, got ${JSON.stringify(value)}`);
    }
    if (node.enum && !node.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
        violations.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(node.enum)}`);
    }
    if (node.minimum !== undefined && typeof value === "number" && value < node.minimum) {
        violations.push(`${path}: ${value} is below minimum ${node.minimum}`);
    }
    if (node.not && collectViolations(node.not, value, path).length === 0) {
        violations.push(`${path}: value matched a forbidden schema`);
    }

    const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
    if (isObject) {
        const record = value as { [key: string]: JsonValue };
        for (const key of node.required || []) {
            if (record[key] === undefined) violations.push(`${path}: missing required property "${key}"`);
        }
        for (const [key, propertySchema] of Object.entries(node.properties || {})) {
            if (!propertySchema || record[key] === undefined) continue;
            violations.push(...collectViolations(propertySchema, record[key], `${path}.${key}`));
        }
    }
    if (node.items && Array.isArray(value)) {
        value.forEach((entry, index) => {
            violations.push(...collectViolations(node.items as JsonSchemaNode, entry, `${path}[${index}]`));
        });
    }

    for (const subSchema of node.allOf || []) violations.push(...collectViolations(subSchema, value, path));
    for (const key of ["anyOf", "oneOf"] as const) {
        const branches = node[key];
        if (!branches) continue;
        const branchViolations = branches.map((branch) => collectViolations(branch, value, path));
        if (!branchViolations.some((found) => found.length === 0)) {
            violations.push(`${path}: matched no ${key} branch (${branchViolations.flat().join("; ")})`);
        }
    }
    return violations;
}

/**
 * List the ways a value fails one named ACP schema definition.
 *
 * @param definitionName key under the schema's `$defs`
 * @param value value under test
 */
export function findAcpSchemaViolations(definitionName: string, value: JsonValue): string[] {
    const definition = schema.$defs[definitionName];
    if (!definition) throw new Error(`Unknown ACP schema definition: ${definitionName}`);
    return collectViolations(definition, value, definitionName);
}

/**
 * Throw unless a value matches one named ACP schema definition.
 *
 * @param definitionName key under the schema's `$defs`
 * @param value value under test
 */
export function assertAcpSchema(definitionName: string, value: JsonValue): void {
    const violations = findAcpSchemaViolations(definitionName, value);
    if (violations.length > 0) {
        throw new Error(`ACP ${definitionName} schema violations:\n  ${violations.join("\n  ")}`);
    }
}

/**
 * Parse one serialized NDJSON frame and assert its payload matches an ACP definition.
 *
 * Validating the serialized text keeps the assertion honest about what a strict
 * Client actually receives, not just what the adapter built in memory.
 *
 * @param definitionName key under the schema's `$defs`
 * @param frame a single NDJSON line holding a JSON-RPC message
 * @param select picks the validated payload out of the parsed frame
 */
export function assertAcpFrameSchema(
    definitionName: string,
    frame: string,
    select: (message: { [key: string]: JsonValue }) => JsonValue,
): void {
    const parsed = JSON.parse(frame) as { [key: string]: JsonValue };
    assertAcpSchema(definitionName, select(parsed));
}
