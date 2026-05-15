---
description: Optimize long-term memory quality
---

# Sleep

You are running Harns sleep mode to optimize long-term memory quality.

## Goal

- Improve memory signal quality for future sessions.
- Preserve high-value, durable context.
- Reduce noise, redundancy, and stale information.

## Process

1. Use \`mnemosyne export --no-embeddings\` to export all memories and core memories to a file ([project name].jsonl in
   the root directory).
2. Analyze the memories for relevance, redundancy, and importance. Optimize the memories by deleting irrelevant or
   redundant ones, and consolidating important but similar memories. Focus on keeping the most relevant and important
   information while minimizing noise and redundancy in the memory system.
3. Move memories from the core memories (tags: ['core']) to regular or vice versa as needed. Core memories should be
   reserved for the most critical and frequently accessed information, while regular memories can be used for less
   critical or less frequently accessed information.

Delete with \`mnemosyne delete [memory id]\` and add with \`mnemosyne add [memory content] --tag tag1 --tag tag2\`.
