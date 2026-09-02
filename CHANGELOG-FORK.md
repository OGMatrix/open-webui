# Changelog — fork

Changes made in this fork, on top of Open WebUI. Upstream's own changelog is
in [CHANGELOG.md](CHANGELOG.md) and is left untouched, so the two never have
to be untangled from each other.

Each entry names the upstream version it was built on. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the
upstream version plus a fork counter, so `0.11.3-ogm.2` is the second release
cut from upstream 0.11.3.

Releases are produced by the `Fork · Release` workflow, which writes this file.

<!-- fork-release: new entries are inserted directly below this line -->

## [0.11.3-ogm.1] - 2026-09-02

Built on Open WebUI `0.11.3` (`upstream/dev` at `0cf48a04c`), fork commit `fc295704f`.

### Added

- Show live token count, speed and elapsed time under each response (2412cf345)
- Show a placeholder while a chat title is generated, then reveal it (63d51cc5d)
- Pick the thinking effort per model from the chat input (f2c224633)
- Read thinking support from the provider instead of only guessing from the model name (aeda0a162)
- Trust a gateway's advertised parameters for thinking support (143840043)
- Ask llama.cpp what the loaded model can do (9f0342555)
- Show context window usage and token totals in the message input (37b116230)
- Put the context indicator in the input bar instead of behind a slash command (4052bde0c)
- Derive the context window from the model so the usage bar has a scale (003aa99f8)
- Show prefill progress and estimated time while the prompt is read (43d1d888e)
- Chart the decode rate across a chat's turns (b3f726d3f)
- Estimate what a chat cost where the provider publishes prices (66c8ae3f2)
- Load a model straight from the model picker (dbbc97d70)
- Warn before a message would overflow the context window (db973d9eb)
- Use the effort levels a gateway states for a model (944cd050a)
- Render bare LaTeX environments such as align and cases (2437c2034)
- Let models check a diagram before it reaches the chat (d937df2ac)
- Make tables, prose and diagrams worth looking at (2ef276afc)
- Let the model ask a real question, not just pick one of three (08438c844)
- Tell model names apart when they are nearly the same (235cafea7)
- Land settings search on the setting, and tie each row together (d9a956360)
- Make each integration row say what it is and whether it is on (3affd6a46)
- Put family headings in the model list (a86aae9df)
- Recognise Hermes Agent, and show the tools it is running (a2c096e7a)
- Say what a Hermes server brings while you connect it (d7d10104d)
- Offer the thinking levels a model itself accepts (170c10c2c)
- Start a new chat on the thinking level that will actually be used (f0a898c64)
- Let the input frame show how fast the model is answering (b48cf554a)
- Light the input from the inside, with grain over it (8c2650c15)
- Let the frame show what is happening, not just that something is (326bff4b9)
- Choose the input animation by watching it, not by reading its name (3ffd283eb)
- Fit the designer into the page, and give the frame a way in and out (66071db6a)
- Let the light leave the box, in step with the edge (8144b16a8)

### Fixed

- Break the calendar import cycle that stops the backend booting (75bb9fa21)
- Make the title placeholder shimmer visible and reveal the generated title, not the stand-in (033b47a08)
- Make the title placeholder shimmer loop seamlessly (4d245383e)
- Give the thinking effort dropdown an opaque surface (8e1b3f79b)
- Match the app's menu style, and toggle thinking where a model only has on and off (8d20cce37)
- Size the context ring like the icons beside it (93065ae55)
- Read the context size from a llama.cpp router's model arguments (4307132b5)
- Drop the redundant caret and refresh context figures while streaming (336f94b85)
- One ask_user, and a diagram check that asks the parser (cd6377cf3)
- Do not forget what a model said, and do not load one to ask (b3e49dc62)
- Show the animation on an ordinary answer, not just a merged one (9a4d520f5)
- **ci:** let a dry run mean it, and leave live alone (cd2041d83)
- **ci:** tell the truth when a sync pull request cannot be opened (0384d7a8e)
- **ci:** stop claiming a pull request that was refused (d659cfb5a)
- **ci:** a boolean input is not a boolean, and a skip is not a success (6dd583bb8)
- **ci:** decide in a shell what an expression kept getting wrong (fc295704f)

### Changed

- Stop re-dialling MCP servers on every message (21b32cd9f)

### Internal

- Add a script to keep the live branch in sync with upstream dev (fda24fb76)
- Release this fork, and keep it current with upstream (7a757d1c4)
