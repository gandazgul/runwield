# RunWield AI Visibility

Checked August 28, 2026.

## Current Snapshot

RunWield appeared in 0 of 6 answers sampled from AI assistants such as ChatGPT, Perplexity, and Google AI Overviews.
This is expected immediately after launch. Public searches do not yet reliably surface RunWield or `runwield.dev`, so
the immediate problem is discovery and indexing rather than evidence that the positioning has failed.

| Question                                                                                                       | Result    | Other brands named                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What are the best tools for managing AI agents in a software development workflow?                             | Not shown | CrewAI, LangGraph, AutoGen, SmolAgents, LangSmith, n8n, Voiceflow, Dify, AutoGPT, Microsoft Copilot Studio, Cognigy.AI, Gemini Enterprise Agent Platform, Vertex AI, Devin AI, Zapier MCP |
| How can I let an AI agent safely make code changes in my existing repository?                                  | Not shown | Docker, Semgrep, SonarQube, Snyk, CodeRabbit, Sourcery                                                                                                                                    |
| I need a platform that lets an AI coding assistant remember the context of my project across multiple tasks.   | Not shown | Agiflow, Cognee, Cursor, Claude Code                                                                                                                                                      |
| What's the best way to let an AI plan and execute software development tasks while I stay in control?          | Not shown | Atlassian, GitHub Copilot, Cursor, Cline                                                                                                                                                  |
| Are there any AI coding tools that let me create a repeatable workflow from an idea to a finished code change? | Not shown | Cursor, Builder.io, OpenHands, Zapier, Make, WeWeb, Anything                                                                                                                              |
| How can I give an AI coding agent a set of specific skills or templates to use for my project?                 | Not shown | GitHub Copilot, Claude Code, Vercel, AI SDK                                                                                                                                               |

This prompt set is useful as a baseline, but it is not perfectly aligned with RunWield. The first question compares
RunWield with general agent-orchestration frameworks. Project memory and skills are supporting capabilities rather than
the central promise. Questions about safe repository changes, human-controlled planning and execution, and repeatable
idea-to-validated-change workflows are the strongest fit.

## Technical Baseline

As of the check date:

- `https://runwield.dev/robots.txt` is live and permits crawling.
- `https://runwield.dev/sitemap-index.xml` is live.
- `https://runwield.dev/llms.txt` is live.
- Requests identifying as OAI-SearchBot and PerplexityBot receive HTTP 200 responses from the homepage.
- The site has canonical metadata, a textual product description, and crawlable primary content.

The baseline is healthy. `llms.txt` is worth keeping, but it is an additional discovery aid rather than a substitute for
indexed HTML, strong documentation, original evidence, and independent references.

## Priorities

### 1. Get indexed

- Verify `runwield.dev` in Google Search Console.
- Submit `https://runwield.dev/sitemap-index.xml`.
- Request indexing for the homepage and important new pages.
- Add the domain to Bing Webmaster Tools and submit the sitemap.
- Consider IndexNow notifications when pages, guides, and releases change.

Google requires a page to be indexed and eligible for an ordinary search snippet before it can appear as a supporting
link in AI Overviews or AI Mode. There is no separate generative-AI submission mechanism.

### 2. Publish the documentation as crawlable HTML

Publishing the existing documentation at `docs.runwield.dev` is likely the single largest technical improvement. Most of
RunWield's substantive explanations currently live in GitHub Markdown, while the brand site offers one indexable page.

Important concepts should have stable HTML URLs, descriptive titles, canonical links, internal links, and sitemap
entries. Initial candidates include:

- `/concepts/plans`
- `/concepts/work-records`
- `/guides/safely-let-ai-agents-change-code`
- `/guides/idea-to-validated-code-change`
- `/guides/persistent-memory-for-coding-agents`
- `/guides/project-specific-agent-skills`

### 3. Publish answer-oriented guides

Start with the questions that best match the product promise:

1. **How to safely let an AI agent change an existing repository**
2. **A repeatable workflow from rough idea to validated code change**
3. **How to plan and execute AI-assisted code changes without losing engineering control**

Each guide should answer the question independently, provide a concrete example, and then explain how RunWield handles
the problem. Avoid producing thin pages solely to match benchmark prompts.

### 4. Publish original proof

RunWield's evidence model can produce unusually useful, citable material:

- A public demo repository showing issue -> Plan -> execution -> validation -> Work Record.
- An anonymized real Work Record.
- A case study documenting a non-trivial change, rejected approaches, repairs, and final evidence.
- Release notes that explain what changed and why.
- Short demonstrations with complete text transcripts.

These artifacts provide original information rather than repeating generic claims about AI coding.

### 5. Earn independent references

RunWield's own pages establish what the product claims. Independent sources help establish that the product exists and
that practitioners find it useful.

Prioritize:

- Early-user writeups and case studies.
- A substantive launch in relevant developer communities.
- Engineering newsletters, podcasts, or articles that can discuss the workflow in depth.
- Carefully selected coding-agent resource lists.
- GitHub releases, discussions, topics, and demo repositories that link back to the website.

One detailed early-adopter account is more valuable than many generic AI-tool directory submissions.

### 6. Add conventional semantic metadata

Add JSON-LD that matches visible site content:

- `SoftwareApplication` for RunWield.
- `Organization` for the RunWield brand.

Useful properties include the product name, homepage, GitHub repository, supported operating systems, application
category, installation information, and accurate pricing information. This is ordinary search hygiene, not a special
AI-ranking mechanism. Google says there is no dedicated schema required for generative AI search.

### 7. Measure progress monthly

Track:

- Indexed pages in Google and Bing.
- Branded searches for RunWield.
- OAI-SearchBot and PerplexityBot requests.
- Search impressions for the core product problems.
- ChatGPT referrals containing `utm_source=chatgpt.com`.
- Independent referring domains.
- AI-answer citations and the beta conversions they produce.

Re-run the prompt benchmark monthly using clean sessions. Keep the original six questions for continuity, but add a
smaller set that accurately describes RunWield's category. Separate branded visibility, unbranded problem visibility,
and citation share rather than reducing everything to one score.

## Suggested 30-Day Sequence

### Now

- Register Google Search Console and Bing Webmaster Tools.
- Submit the sitemap and request initial indexing.
- Add matching `SoftwareApplication` and `Organization` metadata.

### Week 1

- Publish the first three answer-oriented guides.
- Link them from the homepage and documentation index.
- Ensure every page appears in the sitemap.

### Week 2

- Publish one complete public example from idea through Work Record.
- Add a reproducible demo repository or fixture where appropriate.

### Weeks 3-4

- Publish a substantive launch or technical writeup.
- Ask early users for concrete feedback and permission to turn successful work into a case study.
- Review indexing, crawler access, referrals, and prompt results before choosing the next content topics.

## Sources

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google: optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)
- [OpenAI publishers and developers FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq)
- [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- [IndexNow documentation](https://www.indexnow.org/documentation)
