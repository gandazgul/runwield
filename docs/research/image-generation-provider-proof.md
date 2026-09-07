# Image generation provider proof

Tested on 2026-09-06. Scope: Pi's existing image provider, Antigravity CLI, the official Codex App Server with
subscription authentication, and Google's `@google/genai` library. No requests were made directly to undocumented Codex
backend endpoints. No RunWield implementation or dependency changes were made.

## Results

| Route                                  | Generate                                     | Edit using reference | Evidence                                                                                                                                  |
| -------------------------------------- | -------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Pi / OpenRouter                        | Blocked: missing credential                  | Not attempted        | Pi 0.84.2 discovers image models; `generateImages()` returns `stopReason: "error"`, `No API key for provider: openrouter`, and no output. |
| Agy subscription                       | Passed after one earlier failed request      | Passed               | Native `generate_image` events, actual JPEG files, and visual inspection.                                                                 |
| Official Codex App Server subscription | Passed after correcting agent tool arguments | Passed               | ChatGPT account type, image capability, completed `imageGeneration` items with `savedPath`, actual PNG files, and visual inspection.      |
| Google Gen AI SDK                      | Blocked: missing credential                  | Not attempted        | Installed SDK 1.52.0 loads, but reports that an API key is required. Client construction alone does not prove generation.                 |

This is partial confirmation, not four successful live integrations. OpenRouter and Google require a configured key and
a real generation/edit test before their implementation acceptance criteria can be closed. The API-key OpenAI SDK was
not tested; the official OpenAI route tested here is Codex App Server, using its existing ChatGPT login.

## Agy

The first request asked for flat geometric shapes. The native tool emitted a tool-step error:
`no image generated in response`. The CLI nevertheless exited successfully with final `status: "SUCCESS"`, because the
agent successfully explained the failure. There was no image. This must become an adapter regression case.

A second, separate request asked for a red ceramic mug on white. It succeeded:

- CLI: installed `/Users/gandazgul/.local/bin/agy`.
- Arguments: `-p`, `--output-format stream-json`, `--print-timeout 3m`, `--effort low`.
- Native image-tool duration: 10.27 seconds; total turn duration: 18.54 seconds.
- Generated image: JPEG, 1024 × 1024.
- A fresh process then edited that reference, changing the glaze from red to cobalt blue.
- Edit tool duration: 8.57 seconds; total turn duration: 12.51 seconds.
- Edited image: JPEG, 1024 × 1024. Visual inspection confirmed the color change and retained composition.
- The edit's host transcript records `ImagePaths` with the exact input file. The public stream's abbreviated
  `tool_info.parameters` omitted that array, so absence from that abbreviated object does not prove absence from the
  actual call.

Successful native tool steps did not include the saved path in their public stream payload in these runs. The final
agent response supplied it. Production must validate a requested structured final path against the current run,
successful native tool event, filesystem metadata, and decoded image bytes. Do not depend on private host transcript
files for production path discovery; those files were inspected only to establish reference use during this proof.

No dangerous permission bypass, global custom-agent install, or MCP configuration change was used. Agy created its
ordinary conversations and image files in its own storage. Test copies are in the temporary proof directory below.

## Codex

Used `codex-cli 0.153.3`, installed with the desktop app. The probe spawned `codex app-server` and exchanged JSON-RPC
through stdio. Its sequence was `initialize`, `initialized`, `account/read`, `modelProvider/capabilities/read`,
`model/list`, `thread/start`, `turn/start`, then item and turn completion notifications.

- `account/read` returned account type `chatgpt`; the probe rejected API-key account fallback.
- Provider capabilities reported `imageGeneration: true`.
- The first generation attempt used `gpt-5.4-mini`. It completed without an image and reported an invalid
  reference-image-count argument. This is an agent/tool invocation failure, not evidence of a subscription API failure.
- The successful generation and edit used supervising model `gpt-5.6-sol`, reasoning effort `low`.
- For generation the prompt explicitly required only the `prompt` argument and omission of both optional reference
  selectors. Passing zero as a reference-image count is invalid.
- For editing the prompt supplied `referenced_image_paths` and required omission of `num_last_images_to_include`.
- Each operation used a fresh ephemeral thread in the temporary working directory.
- Generation completed in 32.9 seconds; editing completed in 27.2 seconds.
- Both produced `imageGeneration` items with `status: "completed"`, `failure: null`, and an actual `savedPath`.
- Both files are PNG, 1254 × 1254. These observed dimensions are not a configurable size guarantee.
- Visual inspection confirmed a red mug, then a blue version retaining the original composition.

The host saved images under its `generated_images` directory; the probe copied the files into the proof directory. It
did not extract or forward the Codex access token. Only official local App Server methods were called by the probe. The
App Server itself owns authentication and its network calls.

The native tool's image model and rendering options are host-managed. Model/effort selection in this proof controls the
supervising Codex agent. It is not an image-model thinking setting or a demonstrated quality/size API.

## Local evidence

Temporary proof directory: `/private/tmp/runwield-image-proof.ozh5hM`. This directory is local evidence, not a durable
dependency or a CI fixture. No credentials are embedded in its probe scripts or summaries.

| File                   | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `agy-generation.jpg`   | `5b073b26adc797ca0558e592d6d47c89d950217cdf95d159985a46a0d934ca88` |
| `agy-edit.jpg`         | `9ff328ff1a194e4e488276a82c7963a8119b45abd11e6dd90533d789a124b4b5` |
| `codex-generation.png` | `a0e7042e81e866df5414d4cf93cf9c72629a9e9cf2e08a420167576274907e96` |
| `codex-edit.png`       | `0280ebc1a4600b03d451a21a3d278026e07e789db617ce323d300711780df8a6` |

The directory also contains `codex-app-server.mjs`, separate first-attempt/retry/edit result summaries, `check-auth.ts`,
and `api-auth-probes.ts`. Do not rerun successful generations just to verify documentation.

## Remaining live checks

1. Configure OpenRouter through RunWield's existing credential setup or `OPENROUTER_API_KEY`. Generate a mug through
   Pi's `builtinImagesModels().generateImages()`, save and inspect the image block, then submit it as an image input for
   an edit. Record model ID, actual MIME type, size, usage when provided, and reference-edit behavior.
2. Configure Google's existing API credential or `GEMINI_API_KEY`. Use the official `@google/genai` library to generate
   and edit an image. Validate actual response parts, image model ID, and the chosen thinking option. Do not substitute
   an Agy login for Gemini API credentials.
3. Record failures separately from missing prerequisites. Never call a fixture response or SDK constructor success a
   completed live generation test.

## Sources

- [Pi image API](../../node_modules/@earendil-works/pi-ai/README.md) — installed 0.84.2 image-generation section.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server) — official local client protocol.
- [Codex image generation](https://learn.chatgpt.com/docs/image-generation) — subscription usage and host behavior.
- [Antigravity headless mode](https://antigravity.google/docs/cli/headless/) — cached login, public stream, and output
  schema.
- [Antigravity models](https://antigravity.google/docs/models/) — supervising model versus host-managed image model.
- [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation) — official image models and
  controls.
- [Google Gen AI SDK](https://github.com/googleapis/js-genai) — official SDK.
