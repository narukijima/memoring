# Memoring 詳細設計書

この文書は、Memoring（メモリング）/ Sovereign Memory Loop（主権記憶循環）を実装するための詳細設計を定める。読者は、core / storage / intake / claim / retrieval / security の各パッケージを実装するエンジニア、および AI である。データモデル contract、状態遷移、各コンポーネントの責務と処理単位、構造不変条件、エラー処理、権限と権威、セキュリティ、ログ、テスト観点、Recipe 初期値を、実装が迷わない粒度で示す。

思想・スコープ・市場性は完成版設計書（憲法、`memoring_design_final_ja.md`）と企画書（`memoring_project_plan_ja.md`）に、ID 付き要件は要件定義書（`memoring_requirements_ja.md`）に、利用者視点の操作仕様は仕様書（`memoring_specification_ja.md`）に譲る。本文書は「validator / gate / policy が必ず守る契約」と「Recipe が所有する tunable」を厳密に区別し、JSON スキーマ・式・数値は substance を逐語的に保持する。

本文書中、Invariant（不変条件）は設計時に固定する形であり validator / gate / policy が必ず守る。Tunable は versioned Recipe が所有する初期値であり第10章にまとめる。両者を取り違えてはならない。

---

## 1. データモデル contract

完全な DB schema ではなく、実装が守る contract である。機械可読 schema の正本は `schemas/*.schema.json`（または zod / io-ts）であり、required / optional / enum / version / migration をそこで確定・検証する。本章の JSON 例はその人間可読な投影である。DB 全体は at-rest 暗号化される。以下の JSON 例は論理 contract であり、実際の at-rest 表現は opaque ID と encrypted refs を使う。`*_ref` フィールドは暗号化参照であり、平文を保持しない。

核となる entity は次の通りである。

```text
Undiluted
Occurrence
Event
Session
Label
Assignment
Claim
Derivation
ContextPack
Artifact
SealRule
Policy
Chronicle
```

### 1.1 Undiluted

解釈前の不変の原データ。すべての再構築の起点である。

```json
{
  "undiluted_id": "und_01J...",
  "realm_id": "realm_01J...",
  "payload_format": "jsonl_line",
  "encrypted_payload_ref": "objects/7f/ab/obj_01J...",
  "content_fingerprint": "hmac-sha256:...",
  "size_bytes": 4096,
  "compression": "zstd",
  "encryption": { "algorithm": "aead-implementation-choice", "data_key_id": "dek_01J..." },
  "created_at_ref": "encrypted:...",
  "status": "active | redacted | deleted",
  "schema_version": "undiluted.v1"
}
```

フィールドの意味と validator 規則:

- Undiluted immutability は payload bytes の不変性を指す。metadata は Chronicle で append-versioned に更新できる。
- `encrypted_payload_ref` は opaque ref であり、意味名を含めない。
- `content_fingerprint` は `realm_key` を鍵にした HMAC である。同一 Realm 内の dedup を可能にしつつ、既知平文の存在確認（confirmation attack）を防ぐ。Realm をまたぐ dedup はしない。`realm_key` は Realm root secret（rotation 不変。recovery material から導出）から KDF で導出する rotation 不変鍵であり、KEK rotation / DEK rekey をまたいで `content_fingerprint` を変えない（§4.10 / §7.4）。
- `status` は active / redacted / deleted のいずれか。delete / redact は §7.3 の cascade に従う。

### 1.2 Occurrence

Undiluted を、いつ・どの source の・どの cursor で観測したかという接触の記録。同じ raw payload が複数回観測されうるため、Undiluted（何が記録されたか）と Occurrence（それをいつ・どこで・どう観測したか）を分ける。

```json
{
  "occurrence_id": "occ_01J...",
  "undiluted_id": "und_01J...",
  "source_id": "src_01J...",
  "connector_id": "claude_code",
  "connector_version": "Connector.v1",
  "parser_hint": "claude_code_jsonl",
  "source_path_ref": "encrypted:...",
  "source_cursor_ref": "encrypted:...",
  "captured_at_ref": "encrypted:...",
  "capture_method": "watch",
  "assignment_ids": [],
  "status": "captured",
  "schema_version": "occurrence.v1"
}
```

`capture` は唯一の 1 対 2 動詞であり、Undiluted と Occurrence を同時に生む。`source_path_ref` / `source_cursor_ref` / `captured_at_ref` は暗号化参照とする。

### 1.3 Event

source 固有形式を共通の時系列イベントへ翻訳した、観測された事実。`event_identity` により reprocess をまたいで evidence が安定する。

```json
{
  "event_id": "evt_01J...",
  "event_identity": "eid:hmac:<source_identity|session_identity|message_id_or_content_anchor>",
  "occurrence_ids": ["occ_01J..."],
  "session_id": "ses_01J...",
  "turn_id": "turn_01J...",
  "event_type": "tool_result",
  "role": "tool",
  "origin": "tool_result",
  "created_at_ref": "encrypted:...",
  "timestamp_confidence": "source_reported",
  "sequence": 42,
  "text_ref": "encrypted:...",
  "source_extra_ref": "encrypted:...",
  "source_account_ref": "encrypted:optional",
  "tool": { "name": "bash", "input_ref": "encrypted:...", "exit_code": 1,
            "stdout_artifact_id": "art_...", "stderr_artifact_id": "art_..." },
  "assignment_ids": ["asg_..."],
  "sensitivity": "unknown",
  "sensitivity_classification_state": "candidate",
  "context_injected": false,
  "context_pack_id": null,
  "context_pack_digest": null,
  "context_recipe_id": null,
  "injected_at_ref": "encrypted:null_or_time",
  "parser_version": "claude_code_jsonl.v1",
  "schema_version": "event.v1"
}
```

フィールドの意味と validator 規則:

- `event_id` は schema 表現であり、Parser version 変更で変わりうる。
- `event_identity` は不変の opaque HMAC であり、`undiluted_id` を含めず source 上の論理座標から導く（§4.10）。Claim の evidence はこれを指す。導出規則は次節 §1.3.1 を参照。
- `origin` は evidence の素性を表し、Ouroboros Guard / evidence の可否を決める一次フィールドである。値は次節 §1.3.2 を参照。
- `sensitivity_classification_state` は scope の classification_state と同じ状態空間を持ち、AI が作れるのは candidate までである。
- `context_injected` 系は session-level の provenance であり（同一 session の event 間で同値）、Memoring-generated context.md を読ませて開始された session を signed marker 一致で検出したときに設定する。`context_pack_digest` は ContextPack の `self_ingestion_marker_digest` と一致する。意味は「この session は Memoring-generated context.md / ContextPack を読ませて開始された session である」に固定する。

#### 1.3.1 event_identity の導出（§12.10）

`event_identity` は raw bytes ではなく source 上の論理座標に固定する。`undiluted_id` は内容由来（`content_fingerprint` は HMAC）であり dedup や再取得で指す先が変わりうるため、identity の根拠にしない。

```text
source_identity  = hmac(realm_key, connector_id || source_stable_id || source_account_stable_key)
session_identity = hmac(realm_key, source_identity || host_session_stable_id)
event_identity   = hmac(realm_key, source_identity || session_identity || (message_id | content_anchor))
                   # source が安定 id を持てば message_id、無ければ content_anchor

connector_instance_id は identity から外す。再 connect / restore で値が変わりうるため、
  provenance / config 参照へ降格する（§1.9）。
undiluted_id は event_identity に含めない。raw への traversal pointer に降格する。
reprocess（Parser version 変更）は event_identity を変えない。
re-dedup / content_fingerprint 方式変更も event_identity を変えない。
再 connect / restore も event_identity を変えない（安定座標による）。
Claim.evidence は event_identity を指す（undiluted_id ではない）。
```

`source_logical_position` は Connector ごとに contract 化する。

```text
append source:   stable offset / message id / source cursor
snapshot source: content-anchored hash（line number ではない）
```

`realm_key` を鍵に使うことで `event_identity` は Realm をまたいで衝突せず、identity 自体が機微情報を平文で晒さない。`realm_key` は Realm root secret（rotation 不変）から導く rotation 不変鍵であり、KEK rotation / DEK rekey / reconnect / restore をまたいで `event_identity` / `content_fingerprint` / `normalized_key` / `SealRule.target_signature` を不変に保つ（§4.10 / §7.4）。これにより Seal 済みが reprocess / 再 capture で復活しうる安全違反を閉じる。

#### 1.3.2 origin 値（§14.3）

`origin` は evidence の素性を表す。

```text
origin の値（10 値）:
  user              ユーザー発話 / 明示指示・決定・訂正（external observation）
  tool_result       tool / command 出力（external observation）
  command_result    シェル等の実行結果（external observation）
  file_diff         ファイル変更 / diff（external observation）
  external_artifact  取り込んだ外部成果物（external observation）
  assistant         宿主 AI の応答・言い換え（independent evidence 不可）
  host_summary      宿主が生成した要約（independent evidence 不可・evidence 資格なし）
  host_memory       宿主自身の memory / CLAUDE.md 的注入（independent evidence 不可・evidence 資格なし）
  system            宿主の system / 設定 / CLAUDE.md 的注入（independent evidence 不可・evidence 資格なし）
  unknown           判定不能（independent evidence 不可・evidence 資格なし扱い）

independent evidence 可（= external_observation）: user / tool_result / command_result / file_diff / external_artifact
independent evidence 不可: assistant / host_summary / host_memory / system / unknown
evidence そのものにできない（derived / 非権威）: host_summary / host_memory / system / unknown
```

`origin ∈ {assistant, host_summary, host_memory, system, unknown}` は独立 evidence 信号にならず、`origin ∈ {host_summary, host_memory, system, unknown}` は evidence そのものにできない。これにより host 側 memory を Memoring が観測 → Memoring が再注入 → host memory に戻る、という laundering ループを閉じる。`source_account_ref` は同一 source 内の複数アカウント / 識別子を区別する provenance である。

`system`（宿主の system / 設定 / CLAUDE.md 的注入）は independent evidence にしない。constraint / decision / do_not_do の根拠にもできず、明示 import 時のみ project policy 相当として扱う。

origin を判定できない取り込み（未対応 Parser など）は `origin=unknown` とし、安全側で independent evidence 不可・evidence 資格なしとして扱う。

#### 1.3.3 SecretScanResult

event-level Secret Scan の決定的結果。index build / remote_ai / redacted_export はこれを必ず参照する。

```json
{
  "secret_scan_id": "scan_01J...",
  "event_id": "evt_01J...",
  "secret_scan_status": "not_run | passed | failed | error",
  "secret_scan_passed": false,
  "secret_detected": false,
  "secret_scan_version": "secretscan.v1",
  "redaction_ref": "encrypted:optional",
  "created_by_derivation_id": "der_01J... | null",
  "created_at_ref": "encrypted:...",
  "schema_version": "secretscanresult.v1"
}
```

フィールドの意味と validator 規則:

- Secret Scan は決定的に走り、index build より前に完了する（§5.4 / §6.4 / §7.1）。
- Scan の secret 判定は AI candidate の sensitivity を上書きして secret を強制する。
- scan 失敗 / 判定不能 → `secret_scan_status = failed / error`、`secret_scan_passed = false`。当該 event は出力不可（Silence）として扱い、index しない。
- index build / remote_ai / redacted_export は `secret_scan_passed = true` を必ず参照する。

### 1.4 Assignment / Label

ScopeLabel を、割当（Assignment）と語彙（Label）に分ける。Assignment は「どの target にどの label が付くか」、Label は「label 語彙そのもの」を表す。

Assignment（割当）:

```json
{
  "assignment_id": "asg_01J...",
  "target_type": "event",
  "target_id": "evt_01J...",
  "label_ids": ["lbl_01J..."],
  "project_ids": ["proj_01J..."],
  "classification_state": "candidate | inferred | confirmed | conflicted | rejected",
  "assigned_by": "ai | rule:path_git_remote | user_rule | explicit_user",
  "confidence": 0.86,
  "evidence": ["occ_01J..."],
  "created_by_derivation_id": "der_01J... | null",
  "created_at_ref": "encrypted:...",
  "schema_version": "assignment.v1"
}
```

Label（語彙）:

```json
{
  "label_id": "lbl_01J...",
  "realm_id": "realm_01J...",
  "canonical_name_ref": "encrypted:...",
  "normalized_key": "hmac:...",
  "aliases_ref": "encrypted:[...]",
  "state": "active | merged | deprecated",
  "merged_into": "lbl_01J... | null",
  "merge_history_ref": "encrypted:[...]",
  "created_at_ref": "encrypted:...",
  "schema_version": "label.v1"
}
```

Validator 規則:

```text
AI が作れるのは candidate まで（Assignment.classification_state）。
confirmed はユーザー、明示 policy、ユーザー定義 rule だけ。
1 つの target が複数 label を持つことを許す（label_ids）。
未分類（classified(x)=false）/ rejected な target は index / Claim / ContextPack / export へ進めない。
Assignment.created_by_derivation_id は AI 由来割当では Derivation を指す。
normalized_key は realm_key を鍵にした HMAC で、語彙の dedup / merge 判定に使い、平文の label を晒さない。
merge は Label を統合し（merge_history を残す）、関係する Assignment の label_ids を付け替え、evidence を union する。AI は merge 候補を出すだけで確定しない。
label は Realm 内の soft な属性であり、暗号境界へ昇格しない。分離が要る境界は Realm を分ける。
```

### 1.5 Claim

事実から汲み上げた、versioned で根拠付きの可変な主張。

```json
{
  "claim_id": "clm_01J...",
  "kind": "decision",
  "statement_ref": "encrypted:...",
  "structured_predicate_ref": "encrypted:optional",
  "assignment_ids": ["asg_..."],
  "project_ids": ["proj_..."],
  "abstraction_level": 4,
  "status": "candidate | consolidated | conflicted | superseded | rejected | redacted",
  "evidence_event_identities": ["eid:hmac:..."],
  "evidence_occurrence_ids": ["occ_..."],
  "created_by": "ai | rule | user | validator",
  "created_by_derivation_id": "der_01J... | null",
  "created_at_ref": "encrypted:...",
  "last_recalled_at_ref": "encrypted:null_or_time",
  "valid_from_ref": "encrypted:...",
  "valid_until_ref": "encrypted:optional",
  "supersedes": ["clm_..."],
  "evidence_count": 2,
  "reinforcement_score": 0.7,
  "confidence": 0.95,
  "sensitivity": "confidential",
  "sensitivity_classification_state": "inferred",
  "schema_version": "claim.v1"
}
```

フィールドの意味と validator 規則:

- `kind`（Claim Form）は preference / constraint / decision / fact / project_context / procedure。kind 別の origin 要件は §3.3.1 を参照。
- `evidence_event_identities` は `event_identity`（HMAC）を指し、`undiluted_id` を指さない。
- `evidence_count` は独立 evidence 定義（§10.1）による independent evidence count を指す。`independent_evidence_count` はその別名であり、定義を乖離させない。同一発話の反復、同一 tool 出力の重複、context.md の再登場、context_injected session の assistant による言い換えは `evidence_count` を増やさない。
- `sensitivity` は evidence の最大機微度を継承し、それより低くするには非 AI の権威を要する（§6.3 / §4.7）。`sensitivity_classification_state` は §2.3 の状態空間を持つ。
- `abstraction_level` の尺度: 0=raw 由来の断片、2=session 要約、4=安定した好み・制約・方針、5=価値観レベルの抽象。`abstraction_level` は v0 では参考値であり、ranking の主軸にしない。
- `created_by_derivation_id` は AI 由来 Claim では Derivation を指し、`created_by=user / rule / validator` のときは null でよい。
- Claim は暗号化された自然文 statement と任意の structured predicate を持つ。同義 preference は auto-merge し evidence を union する。merge できない類似 Claim は黙って重複させず `status = conflicted` + `conflict_reason = duplicate_candidate` として扱う（新状態は作らない）。

### 1.6 ContextPack

呼ばれた時だけ生成される projection。既定では本文を保存せず、manifest（pack id、Recipe、policy、evidence id、active scope、生成時刻など）だけを残す。

```json
{
  "context_pack_id": "ctx_01J...",
  "purpose": "coding_agent_session_start",
  "realm_id": "realm_01J...",
  "audience": "ai_tool | remote_ai_processing | export | human_local_view",
  "aperture": "strict | standard | permissive | full_access",
  "active_label_ids": ["lbl_..."],
  "active_project_ids": ["proj_..."],
  "resolution_basis": "cli_scope | cli_project | cwd_project_match",
  "context_budget_recipe_id": "recipe_context_budget_v1",
  "token_budget": "from_context_budget_recipe",
  "generated_at_ref": "encrypted:...",
  "policy_applied": ["active_scope_only", "no_secret", "no_unknown",
                     "classified_only", "no_confidential",
                     "historical_context_quarantine",
                     "citations_required", "self_ingestion_marker"],
  "policy_digest": "hmac-sha256:...",
  "manifest_only": true,
  "body_ref": null,
  "self_ingestion_marker_digest": "hmac-sha256:...",
  "evidence_ids": ["clm_...", "evt_..."],
  "schema_version": "contextpack.v1"
}
```

フィールドの意味と validator 規則:

- 既定では本文を保存せず manifest のみ（`manifest_only: true`、`body_ref: null`）。AI 向け citation は opaque ID だけにする。
- `audience` と `aperture` はこの pack に適用された出力 Gate（§3.4）を記録し、既定は `ai_tool + standard` である。
- `policy_digest` は適用した policy.v2 の digest であり、後から「どの Gate で出したか」を監査できる。
- `self_ingestion_marker_digest` は context.md に埋める signed marker と一致し、再取り込み時の context_injected 判定に使う（§1.3）。

### 1.7 Chronicle

操作の追記専用ログ。下位層はここから決定的に再構築できる。

```json
{
  "chronicle_id": "chr_01J...",
  "sequence": 1024,
  "prev_chronicle_id": "chr_01J...",
  "op_type": "capture | normalize | scope_confirm | consolidate | redact | delete | seal | reindex",
  "target_ref": "und_01J... | evt_... | clm_...",
  "payload_digest": "hmac-sha256:...",
  "created_at_ref": "encrypted:...",
  "schema_version": "chronicle.v1"
}
```

append-only。index は Chronicle から決定的に再構築できる。`sequence` は Realm 内で単調増加する内部順序であり、source 申告の timestamp に依存しない順序判断（§4.16 の supersede）の一次情報になる。`prev_chronicle_id` は連鎖検証用で、順序は `sequence` が持つ（並行更新でも壊れない）。

### 1.8 Artifact

diff、stdout、stderr、attachments などの成果物。

```json
{
  "artifact_id": "art_01J...",
  "kind": "stdout | stderr | diff | attachment",
  "encrypted_ref": "objects/7f/ab/art_01J...",
  "content_fingerprint": "hmac-sha256:...",
  "filename_ref": "encrypted:optional",
  "mime_type": "text/plain",
  "size_bytes": 1024,
  "schema_version": "artifact.v1"
}
```

attachment filename は暗号化する。

### 1.9 サポート entity

```text
Policy { policy_id, version, rules[], precedence_rank, schema_version }
Source { source_id, source_stable_key_hmac, connector_id, connector_instance_id, source_type, schema_version }
Project { project_id, root_paths_ref, git_remotes_ref, schema_version }
ConnectorInstance { connector_instance_id, connector_id, config_ref, schema_version }
Tombstone { tombstone_id, deleted_ref, minimal_range_ref, created_at_ref, schema_version }
QuarantineRecord { quarantine_id, occurrence_id, undiluted_id, reason, parser_version, created_at_ref, schema_version }
```

`source_stable_key_hmac` は `hmac(realm_key, connector_id || source_stable_id || source_account_stable_key)`（= `source_identity`）であり、event_identity の安定座標の根拠になる（§1.3.1）。`connector_instance_id` は identity の根拠から外し、provenance / config 参照に降格する（再 connect / restore で値が変わりうるため）。

Session、Derivation、SealRule は support ではなく独立 entity として以下に定義する。

### 1.10 Session

source 上の 1 セッション（1 会話 / 1 実行）を表す provenance entity。event の session 系フィールドはここへ正規化する。

```json
{
  "session_id": "ses_01J...",
  "realm_id": "realm_01J...",
  "source_id": "src_01J...",
  "connector_instance_id": "ci_01J...",
  "host_tool": "claude_code | codex | manual | ...",
  "host_tool_version": "x.y.z",
  "format_version": "claude_code_jsonl.v3",
  "cwd_ref": "encrypted:optional",
  "project_ids": ["proj_01J..."],
  "git_remote_ref": "encrypted:optional",
  "source_account_ref": "encrypted:optional",
  "transcript_path_ref": "encrypted:optional",
  "started_at_ref": "encrypted:...",
  "ended_at_ref": "encrypted:optional",
  "context_injected": false,
  "context_pack_digest": "hmac-sha256:null_or_digest",
  "schema_version": "session.v1"
}
```

`context_injected` / `context_pack_digest` は session-level で持ち、その session に属する event は同値を継承する。`host_tool_version` / `format_version` は Connector の host-resilience contract（§3.2）が記録する検査対象であり、未対応 version では raw-only fallback に倒す。git_remote / cwd / transcript path は暗号化 ref で保持し、平文では晒さない。

### 1.11 Derivation

AI / Recipe による派生の来歴。AI 由来 record はこれを `created_by_derivation_id` で指す。

```json
{
  "derivation_id": "der_01J...",
  "realm_id": "realm_01J...",
  "derivation_type": "scope_classify | sensitivity_classify | consolidate | abstract | label_suggest | backfill_candidate | shadow_trial",
  "input_event_identities": ["eid:hmac:..."],
  "input_claim_ids": ["clm_..."],
  "model_provider": "local | <provider>",
  "model_name": "...",
  "model_version": "...",
  "temperature": 0.2,
  "prompt_version": "consolidate_prompt.v3",
  "recipe_id": "recipe_consolidation_v1",
  "validator_version": "validator.v2",
  "policy_digest": "hmac-sha256:...",
  "output_digest": "hmac-sha256:...",
  "created_at_ref": "encrypted:...",
  "schema_version": "derivation.v1"
}
```

Derivation は監査と再現のための来歴であり、それ自体は evidence ではない。同じ入力に対する出力差は eval で比較し、Core schema は変えない。Recipe 変更時の既定は no auto-retroactive で、既存 record への適用は明示 reprocess による（§9.4 / 第10章）。legacy record は `derivation_id=legacy` の placeholder Derivation に紐づける。

### 1.11.1 Reflection Lane / BackfillCandidate / 診断 report

Reflection Lane は Derivation-only のレーンである。過去の Event / Claim を分析してよいが、その出力は生成された分析 metadata であり、Claim truth でも evidence でもない。Reflection output は `Claim.evidence_event_identities` に入れてはならず、independent evidence count を増やしてはならず、Claim を直接 consolidate してはならない。

BackfillCandidate は historical logs から作られる grounded candidate record である。backfill 経路では abstraction output はまず BackfillCandidate にならなければならず、通常の Claim `candidate` は BackfillCandidate が grounded-only promotion barrier を通過した後にだけ作る。各 BackfillCandidate は `source_event_identities`、accepted evidence refs、rejected evidence refs と rejection reason、risk flags（`stale / cross_scope / weak_origin / conflict / sensitivity_unknown / self_generated`）、`created_by_derivation_id`、validator threshold に必要な authority / confidence、`candidate / quarantined / rejected / promoted` の status を持つ。valid な Event identity または accepted evidence reference を持たない BackfillCandidate は quarantine または reject する。BackfillCandidate からの promotion は通常の Claim `candidate` を作るだけであり、consolidate するかは既存 validator が判定する。

ReflectionReport は `candidate_id`、surfaced reason、accepted evidence refs、rejected evidence refs と rejection reason、risk flags、suggested action（`keep_candidate / defer / reject`）を出す。EvalReport は baseline と candidate-augmented context / output を比較し、verdict `helpful / neutral / harmful`、reason、risk flags、evidence refs を持つ。ReflectionReport と EvalReport は health などの local diagnostics から、id / count / action / risk / verdict に限定して確認できる。candidate statement text はそこで表示しない。ReflectionReport と EvalReport は診断 artifact であり、evidence ではなく、sensitivity / scope の confirmed、Declassify、Claim の直接 promotion / consolidation を行わない。

### 1.12 SealRule

Seal の durable 抑止を表す。delete / redact 済みの内容が reprocess / 再 capture で復活しないようにする。

```json
{
  "suppression_id": "seal_01J...",
  "realm_id": "realm_01J...",
  "match_type": "event_identity | content_signature | pattern",
  "target_signature_ref": "encrypted:...",
  "scope": "Realm | label | project",
  "scope_ref": "lbl_... | proj_... | null",
  "reason_ref": "encrypted:optional",
  "created_by": "user",
  "active": true,
  "created_at_ref": "encrypted:...",
  "schema_version": "sealrule.v1"
}
```

active な SealRule に一致する candidate は Claim / index / ContextPack / export へ進めない（§4.15）。`created_by` は user に限り、解除も user の明示操作に限る（AI / policy は作成も解除もしない）。`target_signature` は `realm_key` を鍵にした HMAC で保持し、抑止対象の内容を平文で晒さない。

---

## 2. 状態遷移

### 2.1 分類状態（scope classification_state, §7.2）

scope の分類状態（Assignment.classification_state）は次の 5 状態を持つ。`unclassified` は状態値ではなく「対象に有効な Assignment が無い（未割当）」という scope 軸の概念であり、状態空間に含めない。

```text
candidate     AI または弱い rule が候補を出した。
inferred      path / project / Connector / git remote / account など強い決定的 signal で推定。
confirmed     ユーザー、または明示 policy / ユーザー定義 rule で確定。
conflicted    複数分類が衝突。
rejected      候補が否定された。
```

遷移条件:

```text
（Assignment 不在）→ candidate     AI / 弱い rule が候補を出す
（Assignment 不在）→ inferred      path / project / Connector / git remote / account の決定的 signal
candidate    → inferred      決定的 signal が後から付く
candidate    → confirmed     ユーザー / 明示 policy / ユーザー定義 rule（AI 不可）
candidate    → rejected      候補が否定される
inferred     → confirmed     ユーザー / 明示 policy / ユーザー定義 rule
任意          → conflicted    複数分類が衝突
任意          → rejected      ユーザー / policy が否定
```

確定権限の境界: AI による分類は candidate までである。confirmed にできるのは、ユーザー、明示 policy、ユーザー定義の決定的 rule だけである。

`classified(x)` = 対象に classification_state ∈ {candidate, inferred, confirmed, conflicted} の Assignment が存在すること。Assignment 不在、または rejected のみのとき `classified(x)=false`（= 未分類）であり、Gate の classified 条件で sensitivity 判定の前段に落ちる。candidate scope を出力に出してよいかは Aperture が `allowed_scope_state` で決める（§3.4）。strict は inferred / confirmed のみ、standard は candidate を active scope に限り許す。

### 2.2 Claim State（§8.4）

Claim の状態は次の 6 状態に統一する。reinforcement は状態ではなく、状態遷移を駆動する信号である。

```text
candidate     長期記憶の候補。
consolidated  長期 Claim として定着。ContextPack で利用可（Gate を通る場合のみ）。
conflicted    反証や矛盾がある。
superseded    新しい Claim に置き換えられた、または期限切れで active recall から外れた。
rejected      ユーザーまたは policy が否定。
redacted      安全・削除要求により使わない。
```

遷移条件:

```text
candidate    → consolidated  auto_consolidate(m) が真（§3.3 / §4.7）
candidate    → rejected      schema / evidence validation を通らない、または user / policy が否定
candidate    → conflicted    反証・矛盾がある
consolidated → conflicted    後発の反証・矛盾
consolidated → superseded    新しい Claim が置き換える、または valid_until 到来で active recall から外れる
任意          → redacted      安全・削除要求（delete / redact cascade、Seal）
任意          → rejected      ユーザー / policy が否定
```

Claim は `valid_from`、任意の `valid_until`、任意の `supersedes` を持つ。「以前の方針は忘れて」と言われたら、旧 Claim は superseded になり active recall から外れる。supersede の順序判断は source timestamp ではなく capture 順 / `Chronicle.sequence` / 明示の `valid_from` で決める（§4.16）。

`duplicate_candidate` は新状態ではない。merge できない重複候補は `status = conflicted` + `conflict_reason = duplicate_candidate` で表す（§1.5）。

### 2.3 sensitivity classification_state（§15.2）

sensitivity も scope と同じ判定状態を持つ。

```text
candidate   AI または弱い rule が候補を出した。
inferred    path / Connector / account / policy / Declassify signal で推定。
confirmed   ユーザー、明示 policy、ユーザー定義 rule で確定。
conflicted  複数判定が衝突。
rejected    候補が否定された。
```

AI が作れるのは candidate までである。confirmed にできるのはユーザー、明示 policy、ユーザー定義 rule だけである。

機微度の値（public / internal / confidential / secret / unknown）と判定状態（candidate / inferred / confirmed / conflicted / rejected）は直交する。Declassify（機微度を下げる緩和）の非対称性は §6.3 と §4.3 が定める。remote_ai / redacted_export / dataset_export は値だけでなく判定状態も見る（§6.4 / §7.2）。

---

## 3. 各コンポーネントの責務と処理単位

### 3.1 Connector interface（§10.2）

Connector は AI ツールのローカル蓄積を見つけて口を開く部品である。

```ts
interface Connector {
  id: string;
  displayName: string;
  sourceType: 'append' | 'snapshot' | 'event' | 'artifact';

  detect(): Promise<DetectionResult>;          // Inventory を返す（再実行可能）
  configure(input: ConnectorConfig): Promise<ConnectorInstance>;  // include/exclude と Realm 割当
  Backfill(options: BackfillOptions): AsyncIterable<OccurrenceInput>;
  watch(options: WatchOptions): AsyncIterable<OccurrenceInput>;
  parse(raw: Undiluted, occurrence: Occurrence): Promise<ParseResult>;
  health(): Promise<ConnectorHealth>;
}
```

`detect` は宿主ツールを 1 つの塊として返さない。発見した source を Inventory として列挙する。

```text
DetectionResult.sources[]:
  source_stable_id
  project root / git remote / account / account profile
  transcript path / last modified
  estimated sensitivity hint
  suggested Realm
  host_tool / host_tool_version / format_version
```

`configure` は Inventory に対する include / exclude と、各 source の Realm 割当を受け取る。ConnectorInstance の粒度は宿主ツール全体ではなく、選択された source 集合である。`watch` は選択済み source だけを対象にする。tool 全体 watch を既定にしない。Claude Code / Codex の履歴には仕事・個人・OSS・顧客案件・別 identity が混ざりうるため、初期導線で全部を 1 Realm に混ぜない。

### 3.2 Parser requirements（§10.3）

Parser は外の汚い世界と Memoring の固定 schema を分ける境界である。local transcript format は安定 API とは見なさず、best-effort unstable Parser として扱う。

```text
Parser id / version / host tool version / format hint
source fingerprint / schema version
fixture set / golden output
unknown field passthrough
parse failure Quarantine
raw-only fallback
```

正規化できない raw は raw-only として保持し、後で Parser を更新して再処理する。unknown field は encrypted blob（`source_extra_ref`）に保存し、known field へ昇格するまで index / ContextPack から除外する。unknown field 内の secret も event-level Secret Scan の対象である。

host 変化への耐性（固定する Connector contract）:

```text
host transcript format は stable API と見なさない。
Connector は tested host version / format version / Parser version を記録する。
detect / doctor は host version と Parser compatibility を検査する。
未知 format / unsupported version では壊れた parse をせず raw-only fallback に倒す。
取得・parse できない場合でも raw を失わない。
folder path / file layout に強く依存しすぎない。source_stable_id を主キーにする。
golden fixtures を持ち、host update ごとに Connector を検証する。
Connector は Inventory を再検出できる（detect は再実行可能）。
```

宿主（Claude Code / Codex）のアップデートで内部フォルダ構造や保存形式が変わっても、Memoring 全体は壊れず、最低でも raw-only capture / Quarantine / doctor warning に落ちる。

### 3.3 consolidation パイプライン（§8.6）

Memoring は review queue を作らない。Claim は自律的に溜まるものとして扱う。candidate は validation 連鎖を通る。

```text
AI / rule が candidate を作る
  → schema validation
  → evidence validation（origin authority を含む、§3.3.1）
  → sensitivity / scope validation
  → policy validation
  → lifecycle / conflict validation
  → suppression check（Seal 済みは復活させない）
  → consolidated または conflicted / rejected
```

Quarantine は Claim の状態ではなく parse / event の状態である（§5）。schema / evidence validation を通らない candidate は rejected になり Claim にならない。

低リスクも高リスクも、validator を通れば自動 consolidate される。安全は consolidated を止めることではなく、出力時の Gate で守る。ユーザーが 1 件ずつ承認する設計にはしない。

auto-consolidate の正確な predicate は §4.7 に示す。

#### 3.3.1 Evidence rule と origin 権威（§8.5）

長期 Claim は必ず evidence を持つ。evidence は Event であり、その origin（§1.3.2）が権威を決める。assistant 発言や host 生成物は「そう言われた / そう生成された」という観測であって、「それが真である」根拠にはしない。

origin と権威:

```text
user             明示発話・訂正・決定・pin。最も強い権威。
tool / command   tool result / command result / file diff。外部性のある観測として強い。
external         取り込んだ外部 artifact（ファイル等）。
assistant        assistant 発言。観測であり、independent evidence にしない。
host_summary     host が生成した要約。derived。independent evidence 不可・evidence 資格なし。
host_memory      host が生成した memory（auto memory 等）。derived。independent evidence 不可・evidence 資格なし。
system           宿主の system / 設定 / CLAUDE.md 的注入。independent evidence 不可・evidence 資格なし。constraint / decision / do_not_do の根拠不可。明示 import 時のみ project policy 相当。
unknown          判定不能。安全側で independent evidence 不可・evidence 資格なし扱い。
```

kind 別に許す origin:

```text
constraint / do_not_do   user origin（明示発話 / rule / policy）を要する。assistant 単独不可。
decision                 user origin を要する。assistant 単独不可。
preference               user origin 1 件で可。assistant は補助のみ（単独不可）。
fact / project_context   tool / file diff / command result / user origin が強い。assistant は補助のみ。
procedure                繰り返す成功 tool trace で可。assistant summary 単独不可。
```

禁止:

```text
AI 要約だけを根拠にすること
過去の AI 生成 Claim だけを根拠にすること
Memoring が生成した ContextPack / context.md を根拠にすること
origin ∈ {assistant, host_summary, host_memory, system, unknown} を independent evidence に数えること
context_injected session の assistant 由来 assertion を independent evidence に数えること
constraint / do_not_do / decision を assistant origin 単独で consolidate すること
evidence のない Claim を ContextPack 上位に入れること
```

明示された preference / constraint / decision は evidence 1 件で記憶できる。AI が推論しただけの pattern は独立 evidence を複数要求する（初期値は第10章）。

### 3.4 Gate predicate（§12.1）

Gate predicate の正本は本節である。出力 Gate は出力に入ってよいかを判定する唯一の安全門である。item `x` が request `r` の ContextPack に入る条件は次の通り。`r` は Audience（誰が読むか）と Aperture（どこまで出すか）を持つ。

```text
gate(x, r)
= captured(x)
∧ not_deleted(x)
∧ not_redacted(x)
∧ not_suppressed(x)                    # Seal は再処理でも復活しない（§4.15）
∧ classified(x)                        # classified(x)=false（未分類）/ rejected は出さない。sensitivity 判定の前段
∧ active_scope_match(scope(x), r.active_scopes)
∧ allowed_scope_state(scope_state(x), r.audience, r.aperture)
∧ allowed_sensitivity(sensitivity(x), r.audience, r.aperture)
∧ allowed_sensitivity_state(sensitivity(x), r.audience, r.aperture)
∧ not_conflicted_for_request(x, r)
∧ cross_scope_allowed(x, r)
∧ has_required_provenance(x)
∧ not_self_generated_context_as_evidence(x)   # origin gate（§4.12）
```

出力 Gate は Audience と Aperture の 2 軸だけで決まる。これが唯一の安全機構である。local file であることは安全の根拠にしない。

Audience と Aperture の定義:

```text
Audience:     ai_tool（既定）/ remote_ai_processing / export / human_local_view
Aperture:  strict / standard（既定）/ permissive / full_access
```

`classified(x)`: 対象に classification_state ∈ {candidate, inferred, confirmed, conflicted} の Assignment が存在すること。Assignment 不在、または rejected のみ → `classified(x)=false`（= 未分類）（§2.1）。

`allowed_scope_state`（candidate scope を出してよいか）:

```text
strict:        scope_state ∈ {inferred, confirmed}
standard:      scope_state ∈ {candidate, inferred, confirmed}（candidate は active scope に限る）
permissive:    standard と同じ
full_access:   全て（human_local_view Audience のみ）
```

`allowed_sensitivity`（どの class を出してよいか。詳細は §7.2 の単一表が真）:

```text
hard floor（どの Audience / Aperture でも不可）: secret(raw) / unknown（未分類は classified(x) 条件で前段に落ちる）
strict:        public / internal のみ
standard:      public / internal（confidential は落とす）
permissive:    public / internal、confidential は one-shot 確認時のみ
full_access:   全て（human_local_view Audience のみ。secret は redacted のみ）
```

`allowed_sensitivity_state`（判定状態の要求）:

```text
Audience = ai_tool / human_local_view:
  standard / permissive: state ∈ {candidate, inferred, confirmed}
                         （candidate の internal / public は active scope に限る）
  strict:                state ∈ {inferred, confirmed}

Audience = remote_ai_processing / export:
  state ∈ {inferred, confirmed}（candidate のままは外部に出さない）
```

このため secret / unknown / 未分類（classified(x)=false）/ scope 外 / provenance なし / self-generated context / suppressed は、どれか 1 条件が false になり ContextPack に入らない。remote_ai_processing と export では、さらに candidate のままの判定が落ちる。

設計判断: 既定の `ai_tool + standard` が active scope の candidate internal / public を出せるのは、これがユーザー自身が起動した自分の AI ツールへの引き渡しだからである。これは Memoring が分類・抽象化のために自律的に外部 provider を呼ぶ remote_ai_processing とは purpose が異なる（§6.4）。後者は default deny で candidate のままの sensitivity を外部に出さない。Audience を取り違えて緩い側へ倒すことは禁止する。

`gate(x, r)` の述語のうち次の 3 種を定義する。

```text
not_conflicted_for_request(x, r):
  conflicted な Claim は context の「Open conflicts」節にのみ出し、通常 recall からは Gate で落とす。
cross_scope_allowed(x, r):
  Crossing（active scope 外の scope を跨いで出すこと）の許可。v0 は既定 deny。policy が明示許可した場合のみ許す。
has_required_provenance(x):
  項目型ごとに要求 provenance を満たすこと。
    Claim: kind 別の origin 要件（§3.3.1）を満たす evidence を持つ。
    Assignment / sensitivity: classification_state を持ち、外部 purpose では state ∈ {inferred, confirmed}。
    Event: origin（§1.3.2）を持つ。
```

#### active scope の解決規則（正本）

`r.active_scopes` は次の手順で決定する。active scope の解決の正本は本節である（CLI は仕様書 §1.1）。

```text
1. CLI 明示（--scope / --label / --project）があればそれを active scope とする。
2. 無ければ CWD を canonicalize し、Project.root_paths / git_remotes と照合して active_project を決める。
3. active_project に属し classification_state ∈ {confirmed, inferred} の Label を active scope とする。
4. active_project が複数該当 or ゼロのときは Silence（context.md を出さない。--scope / --project を促す）。
5. standard Aperture で candidate scope を出す場合も active scope に限る。
```

CLI: `context build` に `--scope` / `--project` を追加する。ContextPack manifest に `active_label_ids` / `active_project_ids` と `resolution_basis`（解決根拠）を残す。解決不能時は Silence とする（FR 化済み）。

### 3.5 Gate First / Ratchet（§12.2 / §12.3）

#### Gate First（Ranking は Gate の後）

```text
rankable(x, r) ⇒ gate(x, r)
¬gate(x, r) ⇒ score(x, r) is undefined
```

安全機構は Gate である。ranking penalty は品質調整であり、安全機構ではない。secret / unknown / confidential / scope 外は ranking へ到達しない。Gate は ranking より前に来る、という不可逆の順序を保つ。

#### Ratchet

安全判定は単調に厳しくなる。自動では厳しくする方向にしか動かない。

```text
unknown → classified に変わるまで gate=false
classified(x)=false（未分類）→ confirmed / inferred の Assignment が付くまで output high-risk 扱い
secret → redacted されない限り output=false
Declassify（機微度を下げる緩和）は AI candidate だけでは確定しない
```

AI の confidence と tunable Recipe は safety を緩めない。policy と validator だけが緩和条件を持つ。Declassify（機微度を下げる緩和）の閉じた列挙は §6.3 に示す。

### 3.6 ranking（§13.3、Gate の後）

ranking は Gate を通った item にのみ適用する品質調整である。ranking 係数・floor は Recipe が所有する tunable であり、第10章に示す。安全 floor は安全側にしか変更できない。score 式と floor / ceiling の初期値は §10.3 を参照。

Ranking metadata は `recall_count`、`distinct_query_count`、`distinct_day_count`、`correction_count`、`conflict_count`、`stale_signal` を持ってよい。これらの signal は `gate(x, r)` が true になった後の ordering にだけ影響する。`¬gate(x, r)` のとき、その item はその request で ranking score も rankable metadata も持たない。helpful な EvalReport や ReflectionReport は、この Gate-after-ranking 経路を通じて review priority または ranking metadata にだけ影響してよい。evidence、confirmed、Declassify、consolidation は作らない。

---

## 4. 構造不変条件（§12 全量）

固定するのは数値ではなく、破ってはいけない形、境界、順序、predicate、許可条件である。次は validator / gate / policy が必ず守る契約である。

```text
Invariant: 設計時に固定する形。validator / gate / policy が必ず守る。
Tunable:   versioned Recipe が所有する初期値（第10章）。
禁止される第3カテゴリ: 固定に見えて実際は人が頻繁に手で触る数値。これを作らない。
```

### 4.1 §12.1 Gate predicate

§3.4 に全量を示した。`gate(x, r)` の全条件、Audience / Aperture 定義、`allowed_scope_state` / `allowed_sensitivity` / `allowed_sensitivity_state` は invariant である。

### 4.2 §12.2 Gate First

```text
rankable(x, r) ⇒ gate(x, r)
¬gate(x, r) ⇒ score(x, r) is undefined
```

### 4.3 §12.3 Ratchet と Declassify

安全判定は単調に厳しくなる（§3.5）。Declassify（機微度を下げる緩和。例 unknown→internal/public、confidential→public、secret→下位。出力露出が増える方向）を確定できる signal は、次の閉じた列挙に限る。これ以外は緩和の根拠にしない。

```text
許可される Declassify signal:
  - ユーザーの explicit rule（このラベル / この source は public、等）
  - project の explicit policy（policy.v2 に明記された宣言）
  - ユーザーが確認した correction（candidate を confirmed-safe に上げる明示操作）
  - immutable URL を伴う verified public source からの import
  - detector pattern 固有の deterministic な false-positive rule（特定パターンに限定）
```

```text
Declassify の根拠にしてはいけないもの:
  - AI の confidence / probability
  - semantic similarity / embedding 近接
  - filename だけ / path に "public" を含む
  - git remote が public というだけ
  - 出現頻度 / 再出現
```

unknown / 未分類（classified(x)=false）を remote_ai_processing 送信のために Declassify することは禁止する。unknown は classified になるまで外部に出ない。緩和は常に明示的で監査可能な signal を要し、AI 単独では起こらない。Escalate（機微度を上げる厳格化。例 internal→confidential、public→secret、unknown 維持。出力露出が減る Silence 側）は AI candidate でも許す。

### 4.4 §12.4 Safety floor

safety penalty の係数には下限を固定する。具体値は Recipe に置くが、安全側にしか変更できない。

```text
weight(sensitivity_penalty) ≥ floor_sensitivity > 0
weight(cross_scope_penalty) ≥ floor_cross_scope > 0
weight(conflict_penalty)    ≥ floor_conflict    > 0
raw_excerpt_share ≤ raw_excerpt_share_ceiling
```

### 4.5 §12.5 Search / encryption invariant

```text
read(Index) requires unlocked Realm
at_rest(Index) = Encrypt(index_payload)
global_plaintext_index = forbidden
persistent_plaintext_fts_file = forbidden
remote_index_build_without_opt_in = forbidden
sqlite_aux_files = encrypted_or_disabled
plaintext_payload_in_logs = forbidden
```

index に含まれる token、n-gram、embedding、term frequency、snippet cache はすべて内容の派生情報であり、暗号化対象である。

SQLite を使う場合、payload の派生物が漏れる経路をすべて閉じる。WAL / rollback journal / temp store / FTS shadow table / vacuum 中間ファイル / backup file は、暗号化されるか無効化される。temp store は memory / tmpfs に置き、平文の中間ファイルをディスクに残さない。ログには content payload を出さず、id / 件数 / 状態のみを記録する。

### 4.6 §12.6 日本語 / CJK search invariant

```text
search_text(q) = metadata_filter(q) ∪ exact(q) ∪ fts(q) ∪ trigram_or_ngram(q) ∪ session_reconstruction(q)
```

n は固定しない。fallback の存在だけを invariant とする。n の値は実装選択である。

### 4.7 §12.7 Claim consolidation invariant

```text
auto_consolidate(m)
= status(m) = candidate
∧ evidence_sufficient(m, kind(m), origin(m))
∧ confidence(m) ≥ τ_conf(...)        # τ_conf は Recipe（第10章）
∧ conflict_count(m) = 0
∧ user_rejected(m) = false
∧ policy_allows_store(m)
∧ schema_valid(m)
∧ provenance_valid(m)
∧ not_self_generated_context_as_evidence(m)
```

high-risk であることは auto-consolidate を禁止しない。high-risk は store ではなく exposure を制限する。

```text
high_risk(m) ⇒ exposure_restricted(m) = true
high_risk(m) ⇒ remote_ai_gate(m) = false unless explicit_user_approval
high_risk(m) ⇒ cross_scope_gate(m) = false unless policy_allows
```

Claim の sensitivity は evidence の最大機微度を下回らない（機微度順序: public < internal < confidential < secret、unknown は Silence）。

```text
sensitivity(m) は max_sensitivity(evidence(m)) 以上の機微度を持つ。
sensitivity(m) を max_sensitivity(evidence(m)) より低くするには
  §4.3 が列挙する Declassify signal のいずれかを要する。
AI candidate だけでは evidence の最大機微度を下回れない。
```

機微度を下げる根拠は §4.3 の閉じた列挙に限り、AI の confidence や semantic similarity を根拠にしない。

### 4.8 §12.8 Reinforcement invariant

reinforcement は bounded scalar。Recipe（第10章）が信号・重み・減衰を所有するが、次は invariant である。

```text
0 ≤ reinforcement_score(m) ≤ 1
valid_recall_count の増加契機は外部観測としての再確認のみ。context.md への掲載自体は数えない。
correction_count 増加 ⇒ その correction だけで reinforcement_score は上がらない
conflict_count 増加 ⇒ その conflict だけで reinforcement_score は上がらない
user_rejected(m) = true ⇒ auto_consolidate(m) = false
self_generated_context_reappears(m) ⇒ valid_recall_count は増えない
self_generated_context_reappears(m) ⇒ independent_evidence_count は増えない
context_injected(session) ∧ assistant_originated(x) ⇒ valid_recall_count は増えない
context_injected(session) ∧ assistant_originated(x) ⇒ independent_evidence_count は増えない
```

### 4.9 §12.9 Context budget invariant

```text
ContextPack は budget を持つ
ContextPack は budget を超えない
raw_excerpt には明示的な cap が存在する
raw_excerpt は最後の手段で、citations / fence / safety header を必ず持つ
safety header / constraints / scope boundary は raw excerpt に押し出されない
```

### 4.10 §12.10 Stable event identity invariant

§1.3.1 に全量を示した。`event_identity` の安定座標による HMAC 導出（`source_identity` / `session_identity` 経由）、`undiluted_id` および `connector_instance_id` の identity 不参加、reprocess / 再 connect / restore での不変性、`source_logical_position` の Connector 別 contract は invariant である。`realm_key` が rotation 不変であること（§7.4）により、KEK rotation / DEK rekey をまたいでも `event_identity` は不変である。

### 4.11 §12.11 Event-level sensitivity invariant

```text
contains_secret_span(event) ⇒ sensitivity(event) = secret
secret(event) ⇒ index_text(event) = redacted_or_empty
secret(event) ⇒ context_output(event) = false
```

1 行だけ secret が混ざった tool output でも、event 全体を secret とする。recall 低下は許容し、実装単純性と安全側 Silence を優先する。

既知のコスト: コーディング用途では tool 出力に token / key が混じりやすく、安全側に倒すぶん有用な文脈も巻き添えで落ちる。v0 はこれを受容する。span 単位の伏字は将来 ADR の対象とし、v0 では実装しない。

### 4.12 §12.12 Ouroboros Law

```text
self_generated_context(x) ⇒ evidence_allowed(x) = false
self_generated_context(x) ⇒ reinforcement_recall_signal(x) = false
self_generated_context(x) ⇒ independent_evidence_signal(x) = false
manual_import_path includes .memoring/ ⇒ exclude
context_injected(session) ∧ assistant_originated(x) ⇒ independent_evidence_signal(x) = false
context_injected(session) ∧ assistant_originated(x) ⇒ reinforcement_recall_signal(x) = false
context_injected(session) ∧ external_observation(x) ⇒ evidence_allowed(x) = true
```

`external_observation` = user message / tool result / command result / file diff / external artifact / explicit user correction / explicit user decision。assistant の言い換えは含まない。

### 4.13 §12.13 Loop convergence / idle invariant

ループは差分駆動であり、不変な Realm に対して有限ステップで idle に収束する。差分ゼロで回り続けることを許さない。

```text
fire(step) ⇒ new_observational_evidence ∨ user_trigger ∨ scheduled_maintenance_tick
AI / expensive step は new_observational_evidence のときだけ fire する。

converge:
  新 evidence の無い固定 Realm では、ループは有限ステップで
  新規 candidate を生成しなくなり、pending job が空になって idle へ入る。

idle:
  pending job なし ∧ new evidence なし のとき、ループは AI / 計算資源を消費しない。
  Watcher の待機を超える busy polling をしない。
```

収束は既存 invariant に支えられる。これらが無ければ、ループは自分の派生出力を入力として食い直し、新 evidence 無しに無限の candidate を生む。

```text
Derived を evidence にしない（§3.3.1）。
過去の AI 生成 Claim だけを根拠にしない（§3.3.1）。
自己生成 context を evidence / recall_count に数えない（§4.12）。
context_injected session の assistant 言い換えを independent evidence にしない（§4.12）。
```

evidence 以外で許される trigger は時間駆動の保守だけである。

```text
許容: valid_until 到来による expire、採用する場合の reinforcement 減衰。
制約: scheduled tick として有界に実行し、busy loop にしない。
      新 evidence 無しに無限の派生 job を生まない。
```

収束判定の具体や maintenance tick 間隔などの数値は本 invariant ではなく versioned Recipe が所有する（第10章）。

### 4.14 §12.14 Label space invariant

```text
label_merge_confirm は user / policy / rule を要する（AI candidate では確定しない）
label_alias_suggest = AI candidate のみ
merge(label_a, label_b) ⇒ evidence(result) = evidence(a) ∪ evidence(b)
predefined_root_category = forbidden
```

近接判定の閾値・正規化規則は Recipe が所有する（§10.5）。閾値は surfacing 範囲を決めるだけで Gate を緩めない。label は暗号境界へ昇格しない。

### 4.15 §12.15 Forget durability invariant

Seal は削除に加えて SealRule を生成し、同じ内容が reprocess / 再 capture で復活しないことを保証する。

```text
Seal(target) ⇒ delete/redact(target) ∧ create(SealRule)
SealRule は signature（pattern / target identity）で将来の candidate を抑止する。
reprocess(Parser) ∧ matches(x, active SealRule) ⇒ x は Claim / index / ContextPack へ進めない。
re-capture(同一 source) ∧ matches(x, active SealRule) ⇒ 同上。
suppression は raw を物理削除しない場合でも derived / output を抑止する。
SealRule の解除はユーザーの明示操作だけ（AI / policy は解除しない）。
```

suppression は §7.3 の cascade と組で動く。delete だけでは reprocess で同じ Claim が再生成されうるため、Seal は suppression を伴ってはじめて durable になる。backup / 既出力済み export への伝播は保証しない（§7.5 threat model）。

### 4.16 §12.16 Temporal ordering invariant

supersede（新しい assertion が古いものを置き換える）は source 申告の timestamp を安全判断の根拠にしない。

```text
supersede(new, old) は source timestamp の新旧だけでは確定しない。
source timestamp は timestamp_confidence 付きの参考値であり、改竄されうる。
未来日 / 不整合 / 単調でない timestamp は supersede の根拠にしない。
supersede は capture 順 / Chronicle.sequence（§1.7）/ 明示の valid_from と整合して決める。
機微度を下げる方向の supersede は §4.3 の Declassify signal を要する。
```

理由: 悪意ある transcript が未来日の発話を注入し、古く正しい制約を新しい誤情報で置き換える攻撃を防ぐ。時間順序は内容ではなく Memoring 側の観測順序（capture / sequence）を一次情報とする。

---

## 5. エラー処理

入口は何も判断せず、まず壊さず取り込む（Capture First）。エラーは安全側へ倒し、判定不能は Silence とする。

### 5.1 raw-only fallback

正規化できない raw は raw-only として保持し、後で Parser を更新して再処理する。raw capture が失敗したら派生処理へ進まない。取得・parse できない場合でも raw を失わない。

### 5.2 Quarantine

`Connector.parse`（§3.1）は `ParseResult` を返す。`ParseResult` は Event 群 または QuarantineRecord（§1.9）である。parse 不能では Event を作らず QuarantineRecord に落とす（Occurrence / Undiluted を参照し、raw は失わない）。

```ts
type ParseResult =
  | { kind: 'events'; events: Event[] }
  | { kind: 'quarantine'; record: QuarantineRecord };
```

parse failure は Quarantine に落とす。Quarantine は Claim の状態ではなく parse / event の状態である。schema / evidence validation を通らない candidate は rejected になり Claim にならない。

### 5.3 parse 失敗 / 未知 format / unsupported host version（§10.3）

未知 format / unsupported version では壊れた parse をせず raw-only fallback に倒す。最低でも raw-only capture / Quarantine / doctor warning に落ちる。`detect` / `doctor` は host version と Parser compatibility を検査する。宿主のアップデートで内部フォルダ構造や保存形式が変わっても、Memoring 全体は壊れない。

unknown field は encrypted blob（`source_extra_ref`）に保存し、known field へ昇格するまで index / ContextPack から除外する。捨てない。

### 5.4 Secret Scan 失敗時 fail-closed（§15.6）

Secret Scan は Silence。判定不能・失敗時は `secret_scan_passed=false` とする。結果は SecretScanResult（§1.3.3）として記録し、決定的に走って index build より前に完了する。Scan の secret 判定は AI candidate の sensitivity を上書きして secret を強制する。

```text
Secret Scan は Silence。判定不能・失敗時は secret_scan_passed=false。
secret 検出時、raw は暗号化保持するが secret flag を立て、index には redacted 表現だけを使う。
secret / unknown / confidential は既定で ContextPack / MCP / export / remote AI へ出さない。
remote AI 送信は secret_scan_passed=true かつ scope opt-in を要する。
remote AI / export はさらに sensitivity ∈ {public, internal} かつ sensitivity_classification_state ∈ {inferred, confirmed} を要する。AI candidate の internal / public は外部露出に出せない。
index build は Secret Scan の後。scan 失敗時はその event を index しない。
既定は「疑わしきは送らない」。
```

### 5.5 判定不能は Silence

unknown / 未分類（classified(x)=false）/ scope 外 / provenance なしは、Gate のいずれかの条件が false になり ContextPack に入らない。Active Realm が定まらない context build は context.md を出さない（推測で混ぜない）。複数 Realm に該当、またはどこにも該当しないときは Silence とし、ユーザーに Realm を明示させる（`--realm <id>`）か、出力を出さない。

---

## 6. 権限と権威

権威は model ではなく schema、validator、policy、evidence に置く。AI は提案、Memoring は検証、ユーザーは事後統治する（Propose-Validate-Govern）。

### 6.1 policy precedence（§15.3）

policy precedence の正本は仕様書 §5 である。本節はそれと一致させる。

```text
hard safety rule
  > destructive delete / redact confirmation
  > user explicit decision
  > project policy
  > Connector config
  > path / workspace / git remote / account rule
  > AI candidate
  > default Silence
```

organization / team policy は v0 に存在しない。work は個人の業務文脈の label であり、中央管理は v0 非対象である。sensitivity の Declassify（機微度を下げる緩和）と confirmed 化に使える権威もこの precedence に従う。AI candidate は sensitivity を Declassify も confirmed 化もできない。

### 6.2 AI が確定できないもの（§9.2）

AI は候補を作るだけであり、次を確定する権限を持たない。

```text
scope（Assignment / Label）の confirmed 化
secret / confidential の外部送信許可
destructive redact / delete
Crossing の恒久許可
```

high-risk Claim は自動 consolidated になり得るが、AI が確定したわけではない。validator を通った assertion として保存され、Gate により scope 外 / remote AI / secret / confidential 出力から守られる。auto-consolidate は「AI が確定する」ではなく「AI candidate を Memoring validator が検証し、policy と evidence を満たしたものだけが consolidated になる」という意味である。

### 6.3 Declassify の閉じた列挙（§12.3）

Declassify（機微度を下げる緩和）は scope と同じ非対称性を課す。AI 単独では確定しない。確定できる signal は §4.3 の閉じた列挙に限り、「strong deterministic signal」のような曖昧な根拠は使わない。

```text
Declassify の例:    unknown → internal/public、confidential → public、secret → 下位
Declassify を確定できる根拠: §4.3 の Declassify signal（explicit user rule /
  explicit project policy / user-confirmed correction /
  immutable URL を伴う verified public source import /
  detector pattern 固有の deterministic false-positive rule）のみ。
Escalate（機微度を上げる厳格化）は Silence の向きで、AI candidate でも許す。
```

Claim の sensitivity は evidence の最大機微度を継承する（機微度順序 public < internal < confidential < secret、unknown は Silence）。

```text
Claim.sensitivity = max_sensitivity(evidence)
これより低くするには §4.3 の Declassify signal を要する。AI 単独では下げられない（§4.7）。
```

### 6.4 remote AI policy（§9.3）

remote AI（外部 provider）への送信は §7.2 の統一表に従う。

```text
secret        raw 送信は確認付きでも不可。redacted / masked / surrogate 化されたものだけ。
confidential  default deny。その場の one-shot 明示確認がある場合のみ可。
internal      default deny。scope opt-in + Audience policy + state ∈ {inferred, confirmed} を満たす場合のみ可。
public        state ∈ {inferred, confirmed} なら可。
```

remote AI は default OFF、scope opt-in、`secret_scan_passed=true`（SecretScanResult §1.3.3 を参照）、policy allows を要する。AI candidate のままの internal / public は remote AI に出さない。これは Memoring 自身が分類・抽象化のために remote AI を自律的に呼ぶ場合の policy であり、ユーザーが context.md を自分の AI ツールへ渡す場合の Audience × Aperture（§3.4）とは別 purpose である。`remote_ai` は egress purpose の値、`remote_ai_processing` は Audience の値であり、別概念として混用しない。

---

## 7. セキュリティ

### 7.1 暗号化 / index 安全（§12.5 / §11.2）

DB 全体（`memoring.db`）を at-rest 暗号化する。Undiluted は暗号化して保存し、平文 raw を disk に置かない。master key はユーザーの passphrase または OS secret から KDF で導出する。鍵そのものは DB に平文で置かない。Realm 内に per-domain の暗号境界（Key Domain）は持たない。Realm 内の境界は scope label による soft な属性であり、安全は出力 Gate で守る。

index の安全:

```text
平文 index を永続 disk に置かない。at-rest では暗号化する。
平文 index は process memory / tmpfs の一時値としてだけ扱う。
locked Realm / 未分類（classified(x)=false）/ scope 外は検索候補に入れない。
index は Chronicle / 下位層から決定的に再構築できる。
Secret Scan の後に index build する。
```

§4.5 の Search / encryption invariant（global plaintext index 禁止、SQLite aux files の暗号化または無効化、ログへの payload 出力禁止）を満たす。

### 7.2 sensitivity classes と egress 権限表（正本は仕様書 §7.3）

sensitivity（機微度、1 event に 1 つ）と scope（文脈）を混ぜない。egress 権限表の正本は仕様書 §7.3 であり、本節はそれを参照する。remote AI policy / Gate predicate / policy.v2 / Secret Scan はこの表から導出する。本節に再掲する値は仕様書 §7.3 と完全一致させる。

```text
Sensitivity:
  public        公開済み。active scope 内で利用可。
  internal      非公開だが低リスク。remote AI は条件付き。
  confidential  顧客・契約・法務・未公開。ContextPack 原則不可。
  secret        keys / tokens / passwords。raw 出力不可、redacted / surrogate のみ。
  unknown       未判定。Silence。

Scope:
  AI が割り当てる label（事前定義の固定カテゴリではない）。機微度と文脈は直交する。
  未分類（classified(x)=false、旧 unclassified）は sensitivity の値ではなく、Gate の classified
  条件で sensitivity 判定の前段に落ちる。全 purpose で context へ出ない（backup_export を除く）。
```

egress 権限表（sensitivity × purpose）。セル値の凡例: raw=raw 出力可 / surrogate=redacted・surrogate のみ（raw 不可）/ △=条件付き・明示確認 / deny=不可。context_pack は Aperture（既定 standard）で段階を持つ。正本は仕様書 §7.3。

```text
purpose →      context_pack   context_pack    context_pack    remote_ai       redacted_      dataset_        backup_
sensitivity↓   strict         standard(既定)  permissive      _processing     export         export          export
------------   ------------   -------------   -------------   -------------   ------------   -------------   --------
public         raw(inf/conf)  raw             raw             △raw(注1)        raw(inf/conf)  △raw(注5)        raw
internal       raw(inf/conf)  raw(注2)        raw             △raw(注1)        surrogate      △surrogate(注5)  raw
confidential   deny           deny            △raw(注6)        △surrogate(注6)  △surrogate(注6) deny            raw
secret         deny           deny            deny            surrogate(注3)   surrogate      deny            raw(注4)
unknown        deny           deny            deny            deny            deny           deny            raw(注4)
```

```text
注1: remote_ai の public / internal は sensitivity_state ∈ {inferred, confirmed} かつ
     scope opt-in かつ Audience policy 許可かつ secret_scan_passed=true を要する。candidate のままは不可。
注2: context_pack standard の internal / public は candidate も可（active scope に限る）。他 purpose は candidate を出さない。
注3: secret は raw を remote AI へ送らない（確認があっても不可）。
     送れるのは redacted / masked / surrogate 化されたものだけ（§6.4）。
注4: backup_export は同一ユーザーの全文 encrypted backup（same_user + client_side 暗号化）。
     secret / unknown も含む完全コピー。平文は鍵境界外へ出ない。redacted_export / dataset_export とは別 purpose。
注5: dataset_export は consent / lineage / third-party removal / user approval を要する。
注6: confidential の context_pack(permissive) / remote_ai / redacted_export は one-shot 明示確認 + secret_scan_passed を要する。
```

hard floor:

```text
未分類（classified(x)=false、旧 unclassified）は全 purpose で context へ出ない（Gate の classified 条件で
  sensitivity 判定の前に落ちる）。backup_export だけは全文コピーのため対象外。
secret / unknown の raw egress は backup_export を除き不可。unknown はいかなる派生 export でも不可。
全 external/derived purpose（remote_ai, redacted_export, dataset_export）は sensitivity_state ∈ {inferred, confirmed} を要する。
```

export は backup_export（全文・同一ユーザー・暗号化）と redacted_export / dataset_export（鍵境界外へ出うる派生物）を別 purpose として扱う。

redaction の再分類: redact は元 sensitivity を消さない。redacted / surrogate は別 derived item として生成し、それ自体に Secret Scan を再実行する。surrogate が secret を含まない（`secret_scan_passed=true`）ことを条件に、表の surrogate cell でのみ egress 可。floor 判定（raw 不可）は元 item の元 class に対して行う。

役割分担: `gate(x, r)` の Audience × Aperture は context_pack 経路の判定。remote_ai / export はこの表 + policy が purpose 次元込みで裁く。policy.v2（§5.3 相当、仕様書）はこの表からの導出物であり、手書きの権威ではない。

enforcement: remote_ai / redacted_export / dataset_export は値だけでなく判定状態も見る。`sensitivity ∈ {public, internal}` かつ `sensitivity_classification_state ∈ {inferred, confirmed}` を要し、AI candidate の internal / public は鍵境界外へ出さない。これは remote AI の他条件（default OFF、scope opt-in、secret_scan_passed、policy allows）に追加される。

### 7.3 redaction / deletion の cascade と Seal / SealRule（§15.5 / §12.15）

```text
default: encrypted raw を保持。

redact     derived / index / ContextPack / export から除外。
           範囲 redaction は redacted surrogate を作り、元 Undiluted を削除対象にする。
delete     object を削除対象にする。
tombstone  削除した事実と最小範囲だけ残す。
Seal     delete/redact に加えて SealRule（§1.12）を生成し、reprocess / 再 capture で復活させない。
```

delete / redact は派生物へ cascade する。下流を残したまま上流だけ消すと、消したはずの内容が index や Claim に残る。

```text
Undiluted delete
  → Occurrence は tombstone 化（最小範囲のみ残す）
  → Event は redacted（text_ref を除去、event_identity は traversal のため残す）
  → index から該当 token / n-gram / embedding / snippet を除去
  → Claim.evidence_event_identities から該当 event_identity を除去
  → Claim.evidence_occurrence_ids から該当 occurrence_id を除去
  → evidence 不足になった Claim は redacted または conflicted へ
  → ContextPack manifest の該当参照を tombstone 化
```

Seal は durable 抑止であり、上記 cascade に SealRule を加える。

```text
Seal(target)
  → 上記 delete/redact cascade
  → SealRule を生成（match_type = event_identity / content_signature / pattern）
  → 以後 reprocess / 再 capture で一致する candidate は Claim / index / ContextPack / export へ進めない
  → SealRule の解除はユーザーの明示操作だけ
```

伝播保証の限界: 既に書き出した backup / export / 外部 AI へ渡したコピーへは伝播を保証しない。Memoring 内部の derived / index / Claim / 将来の reprocess に対しては cascade と suppression で保証する。

### 7.4 鍵ライフサイクル envelope / KDF / rotation / recovery（§15.7）

```text
hierarchy   envelope 方式。Realm ごとに DEK（data key）を持ち、DEK は KEK（key-encryption key）で包む。
            KEK は passphrase または OS secret から KDF で導出する。鍵は DB に平文で置かない。
            DEK は at-rest 暗号化用で、KEK rotation / DEK rekey 可能（payload envelope を再暗号化する別系統）。
realm_key   identity / fingerprint 用の HMAC 鍵。Realm root secret（rotation 不変。recovery material から導出。
            失えば復号不能）から KDF で導出する。DEK / KEK とは別系統で、rotation 不変。Realm をまたいで共有しない。
            KEK rotation / DEK rekey は realm_key を変えないため、event_identity / content_fingerprint /
            normalized_key / SealRule.target_signature は rotation / reconnect / restore をまたいで不変
            （§1.3.1 / §4.10）。これにより Seal 済みが reprocess / 再 capture で復活しうる安全違反を閉じる。
kdf         KDF parameters（algorithm / memory / iterations / salt）は記録し、再導出を決定的にする。
unlock      Realm は明示 unlock またはセッション unlock で開く。timeout は tunable。
daemon      常駐 capture daemon の鍵保持モデル: 平文鍵は daemon プロセス memory 内だけに保持し、
            disk / ログ / IPC に平文で書かない。idle timeout 到来で平文鍵を破棄し locked へ戻る
            （以後の capture は raw-only にバッファし、derived 処理は次 unlock まで保留）。
            常駐は unlock 窓を広げるトレードオフがあり、これは out-of-scope のローカルマルウェア面を拡大する（§7.5）。
nonce       AEAD の nonce / IV は鍵ごとに一意。再利用しない（カウンタ or ランダムで衝突回避）。
rotation    KEK rotation / DEK rekey を可能にする。rotation は payload を平文化せず、envelope 再暗号化で行う。
            rotation は realm_key を変えない（payload envelope の再暗号化のみ）。
export      redacted_export / dataset_export は backup とは別鍵で封をする（export key separation）。
            backup_export は Realm の全文 encrypted コピーで、同一 key domain を保つ。
recovery    初回 setup で recovery material を生成する。Memoring は recovery 平文を保持しない。
            recovery material を失えば encrypted Realm / export は復号不能になる。
```

### 7.5 threat model（守る / 守らない）

```text
in-scope（v0 で守る）:
  紛失したディスク / 盗まれた端末       → DB 全体 at-rest 暗号化、aux file も暗号化 or 無効（§4.5）
  cloud / backup provider の運用者       → 平文を渡さない。受け皿は encrypted のみ
  誤った git commit（.memoring を巻き込む） → exclude + canonical path + symlink refuse + chmod 0600（§9.1）
  悪意ある transcript（注入）            → safety header の信頼分離、内容を指示として実行しない（仕様書 context.md / §9.1）
  timestamp 攻撃による supersede 汚染     → source timestamp を順序の根拠にしない（§4.16）
  host-memory laundering                 → origin で host_summary / host_memory を evidence から除外（§4.12 / §1.3.2）
  remote AI provider への過剰露出        → Audience × Aperture × purpose の egress 表（§7.2）、secret raw は不可（§6.4）
  既知平文の存在確認（confirmation）      → content_fingerprint / index 派生物を realm_key HMAC 化（§1.1）
  symlink / TOCTOU で context.md を奪う   → canonical path 検証、symlink 拒否、atomic write（§9.1）
  Seal したのに reprocess で復活        → SealRule で durable 抑止（§4.15 / §7.3）

partial（緩和するが完全には守らない）:
  Realm を取り違えて混ぜるユーザー操作  → Active Realm 解決と cross-Realm 禁止で被害を限定。誤操作自体は防げない
  改竄された / 悪意ある Connector         → raw-only fallback と doctor 検査で被害を限定。完全な保証はしない
  同一 OS 上の別 Unix ユーザー            → file permission（chmod 0600）に依存。OS の権限分離を超えては守らない

out-of-scope（v0 で守らない。設計で明示する）:
  unlock 中に同一ユーザー権限で動くローカルマルウェア
    → 平文鍵 / 復号済みデータにアクセスされうる。最小化（temp を memory/tmpfs、ログに payload を出さない）はするが防御目標にしない。
       常駐 capture daemon（§7.4 daemon）は unlock 窓を時間的に広げ、この面を拡大するトレードオフがある。idle timeout で窓を絞る。
  既に外部 AI / 既出力 export / 古い backup へ渡したコピーの撤回
    → Seal は内部 derived / 将来 reprocess には効くが、外部へ出たコピーの伝播は保証しない（§7.3）。
```

---

## 8. ログ

### 8.1 Chronicle append-only（§14.7）

Chronicle は操作の追記専用ログであり、index は Chronicle から決定的に再構築できる。schema は §1.7 を参照。`sequence` は Realm 内で単調増加する内部順序であり、supersede の順序判断の一次情報になる。`op_type` は capture / normalize / scope_confirm / consolidate / redact / delete / seal / reindex。ログには content payload を出さず、id / 件数 / 状態のみを記録する（§4.5）。

### 8.2 audit log 対象操作（§15.8）

必ず audit log を残す操作:

```text
Crossing / ContextPack generation / MCP request
remote AI enrichment / export
delete / redact
policy override / key recovery / Recipe change
```

review queue は存在しないため、high-risk memory review は audit 対象ではない。代わりに high-risk Claim の exposure / correction / Seal / delete を audit する。

---

## 9. テスト観点

### 9.1 v0 blocking gate（完了条件としての検証観点, §18.1）

13 blocking gate の正本は実装指示書 §7 である。本節はその検証観点としての再掲であり、内容を実装指示書 §7 と一致させる。次のすべてを満たすことを検証する。

```text
1. raw capture が失敗したら派生処理へ進まない（raw-only fallback がある）。
2. Parser 失敗 / 未知 format / unsupported host version でデータ損失せず raw-only fallback / Quarantine / doctor warning に落ちる（§3.2 / §5）。
3. secret / unknown / 未分類（classified(x)=false）/ confidential（standard）は context.md に出ない。
4. Active Realm / active scope / classified 済み以外は search / context に出ない（§3.4）。
5. 出力 Gate が Audience × Aperture で動く。既定は ai_tool + standard。secret はどの Aperture でも raw 出力不可（§3.4 / §7.2）。
6. context.md に safety header（current guidance と untrusted excerpt を区別）と Ouroboros marker が入る。
7. context.md のファイル安全（canonical path / .memoring symlink refuse / chmod 0600 / atomic write）を満たす。
8. origin ∈ {assistant, host_summary, host_memory, system, unknown} が independent evidence にならず、host-memory laundering ループが閉じる（§3.3.1 / §4.12）。
9. sensitivity の Declassify が §4.3 の閉じた列挙の権威以外で起きない（AI confidence / similarity / git remote 単独で緩和しない）。
10. delete / redact が下流へ cascade し、Seal が SealRule で reprocess 復活を防ぐ（§4.15 / §7.3）。
11. reprocess（Parser version / blob 粒度変更）後も event_identity が変わらず evidence が宙に浮かない（§1.3.1 / §4.10）。
12. connect が Inventory を出し、Realm 割当を選ばせる。tool 全体 watch を既定にしない（§3.1）。
13. .memoring/context.md が新しい AI session で実用的に読める。
```

### 9.2 補助 gate（v0 で守るが blocking を肥大させない, §18.2）

```text
unknown field を捨てず encrypted source_extra_ref に保存する。
平文 global index / 永続平文 FTS file が存在しない。
index 破損時に下位層から再構築できる。
Claim は evidence を持つ。Summary だけで consolidated にならない。
context.md / ContextPack を Claim の evidence にしない。
context_injected session の assistant 言い換えが independent evidence / reinforcement に数えられない。
sensitivity の Declassify（機微度を下げる緩和）が AI candidate だけでは起きない。
Claim の sensitivity が evidence の最大機微度を下回らない（下回るには非 AI の権威）。
remote AI / export が sensitivity の値だけでなく classification_state（inferred / confirmed）も確認する。
evidence_count が §10.1 の independent evidence count と一致する。
日本語検索が exact と n-gram fallback で成立する。
label 正規化が決定的で、label merge 確定が user / policy / rule に限られる。
reprocess 後も event_identity が変わらず evidence が宙に浮かない。
Recipe は version / eval / audit / rollback ref を持つ。手で頻繁に触る第3カテゴリの knob を作らない。
削除（delete / redact）が機能し、tombstone を残す。
```

### 9.3 fixture / golden output（§10.3）

Parser は fixture set / golden output を持ち、host update ごとに Connector を検証する。golden fixtures により、宿主形式の変化を検知し、未知 format では raw-only fallback に倒すことを確認する。

### 9.4 eval（§9.4）

AI 出力は model / provider / temperature / prompt_version / schema_version / validator_version / recipe_id を Derivation（§1.11）として記録する。同じ fixture への出力差を eval で比較し、Core schema は変えない。Recipe 変更時の既定は no auto-retroactive であり、既存 Claim への適用は明示 reprocess による。

---

## 10. Recipe 初期値（§13 全量）

reinforcement 式 / Recipe 値の正本は本章である。この章の値は不変条件ではない。manual versioned Recipe として管理する。v0 では自動 Quality Loop を実装しない。Recipe を変更しても第4章の invariant を破ってはならない。これらは「Recipe が所有する tunable」であり、invariant とは区別する。

```text
Recipe record must include:
  recipe_id / recipe_version / owner / default_value / evaluation_metric
  changed_by / changed_at / reason / rollback_ref
```

### 10.1 Consolidation thresholds

```text
τ_conf.default = 0.80
τ_conf.preference = 0.80
τ_conf.decision = 0.85
τ_conf.ai_inferred_pattern = 0.85

min_evidence_count.default = 2
min_evidence_count.explicit_user_statement = 1
min_evidence_count.user_pinned = 1
min_evidence_count.constraint = 1
min_evidence_count.explicit_decision = 1
min_evidence_count.ai_inferred_pattern = 2
```

`τ_conf` / `min_evidence_count` の鍵づけは `(kind, explicit/inferred)` から閾値鍵への決定的ルックアップで行う。

```text
threshold_key(kind, mode):   # mode = explicit | inferred
  (preference, explicit)              → preference / explicit_user_statement
  (constraint, explicit)              → default / constraint
  (decision,   explicit)              → decision / explicit_decision
  (fact | project_context, explicit)  → default / explicit_user_statement
  (procedure,  explicit)              → default / default
  (*, inferred)                       → ai_inferred_pattern / ai_inferred_pattern
  user_pinned は kind に依らず user_pinned 鍵（min_evidence_count = 1）。
  該当鍵が無い組は default（τ_conf.default / min_evidence_count.default）にフォールバックする。
```

「独立」の定義: 異なる session に属する、異なる source に由来する、またはユーザーが別の機会に明示した別々の発話・操作。同一発話の反復、同一 tool 出力の重複、context.md の再登場、context_injected session 内で assistant が言い換えただけの assertion は数えない。

`evidence_count` はこの independent evidence count を指す。`independent_evidence_count` は別名であり、定義を乖離させない。

### 10.2 Reinforcement Recipe

```text
R_next(m) = clamp01( α R_current + β saturate(valid_recall_count) + γ user_pin
                     + δ saturate(independent_evidence_count)
                     - ε correction_count - ζ conflict_count - λ age_decay )
saturate(n) = n / (n + k)

α=0.70 β=0.08 γ=0.20 δ=0.06 ε=0.15 ζ=0.25 λ=0.05 k=5
```

`valid_recall_count` の増加契機は「外部観測としての再確認」のみである。context.md への掲載自体は数えない。context.md 由来の自己再登場、および context_injected session の assistant による言い換えは `valid_recall_count` / `independent_evidence_count` に含めない（§4.8 / §4.12）。Ouroboros（§4.12）は recall だけでなく reinforcement 経路にも適用する。

### 10.3 Ranking Recipe

Gate の後にだけ使う。

```text
score(x, r) = clamp01(
    0.35 relevance + 0.20 active_scope_match + 0.15 evidence_quality
  + 0.10 memory_status_boost + 0.08 recency + 0.07 reinforcement_score
  - 0.20 sensitivity_penalty - 0.20 cross_scope_penalty
  - 0.10 redundancy_penalty - 0.10 staleness_penalty - 0.20 conflict_penalty )

floor_sensitivity = 0.10
floor_cross_scope = 0.10
floor_conflict    = 0.10
raw_excerpt_share_ceiling = 0.10
```

floor / ceiling は安全側にしか変更できない（§4.4 の Safety floor を満たす）。

### 10.4 Token budget Recipe

```text
coding-agent-session-start:  8k tokens
large-chat-session:         16k tokens
deep-research-context:      32k tokens

配分（初期）:
  Safety Header / scope boundary    10%
  Constraints / do_not_do           15%
  Project facts                     20%
  Consolidated memories             20%
  Recent decisions / active tasks   20%
  Evidence map                      10%
  Undiluted excerpts                       5%（cap 10%）
```

### 10.5 Prune Recipe

```text
label_normalize = casefold + width_fold + whitespace_trim
label_merge_suggest_threshold.embedding = 0.88
label_merge_suggest_threshold.string    = 0.92   # 正規化後の文字列類似
label_suggest_max_per_init = 20
```

正規化は決定的で v0 から可能。embedding 近接による merge 候補 surfacing は local embedding を要するため v0.1 に整合する。閾値は surfacing 範囲を決めるだけで Gate を緩めない。これらは Label（語彙）entity（§1.4）に対する正規化・merge 候補生成の初期値であり、確定はユーザー / policy / rule が行う。

---

## 11. 設計変更プロセス（ADR）

core / contract / Recipe / 実装例 のいずれに属する変更かを明示し、ADR として扱う。core / contract に関わる欠陥は、通常の実装変更ではなく次の手順で扱う。

```text
1. ADR を作る
2. 変更対象が core / contract / Recipe / 実装例 のどれかを明示する
3. security / privacy への影響を評価する
4. rollback / 互換方針を書く
```

確定済みの主要な設計判断（ADR の中身）は次の通りである。これらは本文書の各節に反映済みである。

```text
ADR-1: sensitivity の Declassify（機微度を下げる緩和）は AI 単独では確定しない（§6.3 / §4.3 / §4.7 / §7.2）。
ADR-2: context_injected session の assistant assertion は independent evidence / reinforcement に数えない（§4.8 / §4.12）。
ADR-3: event_identity は source 側の安定座標（source_identity / session_identity）から導き、undiluted_id（blob 粒度）および connector_instance_id（再 connect / restore で変わる）に依存させない（§1.3.1 / §4.10）。
ADR-4: Event に origin（10 値）を追加し、origin ∈ {assistant, host_summary, host_memory, system, unknown} を independent evidence にしない（§1.3.2 / §4.12）。
ADR-5: ScopeLabel を Label（語彙）と Assignment（割当）に分割する（§1.4）。
ADR-6: Derivation を追加し、AI 由来 record に created_by_derivation_id を持たせる（§1.11）。
ADR-7: Session entity を追加し、session provenance（source_account / host version / git remote / context_injected）を正規化する（§1.10）。
ADR-8: sensitivity policy を Audience × Aperture × purpose の単一表に統一し、Declassify signal を閉じた列挙にする。secret は raw remote / raw export を確認付きでも不可（§4.3 / §7.2）。
ADR-9: delete / redact の cascade と Seal の SealRule を定義する（§4.15 / §7.3）。
ADR-10: realm_key を Realm root secret（rotation 不変、recovery material 由来）から導く rotation 不変鍵とし、at-rest 暗号化の DEK / KEK 系統（rotation / rekey 可能）と分離する。KEK rotation / DEK rekey は event_identity / content_fingerprint / normalized_key / SealRule.target_signature を変えず、Seal 済みの reprocess / 再 capture 復活を閉じる（§1.1 / §1.3.1 / §4.10 / §7.4）。
```

---

## 関連文書

- 完成版設計書（憲法）: `memoring_design_final_ja.md` — 思想・構造・機能・制約・安全性・運用方針の一貫した最終版。
- 要件定義書: `memoring_requirements_ja.md` — ID 付き（FR-/NFR-/CON-/OUT-）の検証可能な要件。
- 基本設計書: `memoring_basic_design_ja.md` — 全体構成・主要コンポーネント・データフロー・責務分担の高レベル設計。
- 仕様書: `memoring_specification_ja.md` — CLI / Daemon / MCP / context.md 形式 / 設定 / egress 権限表など利用者視点の機能仕様。
- 実装指示書: `memoring_implementation_instructions_ja.md` — 実装順序・優先順位・MVP・ディレクトリ構成・禁止事項・完了条件。
