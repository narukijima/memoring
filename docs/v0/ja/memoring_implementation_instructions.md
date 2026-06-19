# Memoring 実装指示書

この文書は、実装AI（および実装者）がそのまま着手できる実装指示書である。何を、どの順番で、どこまで作るか、何を作らないか、どこで完了とみなすかを示す。設計判断の根拠・思想・データ構造・不変条件・利用者から見た仕様は、それぞれ専用の文書が持つ。本書は重複を避け、必要箇所で各文書を参照する。実装中に「なぜそうなるのか」が必要になったら設計書を、「何を満たせばよいか」が必要になったら要件定義書を、「どんな形か」が必要になったら詳細設計書・仕様書を引くこと。

---

## 1. 前提と読む順番

Memoring は、AI ツールがローカルに溜める履歴を取り込み、ユーザーが実効支配できる記憶資産として自動で整理・抽象化・定着させ続ける Sovereign Memory Loop（主権記憶循環）である。実装に入る前に、設計書（思想・構造・制約・安全性・データ・運用を貫く憲法）→ 要件定義書（FR/NFR/CON/OUT の検証可能な要件）→ 基本設計書（全体構成・データフロー・責務分担）→ 詳細設計書（コンポーネント責務・JSON スキーマ全量・不変条件・Gate predicate）→ 仕様書（CLI/Daemon/MCP/context.md 形式・設定・egress 権限）の順で目を通すこと。本書はこれらを下敷きにした実行手順である。

実装の北極星は、v0 が作る 4 つの核である。これ以外は守るべき境界として残すが、v0 の実装責務からは外す。

```text
1. 取得:   AI ツールのローカル蓄積から履歴を取り込む（connect → capture）。
2. 蓄積:   Undiluted を壊さず暗号化して保存する。
3. ループ: 整理・分類・抽象化・consolidate を自動で回す（normalize → classify → abstract → consolidate）。
4. 出口:   .memoring/context.md を生成する（Gate 越しの recall）。
```

この 4 つだけで価値が成立するように作る。とくに「取得」と「自動ループ」が Memoring の本体であり、ここが弱いと製品にならない。DB・object store・index は土台であって本体価値ではない。

---

## 2. 最小構成（MVP）で最初に作るもの

最初に通すべきは、価値が一本立つ縦串である。横に機能を広げる前に、この縦串を端から端まで通すこと。

```text
memoring init
  encrypted replica を作成し、passphrase / recovery material を必須生成する。

memoring connect claude-code
  detect で Inventory を出し、source を Realm へ割り当てる（include / exclude）。

capture（raw-only fallback 込み）
  Undiluted と Occurrence を同時に生む。parse できなくても raw を失わない。

最小ループ
  normalize（Event 化）→ classify candidate（scope / sensitivity の AI 候補）
  → abstract（Claim 候補）→ consolidate（validator を通して定着）。

context build
  Gate（Audience × Aperture）→ safety header → Ouroboros marker 付きで
  .memoring/context.md を生成する。
```

この縦串が通れば、「新しい Claude Code session を始めると、過去の決定・好み・制約が context.md として持ち越される」という最初の体験が成立する。主役のコマンドは `memoring search` ではなく `memoring context build` であることを忘れないこと。MVP の時点で、Gate・safety header・Ouroboros marker・file safety は省略してはならない。安全は後付けにせず、出口を作る最初の瞬間から組み込む。

---

## 3. 実装順序と優先順位

フェーズは縦串（第2章）を太らせる順で進める。各フェーズの完了は、詳細設計書の不変条件と、本書 第7章に再掲する v0 blocking gate の該当項目で判定する。番号は blocking gate（13 項目）の番号を指す。

### P0: capture / 暗号化 / Chronicle / schema

土台。Undiluted / Occurrence / Event / Chronicle の schema を固定し、DB 全体を at-rest 暗号化する。capture は Undiluted と Occurrence を同時に生む 1 対 2 動詞として実装し、raw-only fallback を最初から持たせる。Chronicle は append-only で、index と下位層を決定的に再構築できる土台にする。

- 完了条件: gate 1（raw capture 失敗時は派生処理へ進まない / raw-only fallback がある）。
- 併せて満たす: 補助 gate のうち「unknown field を捨てず encrypted ref に保存」「平文 global index / 永続平文 FTS file が存在しない」の前提となる暗号化基盤。

### P1: Connector / Parser / Watcher

入口。`detect` で Inventory を列挙し、`configure` で include/exclude と Realm 割当を受ける。Connector は宿主ツール全体を 1 塊で返さず、source 単位で扱う。Parser は外の汚い世界と固定 schema の境界であり、host transcript format を stable API と見なさない。未知 format / unsupported version では壊れた parse をせず raw-only fallback / Quarantine / doctor warning に倒す。Watcher は選択済み source だけを対象にし、差分が来たときだけ capture job を enqueue する（tool 全体 watch を既定にしない）。

- 初期 Connector: Claude Code local transcript / session、Codex local session、manual import directory、generic JSONL / Markdown transcript。
- 完了条件: gate 2（Parser 失敗 / 未知 format / unsupported host version でデータ損失せず fallback / Quarantine / doctor warning に落ちる）、gate 12（connect が Inventory を出し Realm 割当を選ばせる / tool 全体 watch を既定にしない）。

### P2: classify / abstract / consolidate + validator

ループの心臓。AI は candidate を作るだけで、確定は validator が行う。consolidate は schema validation → evidence validation（origin authority 含む）→ sensitivity / scope validation → policy validation → lifecycle / conflict validation → suppression check の順に通し、通ったものだけ consolidated にする。review queue は作らない。abstract（Event から Claim 候補を汲み上げる飛躍）と consolidate（候補に証拠・整合・安全の検証を通す工程）を必ず書き分ける。Derivation を生成し、AI 由来 record に created_by_derivation_id を持たせる。

- 完了条件: gate 8（origin ∈ {assistant, host_summary, host_memory, system, unknown} が independent evidence にならず host-memory laundering ループが閉じる）の evidence 側、補助 gate「Claim は evidence を持つ / Summary だけで consolidated にならない」。
- ループ収束: 差分駆動で、新 evidence の無い固定 Realm では有限ステップで idle に収束させる（詳細設計書の loop convergence invariant）。差分ゼロで回り続けない。

### P3: search（exact + FTS + n-gram）/ ContextPack / Gate

出口。検索は metadata filter / exact / FTS / trigram or n-gram fallback / session reconstruction を持つ。日本語・CJK のために exact と n-gram fallback を常設する（n は実装選択）。平文 index を永続 disk に置かず、at-rest で暗号化し、Secret Scan の後に index build する。ContextPack は dump ではなく recall であり、Gate predicate を満たした item だけが入る。Gate は Audience × Aperture の 2 軸で決まり、ranking より前に来る（Gate First）。context.md には safety header（current guidance と untrusted excerpt の区別）と signed Ouroboros marker を入れ、file safety（canonical path / .memoring symlink refuse / chmod 0600 / atomic write）を満たす。

- 完了条件: gate 3（secret / unknown / confidential(standard)、および未分類(classified=false) は context.md に出ない）、gate 4（Active Realm / active scope / classified 済み以外は search / context に出ない）、gate 5（Gate が Audience × Aperture で動く / secret はどの Aperture でも raw 不可）、gate 6（safety header と Ouroboros marker）、gate 7（file safety）、gate 13（context.md が新しい AI session で実用的に読める）。

### P4: reactive governance / Seal / delete / redact

事後統治。ユーザーは事前承認ではなく事後操作で統治する。forget / claim pin / correct / expire / label merge / rename / split / delete / redact を実装する。delete / redact は派生物へ cascade し、Seal は SealRule を生成して reprocess / 再 capture で復活しないようにする。SealRule の作成・解除はユーザーの明示操作だけに限る。Declassify（機微度を下げる緩和）は閉じた列挙の非 AI 権威だけが確定する。

- 完了条件: gate 9（Declassify が閉じた列挙の権威以外で起きない）、gate 10（delete / redact が cascade し Seal が reprocess 復活を防ぐ）、gate 11（reprocess 後も event_identity が変わらず evidence が宙に浮かない）。

### P5: MCP read-only / backup_export

optional な受け皿。MCP は read-only 既定で、secret / unknown / confidential を除外し、audit log を要する。write は add_memory_candidate（candidate state にだけ書ける）を超えない。HTTP MCP を opt-in にする場合は localhost bind / auth token / origin check を要する。export は backup_export だけ v0 で動かし、redacted_export / dataset_export は制約だけ固定して実装は後段にする。

- 完了条件: 仕様書の MCP / export 仕様を満たすこと。backup_export は同一ユーザー全文 encrypted backup として secret / unknown も含めて完全コピーする（鍵境界外へ平文を出さない）。

---

## 4. ディレクトリ構成案

v0 は CLI + daemon + SQLite + filesystem + schemas + fixtures + doctor に絞る。次のツリーを基本とする。

```text
memoring/
  apps/
    cli/
    daemon/
  packages/
    core/        loop, schema, policy, chronicle, realm, recipe
    storage/     sqlite, object-store, encrypted-db
    intake/      connectors, parsers, watcher
    claim/       extractor, validator, consolidation, lifecycle, seal
    retrieval/   search, ranking, context-pack, mcp
    security/    key-lifecycle, redaction, secret-scan, audit, ouroboros
    integrations/ claude-code, codex, manual-directory, generic-jsonl, markdown-transcript
  schemas/
  fixtures/
  docs/
```

各ディレクトリに置く主要ファイルの例（命名は実装選択。責務の所在を示すための例示である）。

```text
packages/core/
  loop.ts            差分駆動の work-driven オーケストレーション（job enqueue / idle 収束）
  schema/            Undiluted / Occurrence / Event / Session / Claim / Assignment / Label /
                     Derivation / ContextPack / Artifact / Chronicle / SealRule / Policy の型と version
  policy.ts          policy.v2 の評価（precedence、egress 判定）
  chronicle.ts       append-only log と sequence、index 再構築
  realm.ts           Realm 解決（Active Realm）、Replica レイアウト
  recipe.ts          versioned Recipe（閾値 / 重み / budget）の読み込みと version 管理

packages/storage/
  encrypted-db.ts    at-rest 暗号化 DB（WAL / journal / temp / FTS shadow / vacuum / backup の漏れを封じる）
  object-store.ts    Undiluted / Artifact の encrypted object 保管（opaque ref）
  sqlite.ts          SQLite アクセスと job queue table

packages/intake/
  connectors/        Connector 実装（detect / configure / backfill / watch / parse / health）
  parsers/           source 固有形式 → Event。fixture / golden output / unknown field passthrough
  watcher/           filesystem watch、差分検知、capture job enqueue

packages/claim/
  extractor.ts       abstract（Event → Claim 候補の飛躍）
  validator.ts       schema / evidence / sensitivity / scope / policy / lifecycle / conflict 検証
  consolidation.ts   consolidate（candidate → consolidated / conflicted / rejected）
  lifecycle.ts       valid_from / valid_until / supersede / reinforcement
  seal.ts            SealRule 生成と suppression check

packages/retrieval/
  search.ts          metadata / exact / FTS / n-gram / session reconstruction
  ranking.ts         Gate の後にだけ走る score（safety floor を緩めない）
  context-pack.ts    Gate predicate → 固定セクション → safety header → Ouroboros marker
  mcp.ts             read-only MCP（optional）

packages/security/
  key-lifecycle.ts   envelope 方式（DEK / KEK）、KDF、unlock、rotation、recovery
  redaction.ts       redact / delete cascade、tombstone
  secret-scan.ts     key / token 検出、secret flag、index は redacted 表現のみ
  audit.ts           audit log（必須操作の記録）
  ouroboros.ts       signed marker / origin / session provenance による自己摂取禁止

packages/integrations/
  claude-code/ codex/ manual-directory/ generic-jsonl/ markdown-transcript/

schemas/             JSON schema 定義（at-rest 表現は opaque ID + encrypted refs）
fixtures/            Parser 検証用の入力と golden output
```

技術選定原則。

```text
Core schema と policy は小さく保つ。
Connector / Parser は外部世界の変化を吸収する層にする。
分類・整理の不規則さは AI とループに閉じ込める。
Job queue は v0 では SQLite table でよい。
Storage は filesystem + encrypted SQLite を基本にする。
AI provider は adapter として扱い、Core に provider 固有処理を入れない。
Review queue を作らない。ユーザー操作は reactive governance に集約する。
```

---

## 5. 禁止事項

### 5.1 v0 でやらないこと

これらは「いつかやる」ではなく「v0 ではやらない」と確定する。再開する場合は ADR を要する。

```text
事前定義の人格分類をしない（personal / private / social / work / anonymous をハードコードしない）。
ラベルの自動統合確定をしない（merge 候補は surfacing のみ、確定は user / policy / rule）。
Realm 内の暗号境界（Key Domain）を作らない。identity / 信頼の分離は Realm 単位で行う。
first-party cloud backup / sync を作らない（標準の受け皿だけ用意する）。
ReplicaManifest / root_hash sync / known-replica 追跡をしない。
review queue / 手動承認を作らない。
live multi-device sync をしない。
team / organization / admin をしない。
desktop app を作らない。
browser scraping / 非公開 API 依存をしない。
provider のアクセス制御を回避する import をしない。
hook injection / real-time event capture をしない。
MCP write integration（add_memory_candidate を超える書き込み）をしない。
span / 行単位の伏字をしない。
context injection を span 単位で追跡しない（v0 は marker が現れた session 全体を安全側に閉じる）。
pack-local alias citation ID を作らない（v0 は opaque ID（clm_ / evt_）。alias は v0.1）。
fine-tuning dataset builder を本格実装しない（制約だけ固定する）。
vector search を v0 必須にしない。
ranking weight の自動 tuning を先にやらない（manual Recipe のみ）。
```

とくに次の 4 つは構造の核に直結するため、実装中に「便利だから」と崩さないこと。

- review queue を作らない。Claim は全自動 consolidate であり、ユーザーが 1 件ずつ承認する設計にしない。安全は consolidated を止めることではなく出力時の Gate で守る。
- 事前定義カテゴリを持たない。固定の root カテゴリをハードコードせず、Scope は AI が割り当てる label として扱う。
- Realm 内に暗号境界を作らない。混ざると困る境界は別 Realm（別ディレクトリ・別鍵）で分ける。これは設計判断であり ADR で再開する性質のものではない。
- self-generated context を evidence にしない。Memoring が生成した ContextPack / context.md を Claim の evidence や reinforcement に数えない。

### 5.2 共通実装規約

```text
Speculative engineering / future-proofing / 不要な抽象化をしない。要求された範囲だけ実装する。
Interface freeze: 確定した関数シグネチャ・データ構造・既存 interface を勝手に変えない。
Surgical な実装: 既存ロジックに条件分岐を盲目的に継ぎ足さない。対象ロジックを外科的に直す。
Dead code は同じ変更内で即時削除する（未使用 import / orphan 変数 / 不要 helper）。
secret / credential / 個人データをログに出さない・コミットしない。ログには id / 件数 / 状態だけを記録する。
```

設計の核に関わる欠陥が出た場合は、通常の実装変更ではなく設計変更プロセス（ADR）で扱う。ADR では、変更対象が core / contract / Recipe / 実装例のどれかを明示し、既存 Realm への影響、security / privacy への影響、rollback / 互換方針を書く。core / contract に属する変更は実装の独断で行わない。

---

## 6. テスト方針

テストは「不変条件が破れていないこと」を機械的に確認する手段である。テストの構成は次の 4 層で考える。

- Parser は fixture / golden output で検証する。各 Connector は tested host version / format version / Parser version を記録し、golden fixtures を持つ。host update のたびに Connector を検証し、未知 format で壊れず raw-only fallback / Quarantine に倒れることを fixture で確認する。unknown field passthrough も golden で検証する。
- 統合テストの合否基準は 本書 第7章（= 詳細設計書の v0 blocking gate）の 13 項目を満たすことである。これが「動くか」の最終基準であり、blocking gate を肥大させない。
- 補助テストは blocking gate を補う観点（unknown field の encrypted 保存、平文 global index / 永続平文 FTS file の不在、index 破損時の下位層からの再構築、Claim が evidence を持つこと、context.md を evidence にしないこと、evidence_count が independent evidence count と一致すること、日本語検索の exact + n-gram 成立、label 正規化の決定性と merge 確定権限、reprocess 後の event_identity 不変、Recipe が version / eval / audit / rollback ref を持つこと、削除と tombstone の機能、など）を扱う。
- AI 出力差は eval で比較する。同じ fixture への出力差を eval で観測し、Core schema は変えない。Recipe 変更時の既定は no auto-retroactive で、既存 record への適用は明示 reprocess による。
- 不変条件は validator / gate のユニットテストで守る。Gate predicate、consolidation invariant、reinforcement invariant、stable event identity invariant、Ouroboros Law、forget durability invariant、temporal ordering invariant などは、validator と gate のテストで逐条的に固める。具体的な predicate と JSON スキーマは 詳細設計書を参照する。

---

## 7. 完了条件（Definition of Done）

v0 が完了したとみなすのは、次の v0 blocking gate 13 項目をすべて満たしたときである。各項目は実装AIが自己検証できるチェックリストとして扱う。詳細な根拠と参照節は 詳細設計書の不変条件・Gate predicate を引くこと。

```text
[ ]  1. raw capture が失敗したら派生処理へ進まない（raw-only fallback がある）。
[ ]  2. Parser 失敗 / 未知 format / unsupported host version でデータ損失せず、
        raw-only fallback / Quarantine / doctor warning に落ちる。
[ ]  3. secret / unknown / confidential(standard)、および未分類(classified=false) は
        context.md に出ない。
[ ]  4. Active Realm / active scope / classified 済み以外は search / context に出ない。
[ ]  5. 出力 Gate が Audience × Aperture で動く。既定は ai_tool + standard。
        secret はどの Aperture でも raw 出力不可。
[ ]  6. context.md に safety header（current guidance と untrusted excerpt を区別）と
        Ouroboros marker が入る。
[ ]  7. context.md のファイル安全（canonical path / .memoring symlink refuse /
        chmod 0600 / atomic write）を満たす。
[ ]  8. origin ∈ {assistant, host_summary, host_memory, system, unknown} が independent evidence にならず、
        host-memory laundering ループが閉じる。
[ ]  9. sensitivity の Declassify（機微度を下げる緩和）が閉じた列挙の非 AI 権威以外で起きない
        （AI confidence / similarity / git remote 単独で緩和しない）。
[ ] 10. delete / redact が下流へ cascade し、Seal が SealRule で reprocess 復活を防ぐ。
[ ] 11. reprocess（Parser version / blob 粒度変更）後も event_identity が変わらず、
        evidence が宙に浮かない。
[ ] 12. connect が Inventory を出し、Realm 割当を選ばせる。tool 全体 watch を既定にしない。
[ ] 13. .memoring/context.md が新しい AI session で実用的に読める。
```

補助 gate（v0 で守るが blocking を肥大させないもの）は 本書 第6章のテスト方針に含めて確認する。

---

## 8. 着手手順

最初の数手は、第2章の縦串を成立させるための土台づくりに集中する。具体的な実行順序は次のとおり。

1. リポジトリ初期化と第4章のディレクトリ構成を作る。`apps/cli`、`apps/daemon`、`packages/*`、`schemas/`、`fixtures/`、`docs/` を置く。
2. `schemas/` に Undiluted / Occurrence / Event / Chronicle の schema を固定する（schemas/*.schema.json を正本として生成し、required / optional / enum / version / migration を確定して検証する。at-rest 表現は opaque ID + encrypted refs）。schema_version を最初から持たせる。
3. `packages/storage/encrypted-db.ts` で at-rest 暗号化 DB を立ち上げる。WAL / rollback journal / temp store / FTS shadow / vacuum 中間 / backup file を暗号化または無効化し、temp store は memory / tmpfs に置く。鍵は DB に平文で置かない。
4. `packages/security/key-lifecycle.ts` で envelope 方式（DEK / KEK / KDF / recovery material）を実装する。`memoring init` から呼ぶ。
5. `apps/cli` に `memoring init` を実装する。encrypted replica 作成と passphrase / recovery material の必須生成まで通す。
6. `packages/intake/connectors/` に Claude Code Connector の `detect`（Inventory 列挙）と `configure`（include/exclude + Realm 割当）を実装し、`memoring connect claude-code` を通す。
7. capture を実装する。Undiluted と Occurrence を同時に生み、parse できなくても raw-only fallback で raw を失わないことを最優先で確認する（gate 1）。
8. `fixtures/` に Claude Code transcript の入力と golden output を置き、Parser（normalize → Event）を fixture で検証する。
9. 最小ループ（classify candidate → abstract → consolidate + validator）を `packages/claim/` に実装し、Derivation を生成する。
10. `packages/retrieval/context-pack.ts` で context build を実装する。Gate predicate → 固定セクション → safety header → Ouroboros marker → file safety の順に組み、`memoring context build --out .memoring/context.md` を通す（gate 3〜7, 13）。

この 10 手で MVP の縦串が立つ。以降は第3章の P1〜P5 を順に太らせ、各フェーズの完了を第7章のチェックリストで確認する。

---

## 関連文書

- 設計書（思想・構造・制約・安全性・データ・運用の憲法）
- 要件定義書（FR / NFR / CON / OUT の検証可能な要件）
- 基本設計書（全体構成・データフロー・責務分担・処理フロー）
- 詳細設計書（コンポーネント責務・JSON スキーマ全量・不変条件・Gate predicate・状態遷移・エラー処理・権限・セキュリティ・ログ・テスト観点）
- 仕様書（CLI / Daemon / MCP / context.md 形式・設定・データ形式・操作仕様・制約仕様・egress 権限表）
