# Memoring 要件定義書

この文書は、Memoring（メモリング）の v0 実装に着手するための、検証可能で曖昧さを排した要件定義書である。読者は実装者・レビュア・受け入れ判定者を想定する。各要件は ID（FR / NFR / CON / OUT）を持ち、機能要件は「〜できること」「〜してはならないこと」の検証可能な文として記す。思想・構造・データスキーマの根拠は再説明せず、必要に応じて設計書（`memoring_design_final_ja.md`）および詳細設計書（`memoring_detailed_design_ja.md`）の該当箇所を参照する。本文中の参照は、完成版ドキュメントセット内の所有先（不変条件は詳細設計書、egress 権限表は仕様書、Recipe 初期値は詳細設計書、データスキーマは詳細設計書、blocking gate は実装指示書 / 完成版設計書）へ向ける。文書名を付した参照（例:「詳細設計 §4「構造不変条件」」「仕様書 §7「出力可否」」）は別文書を、章番号のみの参照は本書自身の章を指す。

---

## 1. 目的とスコープ

### 1.1 目的

Memoring は、AI ツールがローカルに溜める履歴を取り込み、ユーザーが実効支配できる記憶資産（user-controlled memory）として、自動で蓄積・整理・分類・抽象化・定着させ、必要なときだけ安全な文脈として取り出せるようにする local-first / single-user の OSS（Sovereign Memory Loop / 主権記憶循環）である。本書はこの v0 が満たすべき要件を定義する。

### 1.2 v0 の範囲

v0 は次の 4 つで価値が成立する設計とする。

1. 取得: AI ツールのローカル蓄積から履歴を取り込む。
2. 蓄積: Undiluted を壊さず暗号化して保存する。
3. ループ: normalize / classify / abstract / consolidate を自動で回す。
4. 出口: `.memoring/context.md` を生成する。

形態は CLI + local daemon に絞る。とくに「取得」と「自動ループ」が Memoring の本体である。

### 1.3 対象ユーザー

- AI coding agent / AI チャットを日常利用している個人。
- Claude Code / Codex のローカル履歴を資産化したいユーザー。
- 自分の AI 作業履歴を将来の RAG / Context / Dataset に育てたいユーザー。

single-user / local-first を前提とし、team / organization / multi-device は対象外（第5章）。

### 1.4 v0 初期 Connector

- Claude Code local transcript / session Connector。
- Codex local session Connector。
- manual import directory Connector。
- generic JSONL / Markdown transcript Connector。

ChatGPT / Claude / Gemini の export、local embedding / vector index、MCP server の本格対応は v0.1 以降のロードマップに置く（第5章で対象外として明記）。

---

## 2. 機能要件（FR）

8 動詞は Input（connect / capture）、Loop（normalize / classify / abstract / consolidate）、Output（recall / handoff）に割り付く。FR はこの動詞の流れに沿って列挙し、続いて governance・削除・export・MCP の要件を記す。

### 2.1 connect / Inventory / Realm 割当

- **FR-001**: `connect` は宿主ツールのローカル蓄積を検出し、発見した source を 1 塊ではなく Inventory として列挙できること。detect は再実行可能であること（完成版設計書 §10「Intake と Retrieval」）。
- **FR-002**: Inventory は各 source について source_stable_id、project root / git remote / account、transcript path / last modified、sensitivity hint、suggested Realm、host_tool / host_tool_version / format_version を提示できること（完成版設計書 §10「Intake と Retrieval」）。
- **FR-003**: ユーザーは Inventory に対し include / exclude を選び、各 source を Realm へ割り当てられること（完成版設計書 §6「Realm・Replica・Storage」/ §10「Intake と Retrieval」）。
- **FR-004**: 同一宿主ツール（Claude Code / Codex）の履歴でも、project / git remote / account 単位で別 Realm に振り分けられること（完成版設計書 §6「Realm・Replica・Storage」/ §10「Intake と Retrieval」）。
- **FR-005**: connect は宿主ツール全体を 1 Realm に既定で混ぜてはならない。tool 全体 watch を既定にしてはならない（完成版設計書 §10「Intake と Retrieval」）。
- **FR-006**: ConnectorInstance の watch 対象は、選択済み source 集合に限られること（完成版設計書 §10「Intake と Retrieval」）。

### 2.2 capture / Undiluted・Occurrence

- **FR-007**: capture は原本を壊さず取り込み、Undiluted（中身）と Occurrence（いつ・どの source の・どの cursor で観測したか）を同時に生成できること（capture は唯一の 1 対 2 動詞、完成版設計書 §5「データ構造」/ §10「Intake と Retrieval」）。
- **FR-008**: capture は filesystem watch を主経路とし、Watcher が宿主のローカル蓄積への追記（差分）を検知して capture job を enqueue できること（完成版設計書 §2「設計思想」/ §10「Intake と Retrieval」）。
- **FR-009**: capture は取り込み時点で分類を強制してはならない（Capture First、完成版設計書 §3「中核原則」）。
- **FR-010**: Backfill は既定 OFF とし、init 直後はまず watch only で動けること。既定 OFF を維持しつつ `memoring backfill --since <t> --dry-run` / `connect --backfill --dry-run` の導線を提供し、Inventory・Realm・sensitivity hint・sample count を提示し、ユーザー確認後に実行できること（完成版設計書 §10「Intake と Retrieval」、仕様書 §1「CLI」）。
- **FR-011**: raw capture が失敗した場合、派生処理へ進んではならない。raw を失わない fallback を持つこと（完成版設計書 §16「v0完了条件（blocking gate）」）。

### 2.3 normalize / Parser

- **FR-012**: normalize は source 固有形式を共通の Event へ翻訳できること（完成版設計書 §2「設計思想」）。Event は event_identity により reprocess をまたいで evidence が安定すること（完成版設計書 §5「データ構造」/ 詳細設計 §4「構造不変条件」）。
- **FR-013**: Parser は parse 失敗・未知 format・unsupported host version でデータ損失を起こさず、raw-only fallback / Quarantine / doctor warning に落ちること。ParseResult は Event 群または QuarantineRecord を返し、parse 不能では Event を作らず QuarantineRecord（Occurrence / Undiluted を参照）に落として raw を失わないこと（詳細設計 §3「各コンポーネントの責務と処理単位」/ §5「エラー処理」、完成版設計書 §16「v0完了条件（blocking gate）」）。
- **FR-014**: 正規化できない raw は raw-only として保持し、後で Parser を更新して再処理できること（詳細設計 §3「各コンポーネントの責務と処理単位」）。
- **FR-015**: unknown field は encrypted blob（source_extra_ref）に保存し、known field へ昇格するまで index / ContextPack から除外すること。捨ててはならない（詳細設計 §3「各コンポーネントの責務と処理単位」/ §9「テスト観点」）。
- **FR-016**: Quarantine は parse / event の状態であり、Claim の状態として扱ってはならない（完成版設計書 §8「Claim Model」/ 詳細設計 §3「各コンポーネントの責務と処理単位」）。

### 2.4 classify / Scope（Label・Assignment）

- **FR-017**: classify は scope（Label / Assignment）と sensitivity を AI が割り当てられること。事前定義の固定 root カテゴリ（personal / private / social / work / anonymous 等）をハードコードしてはならない（完成版設計書 §7「Scope」/ 詳細設計 §4「構造不変条件」）。
- **FR-018**: 1 つの対象が複数 Label を持てること（label_ids）。Label は物理保管ではなく属性であること（完成版設計書 §7「Scope」/ 詳細設計 §1「データモデル contract」）。
- **FR-019**: 分類状態（classification_state）は candidate / inferred / confirmed / rejected / conflicted の 5 値を区別できること。unclassified は classification_state の値ではなく、対象に有効な Assignment が無い（Assignment 不在、または rejected のみ）＝ classified(x)=false を意味する scope 軸の概念とすること（完成版設計書 §7「Scope」）。
- **FR-020**: AI が割り当てられるのは candidate までであること。confirmed にできるのはユーザー、明示 policy、ユーザー定義の決定的 rule に限ること（完成版設計書 §7「Scope」/ §9「AI」、詳細設計 §1「データモデル contract」）。
- **FR-021**: 未分類（classified(x)=false。Assignment 不在、または rejected のみ）な対象は index / Claim / ContextPack / export へ進めてはならない（完成版設計書 §7「Scope」/ §10「Intake と Retrieval」、詳細設計 §1「データモデル contract」）。
- **FR-022**: Assignment（割当）と Label（語彙）を別 entity として扱えること。Assignment は target への label 付与、Label は語彙そのものを表すこと（完成版設計書 §7「Scope」/ 詳細設計 §1「データモデル contract」）。

### 2.5 ラベル正規化（Prune）

- **FR-023**: Prune は Label の表記ゆれ（大小・全半角・空白）を決定的に正規化し、別名を alias 候補にできること（完成版設計書 §7「Scope」/ 詳細設計 §10「Recipe 初期値」）。
- **FR-024**: 既存 Label と近接する新 Label を merge 候補として surfacing できること。近接判定の閾値は versioned Recipe が所有すること（完成版設計書 §7「Scope」/ 詳細設計 §10「Recipe 初期値」）。
- **FR-025**: Label の merge / rename / split の確定はユーザー / policy / rule の reactive governance で行えること。AI は candidate を出すだけで確定してはならない（完成版設計書 §7「Scope」/ 詳細設計 §4「構造不変条件」）。
- **FR-026**: merge は Label を統合し、関係する Assignment の label_ids を付け替え、evidence を union すること。silently drop してはならない（完成版設計書 §7「Scope」/ 詳細設計 §4「構造不変条件」）。
- **FR-027**: 完成版設計書 §7「Scope」の Label 正規化（語彙）と §8「Claim Model」の Claim merge（assertion 統合）を混同せず、別処理として扱えること。

### 2.6 abstract / consolidate（Claim）

- **FR-028**: abstract は Event から Claim 候補を汲み上げ、consolidate はその候補に証拠・整合・安全の検証を通して定着させること。両者を別工程として書き分けること（完成版設計書 §2「設計思想」）。
- **FR-029**: consolidation は全自動とし、review queue / 手動承認キューを持ってはならない（完成版設計書 §8「Claim Model」/ §3「中核原則」）。
- **FR-030**: candidate は schema validation → evidence validation（origin authority を含む）→ sensitivity / scope validation → policy validation → lifecycle / conflict validation → suppression check を通り、consolidated または conflicted / rejected になること（詳細設計 §2「状態遷移」、完成版設計書 §8「Claim Model」）。
- **FR-031**: 長期 Claim は必ず evidence を持つこと。Summary だけ、過去の AI 生成 Claim だけ、Memoring が生成した ContextPack / context.md を根拠に Claim を確定してはならない（完成版設計書 §8「Claim Model」）。
- **FR-032**: kind 別の origin 要件を満たすこと。constraint / do_not_do / decision は user origin を要し、assistant 単独で consolidate してはならない。preference は user origin 1 件で可、assistant は補助のみとすること（完成版設計書 §8「Claim Model」）。
- **FR-033**: origin enum は user / tool_result / command_result / file_diff / external_artifact / assistant / host_summary / host_memory / system / unknown とすること。independent evidence にできるのは user / tool_result / command_result / file_diff / external_artifact に限り、assistant / host_summary / host_memory / system / unknown は independent evidence 不可とすること。system（宿主の system / 設定 / CLAUDE.md 的注入）は independent evidence 不可で、constraint / decision / do_not_do の根拠にできず、明示 import 時のみ project policy 相当として扱うこと。origin が判定できない取り込みは origin=unknown とし、安全側で independent evidence 不可・evidence 資格なし扱いとすること（完成版設計書 §8「Claim Model」）。
- **FR-034**: 高リスク Claim も validator を通れば自動 consolidate されうること。安全は consolidated を止めることではなく出力 Gate で守ること（完成版設計書 §8「Claim Model」/ §9「AI」、詳細設計 §4「構造不変条件」）。
- **FR-035**: 同義の Claim は auto-merge し evidence を union できること。merge できない類似 Claim は黙って重複させず conflict / duplicate_candidate として扱うこと（完成版設計書 §8「Claim Model」）。
- **FR-036**: Claim は valid_from、任意の valid_until、任意の supersedes を持てること。supersede された旧 Claim は active recall から外れること（完成版設計書 §8「Claim Model」）。

### 2.7 全自動ループの駆動

- **FR-037**: ループは差分駆動であること。各段（capture → normalize → classify → abstract → consolidate）が次段の job を enqueue する work-driven 方式で進めること（完成版設計書 §2「設計思想」）。
- **FR-038**: 新しい差分が無いとき、AI / expensive step を fire してはならない。daemon は Watcher を待って idle になること（完成版設計書 §2「設計思想」/ 詳細設計 §4「構造不変条件」）。
- **FR-039**: 固定 Realm（新 evidence なし）に対し、ループは有限ステップで新規 candidate を生成しなくなり idle へ収束すること。差分ゼロで回り続けてはならない（詳細設計 §4「構造不変条件」）。

### 2.8 search / 検索

- **FR-040**: search は metadata filter、exact match、FTS、trigram / n-gram fallback、session reconstruction を提供できること（完成版設計書 §10「Intake と Retrieval」/ 詳細設計 §4「構造不変条件」）。
- **FR-041**: 日本語・CJK のために exact match と n-gram fallback を常設すること。n の値は実装選択であり、要件は「exact + n-gram fallback が存在すること」とする（完成版設計書 §10「Intake と Retrieval」/ 詳細設計 §4「構造不変条件」）。
- **FR-042**: locked Realm / 未分類（classified(x)=false）/ scope 外は検索候補に入れてはならない（完成版設計書 §10「Intake と Retrieval」）。
- **FR-043**: vector search を v0 の必須機能にしてはならない（完成版設計書 §10「Intake と Retrieval」、第5章）。

### 2.9 recall / handoff（context.md 生成）

- **FR-044**: handoff は recall した文脈を CWD の `.memoring/context.md` として生成できること。これを既定の主出口とすること（仕様書 §3「context.md（ContextPack）」、完成版設計書 §10「Intake と Retrieval」）。
- **FR-045**: context.md は ephemeral とし、用途のたびに再生成すること。長期保管せず、既定で sync / backup 対象に含めないこと（仕様書 §3「context.md（ContextPack）」）。
- **FR-046**: context.md は固定セクション（Safety Header / Active scope and boundary / Current project facts / Pinned・consolidated memories / Recent decisions / Active tasks / Relevant episodic summaries / Procedures / Constraints・do_not_do / Open conflicts・stale warnings / Citations・Evidence Map）で構成できること（仕様書 §3「context.md（ContextPack）」）。
- **FR-047**: Safety Header は curated context（current guidance）と quoted historical evidence（untrusted）を区別し、section ごとに trust level を持たせること（仕様書 §3「context.md（ContextPack）」、完成版設計書 §16「v0完了条件（blocking gate）」）。
- **FR-048**: raw excerpt / tool output / 外部由来テキストは fenced / quote block に閉じ込め、untrusted historical excerpt とラベルし、active constraints section に混ぜてはならない（仕様書 §3「context.md（ContextPack）」）。
- **FR-049**: AI 向け citation は opaque ID（clm_ / evt_）だけを使うこと。v0 で pack-local alias citation ID を作ってはならない（仕様書 §3「context.md（ContextPack）」、第5章）。
- **FR-050**: Evidence Map は transcript source path と絶対 path を出さず、active project 内の project-relative code path は出せること。sensitive filename は policy gated とすること（仕様書 §3「context.md（ContextPack）」）。
- **FR-051**: ContextPack は token budget を持ち、超えてはならない。raw excerpt には上限を持つこと。具体的な数値は versioned Recipe が所有すること（仕様書 §3「context.md（ContextPack）」、詳細設計 §4「構造不変条件」/ §10「Recipe 初期値」）。
- **FR-052**: raw excerpt は最後の手段とし、必ず引用・fence・opaque citation・安全ヘッダ付きで出すこと。safety header / constraints / scope boundary を raw excerpt に押し出してはならない（仕様書 §3「context.md（ContextPack）」、詳細設計 §4「構造不変条件」）。

### 2.10 Active Realm 解決

- **FR-053**: context build / search の前に Active Realm を解決できること。CWD を canonicalize し、各 Realm の root_paths / git_remotes と照合し、一意に定まればその Realm を active にすること（完成版設計書 §6「Realm・Replica・Storage」）。
- **FR-054**: 複数 Realm に該当、またはどこにも該当しないときは Silence とし、ユーザーに `--realm <id>` で明示させるか出力しないこと（完成版設計書 §6「Realm・Replica・Storage」）。
- **FR-055**: Active Realm が定まらない context build は context.md を出力してはならない（推測で混ぜない、完成版設計書 §6「Realm・Replica・Storage」/ §16「v0完了条件（blocking gate）」）。
- **FR-056**: cross-Realm search / cross-Realm context を提供してはならない。複数 Realm 運用時は watch・鍵束・index・daemon scope を Realm ごとに分離すること（完成版設計書 §6「Realm・Replica・Storage」、第5章）。
- **FR-085**: active scope の解決規則を実装し、解決不能時は Silence とすること（正本は詳細設計 §3.4）。CLI 明示（--scope / --label / --project）があればそれを active scope とし、無ければ CWD を canonicalize して Project.root_paths / git_remotes と照合し active_project を決め、active_project に属し classification_state ∈ {confirmed, inferred} の Label を active scope とすること。active_project が複数該当またはゼロのときは Silence（context.md を出さず --scope / --project を促す）とすること。standard Aperture で candidate scope を出す場合も active scope に限ること。`context build` に --scope / --project を追加し、ContextPack manifest に active_label_ids / active_project_ids と resolution_basis（解決根拠）を残すこと（仕様書 §1.1「CLI」、詳細設計 §3.4）。

### 2.11 出力 Gate（Audience × Aperture）

- **FR-057**: 出力 Gate は Audience（誰が読むか）と Aperture（どこまで出すか）の 2 軸だけで出力可否を決めること。これを唯一の安全機構とし、local file であることを安全の根拠にしてはならない（詳細設計 §4「構造不変条件」）。
- **FR-058**: Gate は詳細設計 §4「構造不変条件」の predicate を満たさない item を ContextPack に入れてはならない（captured / not_deleted / not_redacted / not_suppressed / classified / active_scope_match / allowed_scope_state / allowed_sensitivity / allowed_sensitivity_state / not_conflicted / cross_scope_allowed / has_required_provenance / not_self_generated_context_as_evidence）。
- **FR-059**: 既定の Audience × Aperture を ai_tool + standard とすること（詳細設計 §4「構造不変条件」、仕様書 §7「出力可否（egress 権限表）」）。
- **FR-060**: secret / unknown を出力に出してはならない。未分類（classified(x)=false）は sensitivity 判定の前段（Gate の classified 条件）で落とすこと（hard floor、どの Audience / Aperture でも不可。secret は raw 出力不可）。confidential は standard で落とし、permissive でも one-shot 明示確認時のみ可とすること（詳細設計 §4「構造不変条件」、仕様書 §7「出力可否（egress 権限表）」）。
- **FR-061**: 全 external / derived purpose（remote_ai / redacted_export / dataset_export）では、candidate のままの sensitivity を外部に出してはならない（sensitivity_classification_state ∈ {inferred, confirmed} を要する、詳細設計 §4「構造不変条件」、仕様書 §7「出力可否（egress 権限表）」）。
- **FR-062**: Gate は ranking より前に来ること。`¬gate(x, r)` のとき score を未定義とし、secret / unknown / confidential / scope 外を ranking へ到達させてはならない（Gate First、詳細設計 §4「構造不変条件」）。
- **FR-063**: ranking penalty は品質調整であり、安全を緩めてはならない（詳細設計 §4「構造不変条件」）。

### 2.12 reactive governance

- **FR-064**: ユーザーは事後操作で Claim を統治できること。`forget <claim_id>`、`forget --pattern`、`claim pin / correct / expire`、`label merge / rename / split` を提供すること（完成版設計書 §8「Claim Model」、仕様書 §1「CLI」）。
- **FR-065**: 事前確認を要するのは destructive delete / redact、confidential raw の remote AI 送信（one-shot 確認時）、または secret の redacted / surrogate 化された remote AI 送信など取り返しのつかない安全操作に限ること。secret raw は確認があっても remote AI へ送らないこと（完成版設計書 §8「Claim Model」、仕様書 §7「出力可否（egress 権限表）」）。
- **FR-066**: ユーザーの判断は肩代わりせず、conflict や別 root 由来 source の混入は recall 時 / init 時に surfacing できること（完成版設計書 §2「設計思想」/ §8「Claim Model」）。

### 2.13 削除 / redact / Seal

- **FR-067**: ユーザーは明示削除（delete / redact）を実行できること。`The Undiluted is Truth` は「消せない」を意味しない（詳細設計 §7「セキュリティ」）。
- **FR-068**: delete / redact は派生物へ cascade すること（Undiluted delete → Occurrence tombstone → Event redacted → index から該当 token / n-gram / embedding / snippet 除去 → Claim.evidence から該当 event_identity 除去 → evidence 不足 Claim は redacted / conflicted へ → ContextPack manifest 参照を tombstone 化、詳細設計 §7「セキュリティ」、完成版設計書 §16「v0完了条件（blocking gate）」）。
- **FR-069**: Event の redact では text_ref を除去し、event_identity は traversal のため残すこと（詳細設計 §7「セキュリティ」）。
- **FR-070**: 削除は tombstone（削除した事実と最小範囲）を残すこと（詳細設計 §7「セキュリティ」/ §9「テスト観点」）。
- **FR-071**: Seal は delete / redact に加えて SealRule を生成し、reprocess / 再 capture で同じ内容を復活させないこと（詳細設計 §4「構造不変条件」/ §7「セキュリティ」、完成版設計書 §16「v0完了条件（blocking gate）」）。
- **FR-072**: active な SealRule に一致する candidate は Claim / index / ContextPack / export へ進めてはならない（詳細設計 §4「構造不変条件」/ §1「データモデル contract」）。
- **FR-073**: SealRule の解除はユーザーの明示操作に限ること。AI / policy は SealRule を作成も解除もしてはならない（詳細設計 §4「構造不変条件」/ §1「データモデル contract」）。

### 2.14 export

- **FR-074**: export は purpose で分け、backup_export / redacted_export / dataset_export を区別できること（仕様書 §7「出力可否（egress 権限表）」/ §6「データ形式」）。
- **FR-075**: backup_export は v0 で動作すること。同一ユーザーの全文 encrypted backup / replica（secret / unknown も含む完全コピー）であり、same_user + client-side 暗号化を要し、平文を鍵境界外へ出さないこと（仕様書 §7「出力可否（egress 権限表）」/ §6「データ形式」）。
- **FR-076**: redacted_export / dataset_export は v0 では制約のみ固定し、CLI 主操作にしないこと（仕様書 §6「データ形式」、第5章）。
- **FR-077**: redacted_export / dataset_export は source lineage、license / provider boundary、third-party data removal、secret redaction、scope boundary、user approval、reproducible manifest を満たすこと。derived export として sensitivity_classification_state ∈ {inferred, confirmed} を要すること（FR-061）。各 sensitivity / purpose のセル値は egress 権限表（正本は仕様書 §7.3）に従うこと。lineage なき dataset、consent なき training、scope boundary を越える export を許してはならない（仕様書 §6「データ形式」/ §7「出力可否（egress 権限表）」）。
- **FR-078**: redacted_export / dataset_export では assistant output / tool output / 第三者 source code / customer data を default で除外すること。backup_export はこの除外を適用しないこと（仕様書 §6「データ形式」）。

### 2.15 MCP（受け皿 / optional）

- **FR-079**: MCP は v0 optional、read-only 既定とすること（仕様書 §4「MCP」、第5章）。
- **FR-080**: MCP は scope required とし、secret / unknown / confidential を除外し、audit log を残すこと（仕様書 §4「MCP」）。
- **FR-081**: MCP write は confirmed / consolidated への直接書き込みを禁止し、add_memory_candidate（candidate state のみ書ける、v0 optional）を超える書き込みをしないこと（仕様書 §4「MCP」、第5章）。
- **FR-082**: HTTP MCP を opt-in にする場合は localhost bind、auth token、origin check を要すること（仕様書 §4「MCP」）。

### 2.16 init / doctor

- **FR-083**: `init` は local encrypted replica を作成し、passphrase / recovery material を必須生成し、Connector を自動検出（Inventory 表示）し、ユーザーに source 選択と Realm 割当をさせ、doctor で検証できること（完成版設計書 §10「Intake と Retrieval」、仕様書 §1「CLI」）。
- **FR-084**: `doctor` は host_tool / format / Parser version の互換と file safety を検査し、警告・提案だけを行うこと。宿主 AI ツールの設定・保持期間・権限を勝手に変更してはならない（完成版設計書 §10「Intake と Retrieval」、仕様書 §1「CLI」/ §2「Daemon」）。

---

## 3. 非機能要件（NFR）

### 3.1 暗号化

- **NFR-001**: DB 全体（memoring.db）を at-rest 暗号化すること。これは default ON の構造的要件であり後付けにしないこと（完成版設計書 §6「Realm・Replica・Storage」、詳細設計 §4「構造不変条件」/ §7「セキュリティ」）。
- **NFR-002**: Undiluted は暗号化して保存し、平文 raw を disk に置かないこと（完成版設計書 §6「Realm・Replica・Storage」）。
- **NFR-003**: Realm 内に per-domain の暗号境界（Key Domain）を作ってはならない。Realm 内の境界は scope label による soft な属性とし、安全は出力 Gate で守ること（完成版設計書 §6「Realm・Replica・Storage」/ §7「Scope」）。
- **NFR-004**: ログに content payload を出さず、id / 件数 / 状態のみを記録すること（詳細設計 §4「構造不変条件」）。

### 3.2 index の安全

- **NFR-005**: 平文 index を永続 disk に置いてはならない。at-rest では暗号化すること。平文 index は process memory / tmpfs の一時値としてだけ扱うこと（完成版設計書 §5「データ構造」/ §10「Intake と Retrieval」、詳細設計 §4「構造不変条件」）。
- **NFR-006**: index は Chronicle / 下位層から決定的に再構築できること（完成版設計書 §10「Intake と Retrieval」、詳細設計 §4「構造不変条件」/ §9「テスト観点」）。
- **NFR-007**: index build は Secret Scan の後に行うこと。scan 失敗時はその event を index しないこと（完成版設計書 §10「Intake と Retrieval」、詳細設計 §7「セキュリティ」）。
- **NFR-008**: index に含まれる token / n-gram / embedding / term frequency / snippet cache はすべて暗号化対象とすること（詳細設計 §4「構造不変条件」）。
- **NFR-009**: SQLite を使う場合、WAL / rollback journal / temp store / FTS shadow table / vacuum 中間ファイル / backup file を暗号化するか無効化すること。temp store は memory / tmpfs に置き、平文中間ファイルを disk に残さないこと（詳細設計 §4「構造不変条件」）。

### 3.3 鍵ライフサイクル

- **NFR-010**: master key はユーザーの passphrase または OS secret から KDF で導出すること。鍵そのものを DB に平文で置いてはならない（完成版設計書 §6「Realm・Replica・Storage」、詳細設計 §7「セキュリティ」）。
- **NFR-011**: 鍵階層は envelope 方式とし、Realm ごとに DEK を持ち、DEK を KEK で包むこと。realm_key は identity / fingerprint 用の HMAC 鍵であり、Realm root secret（rotation 不変。recovery material から導出。失えば復号不能）から KDF で導出する別系統とすること。data at-rest 暗号化の DEK 系とは分離し、Realm をまたいで共有しないこと（詳細設計 §7「セキュリティ」）。
- **NFR-012**: KDF parameters（algorithm / memory / iterations / salt）を記録し、再導出を決定的にすること（詳細設計 §7「セキュリティ」）。
- **NFR-013**: AEAD の nonce / IV は鍵ごとに一意とし、再利用しないこと（詳細設計 §7「セキュリティ」）。
- **NFR-014**: KEK rotation / DEK rekey を可能にすること。rotation は payload を平文化せず envelope 再暗号化で行うこと。KEK rotation / DEK rekey は payload envelope を再暗号化するが realm_key を変えないこと。したがって event_identity / content_fingerprint / normalized_key / SealRule.target_signature は rotation / reconnect / restore をまたいで不変であること（詳細設計 §7「セキュリティ」）。
- **NFR-015**: redacted_export / dataset_export は backup とは別鍵で封をすること（export key separation）。backup_export は Realm の全文 encrypted コピーで同一 key domain を保つこと（詳細設計 §7「セキュリティ」）。
- **NFR-016**: 初回 setup で recovery material を生成し、Memoring は recovery 平文を保持しないこと（詳細設計 §7「セキュリティ」）。
- **NFR-017**: OS keychain が使える環境では keychain を使い、headless / container / WSL では passphrase による file-based encrypted key bundle を使うこと（完成版設計書 §10「Intake と Retrieval」）。

### 3.4 CJK 検索

- **NFR-018**: 日本語・CJK 検索は exact match と n-gram fallback で成立すること。tokenizer 差による検索漏れを exact + n-gram fallback で補うこと（完成版設計書 §10「Intake と Retrieval」、詳細設計 §4「構造不変条件」/ §9「テスト観点」）。

### 3.5 ループ収束 / idle

- **NFR-019**: ループは差分駆動とし、不変な Realm に対して有限ステップで idle に収束すること（詳細設計 §4「構造不変条件」）。
- **NFR-020**: idle 状態（pending job なし ∧ new evidence なし）では AI / 計算資源を消費しないこと。Watcher の待機を超える busy polling をしてはならない（詳細設計 §4「構造不変条件」）。
- **NFR-021**: evidence 以外で許される trigger は時間駆動の保守（valid_until 到来による expire、reinforcement 減衰）に限り、scheduled tick として有界に実行すること。新 evidence 無しに無限の派生 job を生んではならない（詳細設計 §4「構造不変条件」）。

### 3.6 host 変化耐性 / raw-only fallback

- **NFR-022**: host transcript format を stable API と見なさないこと。Connector は tested host version / format version / Parser version を記録すること（詳細設計 §3「各コンポーネントの責務と処理単位」）。
- **NFR-023**: 未知 format / unsupported version では壊れた parse をせず raw-only fallback に倒すこと。取得・parse できない場合でも raw を失わないこと（詳細設計 §3「各コンポーネントの責務と処理単位」）。
- **NFR-024**: Connector は folder path / file layout に強く依存せず、source_stable_id を主キーにすること（詳細設計 §3「各コンポーネントの責務と処理単位」）。
- **NFR-025**: Connector は golden fixtures を持ち、host update ごとに検証できること。detect は再実行可能であること（詳細設計 §3「各コンポーネントの責務と処理単位」/ §9「テスト観点」）。
- **NFR-026**: 宿主のアップデートで内部フォルダ構造や保存形式が変わっても、Memoring 全体は壊れず、最低でも raw-only capture / Quarantine / doctor warning に落ちること（詳細設計 §3「各コンポーネントの責務と処理単位」）。

### 3.7 性能

- **NFR-027**: 処理は差分駆動とし、新しい Event があるときだけ expensive な AI 呼び出しを走らせること（完成版設計書 §2「設計思想」、詳細設計 §4「構造不変条件」）。
- **NFR-028**: Job queue は v0 では SQLite table でよい。busy loop を作らないこと（詳細設計 §4「構造不変条件」、実装指示書）。

### 3.8 監査ログ

- **NFR-029**: 次の操作は必ず audit log を残すこと: Crossing / ContextPack generation / MCP request / remote AI enrichment / export / delete / redact / policy override / key recovery / Recipe change（詳細設計 §8「ログ」）。
- **NFR-030**: review queue が存在しないため、high-risk memory review は audit 対象にしないこと。代わりに high-risk Claim の exposure / correction / Seal / delete を audit すること（詳細設計 §8「ログ」）。

### 3.9 local-first / single-user

- **NFR-031**: v0 は single-user / local-first / CLI + local daemon に限ること（完成版設計書 §4「v0の責務境界」）。
- **NFR-032**: v0 は first-party の cloud backup / sync を実装しないこと。持つのは local encrypted Realm、client-side encryption 済みの local export archive、local restore、任意の保存先へ運べる self-contained な暗号化 archive とすること（完成版設計書 §6「Realm・Replica・Storage」、第5章）。
- **NFR-033**: クラウドへ送る場合は平文 raw を置かず、upload 前に client-side encryption すること。復号鍵はユーザー側にあること（完成版設計書 §6「Realm・Replica・Storage」）。

### 3.10 context.md ファイル安全

- **NFR-034**: context.md の出力は次のファイル安全を満たすこと: 出力先 path を canonical 解決する、`.memoring` が symlink なら refuse する、出力先が repo 外 / world-readable なら refuse または warn する、atomic write の後に chmod 0600（親ディレクトリ 0700 推奨）する、`.memoring/` は生成時に `.git/info/exclude` へ追加し `.gitignore` は書き換えない、manual import の `.memoring/` 除外は文字列一致ではなく canonical path 解決後で判定する（仕様書 §3「context.md（ContextPack）」、完成版設計書 §16「v0完了条件（blocking gate）」）。

---

## 4. 制約条件（CON）

設計上の不変条件（Law）であり、validator / gate / policy が必ず守る。Recipe の数値とは区別する。

- **CON-001**: AI が割り当てられるのは candidate までであること。scope（Assignment / Label）の confirmed 化はユーザー / 明示 policy / ユーザー定義 rule に限り、AI は確定してはならない（完成版設計書 §7「Scope」/ §9「AI」）。
- **CON-002**: AI は secret / confidential の外部送信許可、destructive redact / delete、Crossing の恒久許可を行ってはならない。権威は model ではなく schema / validator / policy / evidence に置くこと（完成版設計書 §9「AI」）。
- **CON-003**: sensitivity の Declassify（機微度を下げる緩和）は AI 単独では確定しないこと。確定できる signal は詳細設計 §4「構造不変条件」の閉じた列挙（explicit user rule / explicit project policy / user-confirmed correction / immutable URL を伴う verified public source import / detector pattern 固有の deterministic false-positive rule）に限ること（完成版設計書 §3「中核原則」、詳細設計 §4「構造不変条件」、仕様書 §7「出力可否（egress 権限表）」）。
- **CON-004**: AI の confidence / probability、semantic similarity / embedding 近接、filename / path に "public" を含むこと、git remote が public なこと、出現頻度 / 再出現を Declassify の根拠にしてはならない（詳細設計 §4「構造不変条件」）。
- **CON-005**: Escalate（機微度を上げる厳格化、Silence の向き）の変更は AI candidate でも許すが、Declassify（機微度を下げる緩和）方向は許さないこと（Ratchet、詳細設計 §4「構造不変条件」）。
- **CON-006**: secret は raw のまま remote AI へ送ることをユーザー確認があっても許さないこと。送れるのは redacted / masked / surrogate 化されたものに限ること（完成版設計書 §9「AI」、仕様書 §7「出力可否（egress 権限表）」）。
- **CON-007**: secret event の index_text は redacted_or_empty とし、context_output を不可とすること。1 行でも secret が混ざった event は event 全体を secret とすること（event 単位 sensitivity、詳細設計 §4「構造不変条件」、完成版設計書 §5「データ構造」）。
- **CON-008**: sensitivity は event 単位とし、span 単位の部分伏字をしないこと（完成版設計書 §5「データ構造」、詳細設計 §4「構造不変条件」、第5章）。
- **CON-009**: self-generated context（Memoring が生成した ContextPack / context.md）を Claim の evidence にしてはならない。reinforcement の recall_count にも数えてはならない（完成版設計書 §2「設計思想」、詳細設計 §4「構造不変条件」）。
- **CON-010**: origin ∈ {assistant, host_summary, host_memory, system, unknown} を independent evidence に数えてはならない。origin ∈ {host_summary, host_memory, system, unknown} は evidence そのものにできないこと。system は constraint / decision / do_not_do の根拠にできず、明示 import 時のみ project policy 相当として扱うこと（完成版設計書 §8「Claim Model」、詳細設計 §4「構造不変条件」）。
- **CON-011**: context_injected session の assistant 由来 assertion を independent evidence / reinforcement signal に数えてはならない。同 session 内でも外部性のある観測（user message / tool result / command result / file diff / external artifact / explicit user correction / explicit user decision）は evidence として使えること（完成版設計書 §10「Intake と Retrieval」、詳細設計 §4「構造不変条件」）。
- **CON-012**: event_identity は source 側の安定座標から導くこと。raw blob 粒度（undiluted_id / object layout）に依存させないこと。安定座標は source_identity = hmac(realm_key, connector_id || source_stable_id || source_account_stable_key)、session_identity = hmac(realm_key, source_identity || host_session_stable_id)、event_identity = hmac(realm_key, source_identity || session_identity || (message_id | content_anchor)) とすること。Source entity に source_stable_key_hmac を持たせ、connector_instance_id は identity から外して provenance / config 参照へ降格すること（再 connect / restore で値が変わりうるため）。realm_key は rotation 不変であり（NFR-011 / NFR-014）、reprocess（Parser version 変更）/ blob 粒度変更 / re-dedup / content_fingerprint 方式変更 / 再 connect / restore のいずれでも event_identity が変わってはならない。Claim.evidence は event_identity を指すこと（詳細設計 §4「構造不変条件」/ §1「データモデル contract」）。
- **CON-013**: identity / trust boundary（別人格・別信頼境界・絶対に混ぜたくない仕事）は Realm で分け、topic / project / 作業テーマは scope label で扱うこと。Realm 内に暗号境界を作ってはならない（完成版設計書 §6「Realm・Replica・Storage」/ §7「Scope」）。
- **CON-014**: Realm 間は設計上連結しないこと。1 Realm = 1 identity = 1 信頼境界 = 1 鍵とすること（完成版設計書 §6「Realm・Replica・Storage」/ §7「Scope」）。
- **CON-015**: Claim の sensitivity は evidence の最大機微度を下回らないこと（機微度順序 public < internal < confidential < secret、unknown は Silence）。下回るには詳細設計 §4「構造不変条件」の Declassify signal を要し、AI candidate だけでは下げられないこと（詳細設計 §4「構造不変条件」、仕様書 §7「出力可否（egress 権限表）」）。
- **CON-016**: Recipe（閾値 / 重み / budget）は構造不変条件を破ってはならない。safety penalty の floor / raw_excerpt_share の ceiling は安全側にしか変更できないこと（詳細設計 §4「構造不変条件」、完成版設計書 §13「Recipe」）。
- **CON-017**: 人が頻繁に手で触る「第3カテゴリ」の数値 knob を作らないこと。tunable な値は versioned Recipe（recipe_id / version / eval / audit / rollback ref を持つ）が所有すること（詳細設計 §4「構造不変条件」/ §9「テスト観点」、完成版設計書 §13「Recipe」）。
- **CON-018**: supersede は source 申告の timestamp を安全判断の根拠にしないこと。capture 順 / Chronicle.sequence / 明示 valid_from と整合して決め、未来日・不整合・単調でない timestamp を supersede の根拠にしないこと（詳細設計 §4「構造不変条件」）。
- **CON-019**: reinforcement_score は 0 ≤ score ≤ 1 の bounded scalar とすること。correction / conflict の増加だけで score を上げてはならず、user_rejected な Claim を auto_consolidate してはならないこと（詳細設計 §4「構造不変条件」）。
- **CON-020**: predefined root category を作ってはならない。label の merge 確定は user / policy / rule を要し、label は暗号境界へ昇格しないこと（詳細設計 §4「構造不変条件」、完成版設計書 §7「Scope」）。
- **CON-021**: content_fingerprint および index 派生物は realm_key を鍵とした HMAC で保持し、平文を晒さないこと。Realm をまたぐ dedup をしないこと（詳細設計 §1「データモデル contract」/ §4「構造不変条件」）。

---

## 5. 対象外範囲（OUT）

v0 でやらないことを確定する。「いつかやる」ではなく「v0 ではやらない」とし、再開する場合は設計変更プロセス（ADR）を要する（完成版設計書 §17「やらないこと」、詳細設計 §11「設計変更プロセス（ADR）」）。

- **OUT-001**: 事前定義の人格分類をしない（personal / private / social / work / anonymous をハードコードしない）。
- **OUT-002**: ラベルの自動統合確定をしない（merge 候補は surfacing のみ、確定は user / policy / rule）。
- **OUT-003**: Realm 内の暗号境界（Key Domain）を作らない。identity / 信頼の分離は Realm 単位で行う。これは設計判断であり、ADR で再開する性質のものではない。
- **OUT-004**: first-party cloud backup / sync を作らない（標準の受け皿だけ用意する）。
- **OUT-005**: ReplicaManifest / root_hash sync / known-replica 追跡をしない。
- **OUT-006**: review queue / 手動承認を作らない。
- **OUT-007**: live multi-device sync をしない。
- **OUT-008**: team / organization / admin をしない。
- **OUT-009**: desktop app を作らない。
- **OUT-010**: browser scraping / 非公開 API 依存をしない。
- **OUT-011**: provider のアクセス制御を回避する import をしない。
- **OUT-012**: hook injection / real-time event capture をしない。
- **OUT-013**: MCP write integration（add_memory_candidate を超える書き込み）をしない。
- **OUT-014**: span / 行単位の伏字をしない。
- **OUT-015**: context injection を span 単位で追跡しない（v0 は marker が現れた session 全体を context_injected として安全側に閉じる。span 化は v0.1）。
- **OUT-016**: pack-local alias citation ID を作らない（v0 は opaque ID（clm_ / evt_）。alias は v0.1）。
- **OUT-017**: fine-tuning dataset builder を本格実装しない（制約だけ固定する）。
- **OUT-018**: vector search を v0 必須にしない。
- **OUT-019**: ranking weight の自動 tuning を先にやらない（manual Recipe のみ）。
- **OUT-020**: cross-Realm search / cross-Realm context を提供しない（完成版設計書 §6「Realm・Replica・Storage」）。
- **OUT-021**: direct S3 / R2 / Google Drive クライアントを実装しない（完成版設計書 §6「Realm・Replica・Storage」）。
- **OUT-022**: crypto-shred 伝播 / backup re-key の自動運用をしない（完成版設計書 §6「Realm・Replica・Storage」）。

---

## 6. 受け入れ基準

v0 の完了条件は完成版設計書 §16「v0完了条件（blocking gate）」の blocking gate である（完了条件は実装指示書「完了条件」とも対応する）。以下に各 gate と、それを満たす要件のトレーサビリティを対応付ける。すべての gate が閉じることで v0 は完了する。

| Gate | 内容 | 関連要件 |
| --- | --- | --- |
| G1 | raw capture が失敗したら派生処理へ進まない（raw-only fallback がある） | FR-011, FR-014, NFR-023 |
| G2 | Parser 失敗 / 未知 format / unsupported host version でデータ損失せず raw-only fallback / Quarantine / doctor warning に落ちる | FR-013, FR-016, NFR-022, NFR-023, NFR-026 |
| G3 | secret / unknown / 未分類（classified(x)=false）/ confidential（standard）は context.md に出ない | FR-060, CON-007, CON-008 |
| G4 | Active Realm / active scope / classified 済み以外は search / context に出ない | FR-021, FR-042, FR-053, FR-054, FR-055, FR-058, FR-085 |
| G5 | 出力 Gate が Audience × Aperture で動く（既定 ai_tool + standard、secret は raw 出力不可） | FR-057, FR-058, FR-059, FR-060, FR-062, FR-063, CON-006 |
| G6 | context.md に safety header（current guidance と untrusted excerpt を区別）と Ouroboros marker が入る | FR-047, FR-048, CON-009 |
| G7 | context.md のファイル安全（canonical path / .memoring symlink refuse / chmod 0600 / atomic write）を満たす | NFR-034, FR-044 |
| G8 | origin ∈ {assistant, host_summary, host_memory, system, unknown} が independent evidence にならず、host-memory laundering ループが閉じる | FR-031, FR-032, FR-033, CON-010, CON-011 |
| G9 | sensitivity の Declassify が詳細設計 §4「構造不変条件」の閉じた列挙の権威以外で起きない | CON-003, CON-004, CON-005, CON-015 |
| G10 | delete / redact が下流へ cascade し、Seal が SealRule で reprocess 復活を防ぐ | FR-068, FR-069, FR-071, FR-072, FR-073 |
| G11 | reprocess（Parser version / blob 粒度変更）後も event_identity が変わらず evidence が宙に浮かない | FR-012, CON-012 |
| G12 | connect が Inventory を出し、Realm 割当を選ばせる。tool 全体 watch を既定にしない | FR-001, FR-003, FR-004, FR-005, FR-006 |
| G13 | `.memoring/context.md` が新しい AI session で実用的に読める | FR-044, FR-046, FR-050, FR-051 |

> 注: G7 が要求する context.md のファイル安全は NFR-034（§3.10）に対応する。詳細は仕様書 §3「context.md（ContextPack）」、完成版設計書 §16「v0完了条件（blocking gate）」が定める。

### 補助受け入れ基準（詳細設計 §9「テスト観点」、blocking を肥大させない）

次は v0 で守るが blocking には含めない。対応要件を併記する。

- unknown field を捨てず encrypted source_extra_ref に保存する（FR-015）。
- 平文 global index / 永続平文 FTS file が存在しない（NFR-005, NFR-008）。
- index 破損時に下位層から再構築できる（NFR-006）。
- Claim は evidence を持つ。Summary だけで consolidated にならない（FR-031）。
- context.md / ContextPack を Claim の evidence にしない（CON-009）。
- context_injected session の assistant 言い換えが independent evidence / reinforcement に数えられない（CON-011）。
- sensitivity の Declassify（機微度を下げる緩和）が AI candidate だけでは起きない（CON-003）。
- Claim の sensitivity が evidence の最大機微度を下回らない（CON-015）。
- remote AI / export が sensitivity の値だけでなく classification_state（inferred / confirmed）も確認する（FR-061）。
- evidence_count が詳細設計 §10「Recipe 初期値」の independent evidence count と一致する（FR-035 の前提定義）。
- 日本語検索が exact と n-gram fallback で成立する（FR-041, NFR-018）。
- label 正規化が決定的で、label merge 確定が user / policy / rule に限られる（FR-023, FR-025, CON-020）。
- reprocess 後も event_identity が変わらず evidence が宙に浮かない（CON-012）。
- Recipe は version / eval / audit / rollback ref を持つ。第3カテゴリの knob を作らない（CON-017）。
- 削除（delete / redact）が機能し、tombstone を残す（FR-067, FR-070）。

---

## 関連文書

- 完成版設計書（`memoring_design_final_ja.md`）: 思想・構造・不変条件・データ構造・運用方針の包括的な根拠。本書の `§` 参照先。
- 基本設計書（`memoring_basic_design_ja.md`）: 全体構成・データフロー・責務分担。
- 詳細設計書（`memoring_detailed_design_ja.md`）: JSON スキーマ全量・状態遷移・Gate predicate・不変条件の実装粒度。
- 仕様書（`memoring_specification_ja.md`）: CLI / Daemon / MCP / context.md 形式・egress 権限表など利用者から見た振る舞いと形式。
- 実装指示書（`memoring_implementation_instructions_ja.md`）: 実装順序・MVP・ディレクトリ構成・禁止事項・完了条件。
