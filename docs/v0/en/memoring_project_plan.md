# Memoring Project Plan

This document is the project plan explaining why Memoring is needed, what value it brings and to whom, and where it is headed. Its purpose is to let investors, collaborators, developers, and the AI agents involved with Memoring understand the product's aim and worldview as quickly as possible. Data schemas, Invariants, CLI details, and requirements definitions are not covered here. Technology is touched on only to the extent needed as "the basis of value"; beyond that, it is left to the design documents.

---

## 1. In One Line

**Memoring: Own your AI memory.**
Turn the history scattered across AI tools into your own memory asset.

Memoring is an OSS **Sovereign Memory Loop** that ingests the conversations, instructions, responses, tool executions, command results, file diffs, decisions, constraints, preferences, and work patterns that AI tools such as Codex, Claude Code, ChatGPT, Claude, and Gemini accumulate locally, and automatically accumulates, organizes, classifies, abstracts, and consolidates them as a memory asset the user can effectively control, so they can be recalled as safe context only when needed.

Here, "own" does not mean comprehensive legal ownership. It means user-controlled — that is, "you hold your own copy, and you control the keys, deletion, portability, and output." It does not assert legal ownership of third-party content.

---

## 2. The Problem It Solves

AI has already begun to remember you. The more you interact, the more its responses take into account past decisions, preferences, and constraints to be honored.

But that memory is fragmented per service and scattered locally. Codex has memory only inside Codex, Claude Code only inside Claude Code, ChatGPT only inside ChatGPT. If you switch to a different tool, the context you have built up so far starts over from zero. Moreover, its actual substance — the sessions and history each tool accumulates in hidden folders such as those under your home directory — does exist right there in your hands, yet it has not become an asset you can use across tools.

As a result, the following happens.

- You re-explain the same premises, the same preferences, and the same constraints over and over every time you change tools.
- Past decisions and work patterns lie dormant in some local file, never reused.
- Memory is enclosed within the vendor's service, and the user themselves cannot control it.

The more AI becomes part of daily life, the more the cost of this fragmentation piles up. Memoring re-binds this "fragmented, scattered, enclosed memory" into a single memory asset in the user's own hands.

---

## 3. What Memoring Is / Is Not

### 3.1 It Is Not a Log Storage Tool

If all you want is to store logs, a database will do. Memoring is not a database. DB, object store, and index are merely the foundation. The product's core value lies in the loop that keeps growing history into "usable memory and context."

Memoring's value lies in keeping the following chain turning.

```text
capture → accumulate → organize → classify → abstract → consolidate → accumulate further
```

When this chain turns, scattered history becomes not mere records but reusable memory and context. The context produced at the output is used in the next AI work, and that work history is once again ingested from the input. This closes the whole. This is the **Sovereign Memory Loop**, and it is the core of Memoring.

### 3.2 Capture, Auto-Loop, Output

Memoring's workings can be grasped in three beats: ingest, metabolize, and hand off.

- **Capture (Input)**: Find and ingest the local accumulations of AI tools. The input judges nothing. First it ingests without breaking, then encrypts and accumulates.
- **Auto-Loop (Loop)**: Organize, classify, and abstract the ingested data, and consolidate it as long-term memory. It runs fully automatically, with no manual approval queue in between.
- **Output (Output)**: Recall it as safe context only when needed. The default output is a file called `.memoring/context.md`, which can be read by almost any AI tool.

Ingestion "does not think"; organizing and classifying are where "the AI thinks." This division of roles is at the center of Memoring's design.

---

## 4. Why It Is Needed

The principles Memoring upholds are themselves the answer to "why it is needed."

### 4.1 Sovereignty — own your AI memory

Memory should belong to the user, not to the vendor. Memoring's "own" means user-controlled. Your copy, your keys, your deletion, your portability. It takes control of the memory asset back into the user's hands.

### 4.2 local-first

The place memory is kept is local first. Entrusting it to the cloud is not a premise. Data is held encrypted on the user's device, and plaintext raw data never remains on disk. You can carry it to the cloud if you want, but even then you encrypt it on the user side before sending it out. The decryption key is always in the user's hands.

### 4.3 model-independent

Memoring is not tied to a particular AI model or service. Whether Codex, Claude Code, or ChatGPT — any tool that accumulates history locally can be ingested. The AI that uses the memory is also open to any of local models, major provider APIs, or coding agents. It does not cause the lock-in where memory optimized for one tool becomes worthless the moment you switch to another.

### 4.4 OSS

Memoring is open source. Once you proclaim memory sovereignty, it follows that the mechanism itself must be verifiable, self-contained in the user's hands, and not dependent on any particular company's black box.

---

## 5. For Whom It Has Value

### 5.1 Target Users

- Individuals who use AI coding agents / AI chat on a daily basis.
- Users who want to turn the local history of Claude Code / Codex into an asset.
- Users who want to grow their own AI work history into a future RAG / Context / Dataset.

Memoring first establishes value narrowly for single-user / local-first. Central management for teams or organizations is not a near-term target; first it fully builds the experience of "an individual controlling their own AI memory."

### 5.2 Use Cases

- **Turning AI history into an asset**: Turn conversations, decisions, and work patterns that were previously used up and thrown away into memory that can be reused across tools.
- **Carrying context forward**: Every time you start a new session, carry past decisions, preferences, and constraints forward as `context.md`. You no longer need to re-explain the same premises every time.
- **Future RAG / Context / Dataset**: Grow the accumulated memory asset into a foundation for search and context generation, and beyond that leave room to expand it into a dataset (under the user's consent and provenance management).

The first value to experience is simple. When you start a new Claude Code / Codex session, Memoring carries your past decisions, preferences, and constraints forward as `context.md`. The protagonist is not search but this "carry-forward."

---

## 6. Worldview — A Loop That Keeps Producing Order

Memoring's design stands on several strong ideas. To read through as a piece, only their core is stated here.

### 6.1 Dissipative Structure — Stop and Disorder Wins

Memory and context, if left alone, head from order toward disorder. The direction in which things proceed on their own is determined by the two-in-one of two slopes: the slope that wants to scatter (entropy), and the slope that wants to settle into a low, easy state by releasing energy (enthalpy). Memory is the same: if left alone, the contents scatter, and the loop too slacks off and falls down toward an easy approximation. Ordered memory is a state that defies these two, and it cannot be maintained by neglect.

Against this, Memoring responds not with trying to "preserve order as a closed system" but with a **dissipative structure** that "keeps producing order as an open system." Just as a refrigerator keeps using electric power to cool its interior and exhausts that much heat to the outside, the only way to maintain local order is to keep injecting energy and keep discharging the disorder that arises to the outside. The loop itself is that work, and if it stops, disorder wins. It gives memory the same structure by which life keeps using energy to maintain local order.

From this principle, a single guiding axis that runs through the design — **Metabolic Razor** — is derived.

```text
Manufacture order with structure and the loop, and isolate and discharge the unavoidable disorder.
Do not automate user-dependent judgments; limit them to surfacing them in an easy-to-judge form.
```

The system cannot stand in for the user's judgment, but it can lower the activation energy for that judgment. So Memoring neither forces the elimination of ambiguous things nor neglects them. It surfaces the necessary judgments in a form visible to the user.

### 6.2 The Undiluted is Truth — The Original Is Truth, the Claim Is an Assertion

Classification, summarization, and abstraction always waver. If the model or the rules change, the result changes too. That is precisely why Memoring keeps the pre-interpretation original (Undiluted) as immutable truth, and treats the knowledge built from it as "an evidence-backed Claim."

- The original is not altered except by Delete or Redact.
- Derived data can be regenerated at any time.
- A Claim is treated not as immutable truth but as an assertion that can be re-verified and regenerated from its evidence.

This is not an end in itself but a safety principle for not breaking the loop. If you save only the first AI output and discard the original, you can never again rebuild it into better memory. It is precisely because the original is kept that memory can be regrown each time the model advances.

### 6.3 The Loop Does Not Amplify Its Own Error

The loop that is supposed to produce order can itself become a source of disorder if it runs sloppily. If classification or consolidation is lax, it writes in mistaken Claims and increases disorder. Memoring prevents this structurally. It does not re-eat the context it itself generated as the evidence for its own memory. It does not count what the AI merely paraphrased as independent evidence. This is the same as a refrigerator not sucking back the heat it exhausted outside — it is the valve that does not re-ingest, as input, the disorder once put out of the system. It is precisely because of this prohibition of self-ingestion that the loop can work as a net increase in memory, without re-ingesting its own output and inflating its error. Herein lies the crux of why "closing with the loop" is correct.

To restate all of the above as a single story of energy: the loop's work is to convert raw (low order), which becomes disordered if left alone, into usable context (usable power), and to minimize the wasteful loss (dissipation) that arises along the way. As an analogy, in everyday-language form it comes out like this (this is an analogy, not a physics claim).

```text
usable power = power held − disorder − wasted leakage
```

"Power held" is all of the ingested raw, "disorder" is the portion that scatters through neglect, and "wasted leakage" is dissipation such as wasteful reprocessing, duplicate storage, misclassification, and unnecessary context injection. The judgments already stated can be reread through this single story. Converging to zero diffs at idle is dissipation minimization that does not waste power where there is no change; Ouroboros not re-eating its own output is not re-absorbing disorder once put outside. Metabolic Razor invests the limited power (the work of producing order) only where order can be produced and where it matters. The Undiluted is Truth secures the escape destination for disorder (the discharge destination that is the original). Hiding secret per event is dissipation accepted for the sake of safety. As long as the loop keeps turning, usable power keeps net-increasing even after subtracting disorder and wasted leakage.

---

## 7. The Core of the Value Delivered

The value v0 creates condenses into four. It is designed so that value holds with these four alone. In particular, 1 and 3 (capture and the auto-loop) are the core of Memoring.

1. **Capture**: Ingest history from the local accumulations of AI tools.
2. **Accumulate**: Store the original without breaking it, encrypted.
3. **Loop**: Run organizing, classifying, abstracting, and consolidating automatically.
4. **Output**: Generate `.memoring/context.md` and hand it off as safe context.

Rather than competing on the number of features, it concentrates value into a single loop: "ingest history, turn it into memory automatically, and carry it forward safely."

---

## 8. Differentiation and Positioning

Memoring's uniqueness lies in the fact that it removes several premises that seem obvious for a memory tool.

### 8.1 It Has No Predefined Categories

Memoring does not predetermine fixed categories like personal / private / social / work. Classification is assigned by the AI, matched to the accumulated data.

The reason is clear. If you define categories in advance, data that does not fit them will always appear. Each time, exception handling and new rule definitions accumulate, turning into a cat-and-mouse game. Memoring confines the whole with structure and the loop, and lets the AI handle the irregularity. This is structurally stronger.

### 8.2 Fully Automatic consolidate — No Approval Queue

Many memory systems take a design where "a person approves seemingly important memories one by one." Memoring does not do that. The AI creates candidates, Memoring verifies them, and only those that satisfy the rules and evidence are automatically consolidated into long-term memory. Instead of the user approving each one, the user governs after the fact. They make disliked memory be forgotten, correct it, pin it, and seal it.

"The AI proposes, Memoring verifies, and the user governs after the fact" — this division of roles makes it possible to keep the memory turning without the friction of manual approval.

### 8.3 Safety Is Protected at the "Output Gate"

Memoring's view of safety is distinctive. Not "do not remember dangerous things," but "remember them, but do not output the dangerous ones." Safety is protected not at the memory's input, but at the output Gate.

This Gate judges on two axes: who reads (Audience) and how far to output (Aperture). Secrets such as keys and tokens are not output as-is at any Aperture. Unclassified or undecidable things — if it cannot be judged, do not output it (fail-closed Silence). Furthermore, the safety judgment always comes before ranking (reordering). Ranking is quality adjustment, not a mechanism that loosens safety.

The idea that "you can protect it even while remembering, as long as you do not output it" is consistent with Memoring's philosophy of guaranteeing safety while keeping the original undiscarded (the original is truth).

### 8.4 It Is the "Supply Side" That Ingests Other AIs' Memory

The framework of "short-term context window vs. long-term memory" that ChatGPT and Gemini have is a matter internal to a single assistant. Memoring does not adopt this framework as-is.

That is because Memoring is not the side that uses memory, but the **supply side that ingests the history of other AI tools and turns it into a memory asset**. It holds no conversation buffer of its own; it binds together, across tools, the history each tool has accumulated locally. This is not in competition with existing AI memory features; it is a unique position standing upstream of them. Whichever AI becomes popular, it keeps holding value as the layer that turns that history into an asset.

---

## 9. Future Prospects and Roadmap

Memoring completes the core loop in v0, and expands stepwise from there. It is not "someday," but has a clear line drawn.

### 9.1 What v0 Carries

- Ingestion of the history that Claude Code / Codex accumulates locally.
- Accumulating the ingested original encrypted, without breaking it.
- An auto-loop that runs organizing, classifying, abstracting, and consolidating.
- Generation of `.memoring/context.md` protected by the output Gate.
- Search including Japanese (exact match and n-gram fallback, always installed).

v0 is narrowed to single-user / local-first / CLI + local daemon. The initial Connectors start with the local sessions of Claude Code and Codex, manual import, and ingestion of generic JSONL / Markdown.

### 9.2 v0.1 and Beyond

- **Ingesting ChatGPT / Claude / Gemini exports**: Broaden the range of supported AI tools.
- **local embedding / vector index**: Strengthen semantic search and the suggestion of consolidation candidates for similar labels.
- **MCP server polish**: Refine the standard receptacle for external connections.
- **span (line-level) tracking**: Refine context-injection tracking from the session unit to a finer unit.
- **alias citation**: Make citation IDs into a more manageable form.
- **dataset builder**: Expand the accumulated memory into a training dataset, under provenance and consent management.

These are legitimate lines drawn on the roadmap, deliberately placed in later stages so as not to bloat v0's core.

---

## 10. Marketability

The daily use of AI coding agents and AI chat is rapidly broadening its base. The structure where the more you use them the more history accumulates, and that history scatters across your local machine, strengthens the more the tools spread. The pain that Memoring solves — "fragmented, scattered, enclosed memory" — grows larger the more AI use advances.

The target is the layer where the following two trends overlap.

- **Individuals who use AI as a daily tool intensively**: People who use coding agents and chat every day and feel they want to carry past context forward.
- **The layer that values data sovereignty and privacy**: People who do not want their data enclosed by a particular vendor and want to control it locally.

By being local-first / OSS, Memoring answers these two value systems at once. As an alternative to memory enclosure, it offers the option of taking sovereignty back into the user's hands.

---

## 11. Summary

Memoring's core is not a vast set of features.

```text
AI tools accumulate history locally.
Memoring ingests it, turns it with the auto-loop, and
changes it into memory and context the user can control.
```

- The product is capture → accumulate → auto-loop → recall. The DB is the foundation.
- Classification is not predefined; the AI does it, matched to the data.
- Claims consolidate fully automatically, with no approval queue.
- Safety is protected at the output Gate, and ranking does not loosen safety.
- Memory is controlled by the user. Your copy, your keys, your deletion, your portability.

It re-binds the memory that AI scatters into a single asset in the user's hands, and keeps it turning. That is Memoring's Sovereign Memory Loop.

---

## Related Documents

- Final Design Document (`memoring_design_final_ja.md`): The final version that makes the philosophy, structure, features, constraints, safety, data structures, and operational policy consistent.
- Requirements Document (`memoring_requirements_ja.md`): Functional requirements / non-functional requirements / constraints / out of scope.
- Basic Design Document (`memoring_basic_design_ja.md`): Overall composition, main components, data flow.
