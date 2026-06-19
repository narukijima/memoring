# Memoring 基本設計書

この文書は、Memoring を実装する前に全体像を一望するための基本設計書である。読者は実装に着手する開発者、レビュアー、そしてアーキテクチャを把握したい関係者を想定する。ここでは、システム全体の構成、主要コンポーネントとその責務分担、データの流れ、保存領域、入出力、処理フローを高レベルで示す。フィールド粒度の JSON スキーマ、不変条件の式の全列挙、CLI の全コマンドはこの文書の対象外であり、詳細設計書・仕様書に委ねる。ここでの目的は「何が、どこに置かれ、どう流れるか」を図と責務で確定することにある。

思想的な背景（Sovereign Memory Loop / 主権記憶循環、The Undiluted is Truth、散逸構造の Metabolic Razor 等）の全体は設計書（憲法）に委ねるが、構造を理解するのに必要な範囲で要点を引く。

---

## 1. システム全体構成

Memoring は、AI ツールがローカルに溜める履歴を取り込み、ユーザーが実効支配できる記憶資産として自動で蓄積・整理・抽象化・定着させ、必要なときだけ安全な文脈として取り出す OSS の Sovereign Memory Loop である。データベースではなく、履歴を使える記憶と文脈へ育て続けるループが本体価値であり、DB・object store・index はその土台である。

v0 は single-user / local-first に絞り、構成は次の 5 つの実行・保存要素で成り立つ。

```text
CLI                ユーザーの入口。init / connect / watch / context build / search / forget / doctor。
local daemon       work-driven にループを回す常駐プロセス。watch → capture → 各段の job を enqueue。
encrypted SQLite   memoring.db。DB 全体を at-rest 暗号化する。entity と job queue を保持する。
object store       Undiluted（原本バイト列）と Artifact を暗号化して保存する objects/ ディレクトリ。
index              FTS / exact / n-gram の検索面。再生成可能な projection であり、at-rest で暗号化する。
```

これらは 1 つの Realm（鍵を共有する一つの記憶世界）に属し、`~/.memoring/` 配下に local replica として置かれる（第 5 章）。

### 1.1 パッケージ構成

実装は CLI + daemon + encrypted SQLite + filesystem + schemas + fixtures + doctor に絞る。Core schema と policy を小さく保ち、外部世界の変化は Connector / Parser に、分類・整理の不規則さは AI とループに閉じ込める。Job queue は v0 では SQLite table でよい。AI provider は adapter として扱い、Core に provider 固有処理を入れない。

```text
memoring/
  apps/
    cli/                       ユーザー操作の入口
    daemon/                    work-driven loop の常駐プロセス
  packages/
    core/                      loop, schema, policy, chronicle, realm, recipe
    storage/                   sqlite, object-store, encrypted-db
    intake/                    connectors, parsers, watcher
    claim/                     extractor, validator, consolidation, lifecycle, seal
    retrieval/                 search, ranking, context-pack, mcp
    security/                  key-lifecycle, redaction, secret-scan, audit, ouroboros
    integrations/              claude-code, codex, manual-directory, generic-jsonl, markdown-transcript
  schemas/                     固定 schema 定義
  fixtures/                    golden fixtures（host update ごとの Connector 検証用）
  docs/
```

この層構造は「核は小さく固定し、複雑さは外側へ押し出す」という方針を体現している。外部形式の変化は Connector / Parser が、モデルごとの差は Schema / Validator が、検索と文脈生成は Retrieval が吸収する。

---

## 2. 主要コンポーネントと責務分担

各 package の責務を以下に示す。権威は AI モデルではなく schema・validator・policy・evidence に置く、という原則がコンポーネント分割に貫かれている。

### 2.1 core

ループ全体の制御と、システムの不変の土台を持つ。

```text
loop        差分駆動でループを回す中枢。各段の job を順に enqueue し、idle へ収束させる。
schema      Undiluted / Occurrence / Event / Session / Label / Assignment / Claim / Derivation
            / ContextPack / Artifact / SealRule / Policy / Chronicle の固定 schema。
policy      出力 Gate / egress / precedence を司る policy.v2 の評価。安全判定の中核。
chronicle   操作の追記専用ログ。下位層・index をここから決定的に再構築できる。
realm       Realm = 1 identity = 1 信頼境界 = 1 鍵。Active Realm の解決を持つ。
recipe      不変条件ではない調整値（閾値 / 重み / token budget）を所有する版管理単位。
```

### 2.2 storage

データの物理保存を担う。

```text
sqlite         entity と job queue を持つ encrypted SQLite。
object-store   Undiluted / Artifact を暗号化して保存する objects/ レイヤ。
encrypted-db   DB 全体の at-rest 暗号化と、平文を disk に残さないための制御（WAL / temp store 等）。
```

### 2.3 intake

入口を構成する。何も判断せず、まず壊さず取り込む（Capture First）。

```text
connectors   AI ツールのローカル蓄積を発見し（detect / Inventory）、source を Realm へ割り当てる。
parsers      外の汚い世界と固定 schema を分ける境界。best-effort unstable Parser として扱う。
watcher      選択済み source の追記（差分）を検知して capture job を enqueue する。
```

### 2.4 claim

Event から Claim を汲み上げ、検証して定着させる。Claim は versioned, provenance-backed assertion である。

```text
extractor       Event から Claim 候補（candidate）を汲み上げる（abstract）。
validator       schema / evidence / sensitivity / scope / policy / lifecycle を検証する審判。
consolidation   検証を通った candidate を consolidated として全自動で定着させる。
lifecycle       candidate / consolidated / conflicted / superseded / rejected / redacted の状態遷移。
seal            delete / redact + SealRule による durable な封印（蘇りの禁止）。
```

### 2.5 retrieval

呼ばれたときだけ Realm から想起面を作る（recall）。

```text
search        metadata filter / exact / FTS / n-gram fallback / session reconstruction。
ranking       Gate を通った item だけを並べる品質調整。安全機構ではない。
context-pack  ContextPack を組み、.memoring/context.md として手渡す（handoff）。
mcp           v0 optional の read-only な外部接続受け皿。
```

### 2.6 security

安全性の各機構を横断的に提供する。

```text
key-lifecycle  envelope 方式の鍵階層（KEK / DEK / realm_key）、unlock、rotation、recovery。
redaction      delete / redact の cascade と tombstone。
secret-scan    key / token を検出し raw 出力を止める検査（Secret Scan）。
audit          高リスク操作の追記 audit log。
ouroboros      自己生成 context を evidence にしない Ouroboros Guard。
```

### 2.7 integrations

具体的な宿主ツールへの Connector 実装。

```text
claude-code / codex / manual-directory / generic-jsonl / markdown-transcript
```

---

## 3. データの流れ

Memoring の代謝は Input（取り込む）・Loop（代謝する）・Output（手渡す）の三拍子で捉える。8 つの動詞がこの三拍子に割り付く。

```text
Input / 入口
  connect    AI ツールのローカル蓄積を見つけて口を開く。
  capture    原本を壊さず取り込む。Undiluted と Occurrence を同時に生む唯一の 1 対 2 動詞。

Loop / 自動ループ（全自動。承認キューを挟まない）
  normalize  source 固有形式を Event へ翻訳する。
  classify   scope / sensitivity を AI が付与する。
  abstract   Event から Claim 候補を汲み上げる飛躍。
  consolidate 候補に証拠・整合・安全の検証を通し、Claim として定着させる。

Output / 出口
  recall     呼ばれた時だけ Realm から想起面を作る。
  handoff    生成した文脈を context.md として AI ツールへ手渡す。
```

capture は唯一の 1 対 2 動詞である。同じ原本が複数回観測されうるため、中身そのもの（Undiluted）と、それに出会った事実（Occurrence）を同時に生む。abstract と consolidate は必ず書き分ける。abstract は飛躍であり、consolidate は検証を通して定着させる工程である。

### 3.1 work-driven な job enqueue

ループは常時回るのではなく、差分が来たときだけ回る。Watcher が宿主のローカル蓄積への追記を検知して capture job を enqueue し、capture → normalize → classify → abstract → consolidate と各段が次段の job を enqueue する work-driven 方式で進む。新しい差分が無ければ job は無く、daemon は Watcher を待って idle になる。expensive な AI 呼び出しは新しい Event があるときだけ走り、差分ゼロで回り続けて計算資源を浪費しない。

```text
  Watcher が差分を検知
        │  enqueue
        ▼
  ┌───────────┐ enqueue ┌────────────┐ enqueue ┌──────────┐
  │  capture  │────────▶│ normalize  │────────▶│ classify │──┐
  └───────────┘         └────────────┘         └──────────┘  │
        ▲                                                     │ enqueue
        │ 新しい差分が無ければ job は無い                      ▼
        │                              ┌────────────┐ enqueue ┌──────────┐
   (idle へ収束)  ◀───────────────────│consolidate │◀────────│ abstract │
                                       └────────────┘         └──────────┘
```

### 3.2 Inner Loop と Outer Loop

ループは尺度の違う 2 つで捉える。

```text
Inner Loop（Memoring 内部・自動・差分駆動）
  Input が新 evidence を供給する。
  normalize → classify → abstract → consolidate。
  出力は維持される Realm。idle 状態を持つ。

Outer Loop（世界を経由して閉じる）
  Output → context.md → 次の AI 作業 → 新しい履歴 → Input。
  閉じる区間は Memoring の外（ユーザーの実作業）にある。
  Memoring が所有するのは Input と Output の 2 端点だけ。
```

Output は Inner Loop の段ではない。Realm を Gate 越しに読む on-demand の tap であり、周回ごとに通る駅ではなく、必要なときだけ context.md を生成する。

```text
                        ┌──────────────── Outer Loop ────────────────┐
                        │                                            │
   ┌──────────┐    capture    ┌─────────── Inner Loop ──────────┐    │
   │  AI ツール │ ───────────▶ │ normalize→classify→abstract→    │    │
   │ のローカル  │              │             consolidate          │    │
   │   履歴     │              │        出力 = 維持される Realm     │    │
   └──────────┘              └────────────────┬────────────────┘    │
        ▲                                      │ recall（on-demand tap）  │
        │ 次の AI 作業 → 新しい履歴              ▼                          │
        │                            ┌──────────────────┐                │
        └────────────────────────── │ .memoring/context.md │ ◀──────────┘
                  handoff            └──────────────────┘
```

---

## 4. データ層の全体像

データは 3 つの observational record、1 つの asserted knowledge、1 つの projection 面と、それらを貫く 3 本の制御軸で表す。

### 4.1 5 層

```text
Layer 1: Undiluted    [observational truth]  原本のバイト列。暗号化され、payload bytes は改変されない。
Layer 2: Occurrence   [observational truth]  Undiluted を、いつ・どの source の・どの cursor で観測したか。
Layer 3: Event        [observational truth]  source 固有形式を共通の時系列イベントへ変換したもの。
Layer 4: Claim        [asserted knowledge]   versioned, provenance-backed な可変の主張。evidence から再検証できる。
Layer 5: Recall       [projection / 再生成]  search index、ContextPack、MCP result、export view。
```

下位 3 層（Undiluted / Occurrence / Event）は observational record であり、観測された事実として削除・redaction 以外では改変しない。Claim は asserted knowledge であり、evidence から再検証・再生成できる可変な主張である。Recall は真実ではなく、検索と取り出しを速くするための再生成可能な面であり、壊れたら下位層から再構築する。

observational record と asserted knowledge を分けるのは安全原則である（The Undiluted is Truth）。分類・要約・抽象化・Claim 化は必ず揺れるため、最初の AI 出力だけを保存して原本を捨てれば二度とより良い記憶へ作り直せない。原本が真実であり、派生データは作り直せるものとして扱う。

### 4.2 Undiluted と Occurrence を分ける理由

同じ raw payload が複数回観測されうる。中身が同じなら Undiluted は一つでよいが、いつ・どの source の・どの cursor で観測したかは別の事実である。Undiluted は「何が記録されたか」、Occurrence は「それをいつ、どこで、どう観測したか」を表す。

### 4.3 3 制御軸

5 層すべてを 3 本の制御軸が貫く。

```text
Provenance Axis / 来歴   どこから来て、何を根拠にし、どの処理で作られたか。
Scope Axis / 文脈        どの文脈・用途に属するか。事前定義の固定カテゴリではなく AI が割り当てる label。
                         Realm 内に暗号境界は持たず、identity / 信頼の分離は Realm 単位で行う。
Safety Axis / 安全       sensitivity（event 単位）、secret、remote AI 可否、export 可否。span 単位の部分伏字はしない。
```

Recall（index）は秘密ではないという意味ではない。index は語彙・ファイル名・エラー文字列・人物名・プロジェクト名を含みうるため、index も at-rest で暗号化し、平文 index を永続 disk に置かない。ContextPack は projection であり、既定では本文を保存せず manifest（pack id、Recipe、policy、evidence id、active scope、生成時刻など）だけを残す。

---

## 5. Realm と保存領域

### 5.1 真実は場所ではなく Realm

真実はローカルでもクラウドでもなく、整合した Realm である。Realm は Undiluted set / Occurrence set / Event set / Claim set、Policy definitions、Chronicle を持つ。

Realm は鍵を共有する、混ぜてはいけない一つの記憶世界であり、1 Realm = 1 identity = 1 信頼境界 = 1 鍵とする。Realm が宿る物理コピーを Replica と呼ぶ。

### 5.2 既定の local replica レイアウト

既定では Realm は `~/.memoring/` に置かれる。

```text
~/.memoring/
  realm.toml          Realm の設定（root_paths / git_remotes など）
  memoring.db         entity と job queue。at-rest 暗号化
  objects/            Undiluted / Artifact の暗号化保存
  indexes/            検索 index（at-rest 暗号化）
  connectors/         ConnectorInstance の設定
  policies/           policy.v2 等
  logs/               audit log
```

### 5.3 暗号化の方針

DB 全体（memoring.db）を at-rest 暗号化する。Undiluted は暗号化して保存し、平文 raw を disk に置かない。master key はユーザーの passphrase または OS secret から KDF で導出し、鍵そのものは DB に平文で置かない。鍵階層は envelope 方式で、Realm ごとに DEK を持ち KEK で包む。DEK は at-rest 暗号化用で rotation / rekey 可能である。realm_key（identity 計算や fingerprint の HMAC 鍵）は Realm root secret（rotation 不変。recovery material から導出）から KDF で導出する別系統であり、DEK / KEK 系とは分離する。KEK rotation / DEK rekey は realm_key を変えないため、event_identity / content_fingerprint / normalized_key / SealRule.target_signature は rotation / reconnect / restore をまたいで不変である。realm_key は Realm をまたいで共有しない。

Realm 内には per-domain の暗号境界（Key Domain）を持たない。Realm 内の境界は scope label による soft な属性であり、安全は出力 Gate で守る。これは v0 の後回しではなく設計判断である。絶対に結びつけたくない文脈（二つの identity、仕事と個人など）は、Realm 内で暗号分離するのではなく別 Realm（別ディレクトリ・別鍵）にする。`memoring init` を分けて実行するだけでよく、追加機能を要しない。

### 5.4 複数 Realm の運用

identity / trust boundary は Realm で分け、topic / project / 作業テーマは scope label で扱う。初期 Realm の推奨構成（ハードコードではない出発点）は次の通りである。

```text
personal-private        個人・生活・投資・健康・雑談・非公開の構想
public-persona          公開人格・公開活動・思想・発信・OSS・公開前提
company-work            法人の事業・収益・社内メモ・プロダクト運営・会社としての作業
customer-confidential   顧客案件・第三者情報・NDA・契約・絶対に混ぜたくない仕事
```

project 単位の Realm は最初から増やさない。独立した信頼境界や運用境界が要るほど巨大化したものだけを Realm に昇格する。暗号分離が要るほど強い境界だけを Realm にし、それ以外の不規則さは scope label と Gate に吸収させる。

Realm 間は設計上連結しない。cross-Realm search / cross-Realm context は v0 で提供しない。複数 Realm を運用する場合、watch・鍵束・index・daemon scope を Realm ごとに分離する。

### 5.5 Active Realm の解決

context build / search は、まず一意の Active Realm を解決してから動く（active scope より前に来る）。

```text
1. CWD を canonicalize する。
2. 各 Realm に登録された root_paths / git_remotes と照合する。
3. 一意に定まれば、その Realm を active にする。
4. 複数 Realm に該当、またはどこにも該当しないときは Silence。
   ユーザーに Realm を明示させる（--realm <id>）か、出力を出さない。
5. Active Realm が定まらない context build は context.md を出さない（推測で混ぜない）。
```

source の Realm 割当は connect 時に決める。同じ宿主ツール（Claude Code / Codex）の履歴でも、project / git remote / account ごとに別 Realm へ振り分けられる。

---

## 6. 入出力

### 6.1 入口

入口は AI ツールがローカルの隠しフォルダ（ホーム配下など）に溜めるセッション / 履歴である。CLI でもデスクトップアプリでも、その実体ファイルから取得する。入口は何も判断せず、まず壊さず取り込み、暗号化して蓄積する（Capture First）。

Connector は source 種別ごとに 4 つの取り込み方式を持つ。

```text
Append source     Claude Code transcript、Codex session。cursor で追記分を読む。
Snapshot source   export 形式。snapshot 単位で差分照合する。
Artifact source   diff、stdout、stderr、attachments。blob と artifact として扱う。
Event source      hooks / MCP events。v0 では要求しない。
```

connect は宿主ツールを 1 つの塊として扱わず、発見した source を Inventory として列挙する。ユーザーはそこから include / exclude を選び、各 source を Realm へ割り当てる。watch は選択済み source だけを対象にし、tool 全体 watch を既定にしない。Claude Code / Codex の履歴には仕事・個人・OSS・顧客案件・別 identity が混ざりうるため、初期導線で全部を 1 Realm に混ぜない。

v0 初期 Connector は Claude Code local transcript、Codex local session、manual import directory、generic JSONL / Markdown transcript の 4 つである。

### 6.2 出口

```text
v0 default:  .memoring/context.md（主出口）
v0 optional: MCP read-only（experimental、外部接続の受け皿）
```

`.memoring/context.md` を主出口にするのは、どの AI ツールでも読めるため MCP や hook injection より壊れにくいからである。context.md は ephemeral とし、用途のたびに再生成する。長期保管せず、既定で sync / backup 対象に含めない。`.memoring/` は生成時に `.git/info/exclude` へ追加し、`.gitignore` は書き換えない。

出力は curated context（Memoring が検証した現在の指針）と quoted historical evidence（過去ログの引用）を区別する Safety Header を持ち、引用は untrusted な証拠として fenced / quote block に閉じ込める。AI 向け citation は opaque ID（clm_ / evt_）だけにする。context.md には signed の Ouroboros marker を埋め、再取り込み時の自己摂取を防ぐ。

MCP は v0 optional・read-only 既定で、外部接続の標準受け皿として置く。secret / unknown / confidential は除外し、書き込みは candidate state への `add_memory_candidate` を超えない。

---

## 7. 処理フロー

各段の入出力を概念レベルで示す。すべて work-driven に進み、差分が無ければ idle へ収束する。

```text
段          入力                         処理                                     出力
─────────  ─────────────────────────  ──────────────────────────────────────  ─────────────────────
connect    宿主のローカル蓄積           detect → Inventory → Realm 割当            ConnectorInstance / source 選択
capture    source の追記（差分）         原本を壊さず暗号化して取り込む              Undiluted + Occurrence（1 対 2）
normalize  Undiluted / Occurrence       source 固有形式を共通時系列へ翻訳           Event（event_identity で安定）
classify   Event                        AI が scope / sensitivity を付与（candidate） Assignment / sensitivity（candidate）
abstract   Event                        Claim 候補を汲み上げる飛躍                  Claim candidate
consolidate Claim candidate + evidence  schema / evidence / sensitivity / scope /   Claim consolidated（または conflicted / rejected）
                                        policy / lifecycle / suppression を検証
recall     維持される Realm（on-demand）  Gate → ranking → ContextPack 構成          ContextPack（manifest）
handoff    ContextPack                  .memoring/context.md を生成                 context.md
```

### 7.1 収束（idle）

ループは差分駆動であり、不変な Realm に対して有限ステップで idle に収束する。差分ゼロで回り続けることを許さない。

```text
fire（段の発火）は new_observational_evidence ∨ user_trigger ∨ scheduled_maintenance_tick のときだけ。
AI / expensive step は new_observational_evidence のときだけ fire する。
新 evidence の無い固定 Realm では、ループは有限ステップで新規 candidate を生成しなくなり、
  pending job が空になって idle へ入る。
idle では AI / 計算資源を消費せず、Watcher の待機を超える busy polling をしない。
```

この収束は「Derived を evidence にしない」「過去の AI 生成 Claim だけを根拠にしない」「自己生成 context を evidence / recall_count に数えない」という不変条件に支えられている。これらが無ければ、ループは自分の派生出力を入力として食い直し、新 evidence 無しに無限の candidate を生む。expensive な AI を新 Event のときだけ走らせること自体が、収束を支える構造である。

時間駆動の保守（valid_until 到来による expire、reinforcement 減衰）だけは evidence 以外の trigger として許すが、scheduled tick として有界に実行し、busy loop にしない。

---

## 8. AI の位置づけ

ループの自動化は AI を前提とする。AI は classification、abstraction、candidate memory extraction、summary、conflict detection を担う。ただし権威は model ではなく、schema・validator・policy・evidence に置く。

```text
AI model
  → candidate JSON
  → schema validation
  → policy validation
  → evidence check
  → sensitivity / scope check
  → deterministic validator decision
```

AI は候補を作るだけである。auto-consolidate は「AI が確定する」ではなく「AI candidate を Memoring validator が検証し、policy と evidence を満たしたものだけが consolidated になる」という意味である。high-risk Claim も自動 consolidated になり得るが、それは AI が確定したのではなく validator を通った assertion であり、Gate により scope 外 / remote AI / secret / confidential 出力から守られる。安全は consolidated を止めることではなく、出力時の Gate で守る。

AI が確定してはいけないものは次の通りである。

```text
scope（Assignment / Label）の confirmed 化
secret / confidential の外部送信許可
destructive redact / delete
Crossing の恒久許可
sensitivity の Declassify（機微度を下げる緩和）
```

### 8.1 3 モード

参入障壁を下げるため、AI 利用は 3 モードに開く。

```text
Mode A: no-AI degraded     secure capture / search / context.md / 明示 memory のみ。本来価値は限定的。
Mode B: local AI first      分類・抽象化・consolidation を local model で回す既定の本来形。
                            open-source local models / local coding agent に開く。
Mode C: remote AI optional  major provider API も使えるが、egress gate を必ず適用する。
                            secret は送らない。confidential は one-shot 確認。
                            candidate sensitivity の外部露出は policy で制限。
```

AI なしでも secure capture、exact / FTS / n-gram search、context.md 生成、明示 pin / constraint / decision の rule-based memory は成立するが、分類・抽象化・extraction という本来のループ価値は AI に依存する。AI は Memoring の核であり、無効化は degraded mode である。AI 由来 record（Claim / Assignment / sensitivity classification）は Derivation（model / prompt / Recipe / validator version 等）を来歴に持つ。

---

## 9. 設計変更プロセス（ADR）

核に関わる変更は、通常の実装変更ではなく ADR（Architecture Decision Record）として扱う。ADR では変更対象が core / contract / Recipe / 実装例のどれかを明示し、security / privacy への影響と互換方針を評価する。本基本設計が前提とする主要な設計判断には、AI 単独で sensitivity を Declassify（機微度を下げる緩和）しない、context_injected session の assistant assertion を独立証拠に数えない、event_identity を source 側の安定座標から導く、Event に origin を持たせ assistant / host 生成物を独立証拠にしない、Label と Assignment を分離する、AI 由来 record に Derivation を持たせる、Session を独立 entity として正規化する、egress を Audience × Aperture × purpose の単一表に統一する、delete / redact の cascade と Seal の SealRule を定義する、といったものが含まれる。詳細は詳細設計書の不変条件・スキーマで扱う。

---

## 関連文書

- 完成版設計書（memoring_design_final_ja.md）: 思想・構造・機能・制約・安全性・データ構造・運用方針を一貫させた最終版の包括文書。
- 要件定義書（memoring_requirements_ja.md）: 検証可能な機能 / 非機能要件、制約、対象外。
- 詳細設計書（memoring_detailed_design_ja.md）: 各コンポーネントの責務、JSON スキーマ全量、状態遷移、不変条件、Gate predicate。
- 仕様書（memoring_specification_ja.md）: CLI / Daemon / MCP / context.md 形式・設定・egress 権限表など利用者から見た振る舞いと形式。
- 実装指示書（memoring_implementation_instructions_ja.md）: 実装順序・MVP・ディレクトリ構成・禁止事項・完了条件。
