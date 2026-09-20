# markink サードパーティライセンス情報

本ファイルは markink (実行バイナリ) に含まれる主なオープンソースソフトウェアの
帰属表示です。MIT / Apache-2.0 はライセンス本文の同梱を求めるため末尾に全文を収録します。

## 監査結果 (2026-09-19 時点)

- GPL / AGPL 系の強いコピーレフトは **含まれていません** (npm 256件・Cargo 534件を走査)。
- 配布上の支障はありません。
- 弱コピーレフト MPL-2.0 が Tauri 実行系の推移的依存に含まれます (下記)。
  MPL-2.0 はファイル単位のコピーレフトであり、帰属表示とソース入手手段の
  明示で対応します。各クレートのソースはバージョン固定で crates.io から取得できます
  (本リポジトリの `src-tauri/Cargo.lock` に固定)。
- ビルド専用ツール (vite, vitest, typescript, @tauri-apps/cli, @types/*, jsdom 等) は
  バイナリに含まれません。
- `is-docker` / `is-wsl` / `r-efi` は本ビルドにリンクされません (対象外)。
- 注意: 本体 (`markink` パッケージ) の `license` フィールドは未設定です。
  配布形態 (プロプライエタリ/OSS) の方針決定が必要です。

## Rust (実行時にリンクされる直接依存)

| クレート | バージョン | ライセンス | ソース |
|---|---|---|---|
| serde_json | 1.0.151 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| log | 0.4.34 | MIT OR Apache-2.0 | https://github.com/rust-lang/log |
| tauri | 2.11.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-plugin-log | 2.9.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-dialog | 2.7.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-opener | 2.5.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-single-instance | 2.4.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| fs_extra | 1.3.0 | MIT | https://github.com/webdesus/fs_extra |
| tokio | 1.53.1 | MIT | https://github.com/tokio-rs/tokio |
| tokio-tungstenite | 0.27.0 | MIT | https://github.com/snapview/tokio-tungstenite |
| futures-util | 0.3.34 | MIT OR Apache-2.0 | https://github.com/rust-lang/futures-rs |
| local-ip-address | 0.6.13 | MIT OR Apache-2.0 | https://github.com/LeoBorai/local-ip-address |
| yrs | 0.27.4 | MIT | https://github.com/y-crdt/y-crdt/ |
| urlencoding | 2.1.3 | MIT | https://github.com/kornelski/rust_urlencoding |
| ureq | 2.12.1 | MIT OR Apache-2.0 | https://github.com/algesten/ureq |
| url | 2.5.8 | MIT OR Apache-2.0 | https://github.com/servo/rust-url |

## npm (実行バンドルに含まれる直接依存)

| パッケージ | バージョン | ライセンス | ソース |
|---|---|---|---|
| react | 18.3.1 | MIT | https://github.com/facebook/react |
| react-dom | 18.3.1 | MIT | https://github.com/facebook/react |
| prosemirror-commands | 1.7.2 | MIT | https://github.com/ProseMirror/prosemirror-commands |
| prosemirror-dropcursor | 1.8.3 | MIT | https://github.com/ProseMirror/prosemirror-dropcursor |
| prosemirror-gapcursor | 1.4.1 | MIT | https://github.com/ProseMirror/prosemirror-gapcursor |
| prosemirror-history | 1.5.0 | MIT | https://github.com/ProseMirror/prosemirror-history |
| prosemirror-inputrules | 1.5.1 | MIT | https://github.com/ProseMirror/prosemirror-inputrules |
| prosemirror-markdown | 1.13.7 | MIT | https://github.com/ProseMirror/prosemirror-markdown |
| prosemirror-model | 1.25.11 | MIT | https://github.com/ProseMirror/prosemirror-model |
| prosemirror-schema-basic | 1.2.4 | MIT | https://github.com/ProseMirror/prosemirror-schema-basic |
| prosemirror-schema-list | 1.5.1 | MIT | https://github.com/ProseMirror/prosemirror-schema-list |
| prosemirror-state | 1.4.4 | MIT | https://github.com/ProseMirror/prosemirror-state |
| prosemirror-tables | 1.8.5 | MIT | https://github.com/ProseMirror/prosemirror-tables |
| prosemirror-view | 1.42.3 | MIT | https://github.com/ProseMirror/prosemirror-view |
| yjs | 13.6.32 | MIT | https://github.com/yjs/yjs |
| y-webrtc | 10.3.0 | MIT | https://github.com/yjs/y-webrtc |
| y-websocket | 3.1.0 | MIT | https://github.com/yjs/y-websocket |
| y-prosemirror | 1.3.7 | MIT | https://github.com/yjs/y-prosemirror |
| lib0 | 0.2.117 | MIT | https://github.com/dmonad/lib0 |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| @tauri-apps/plugin-dialog | 2.7.3 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| @tauri-apps/plugin-log | 2.9.1 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |
| @tauri-apps/plugin-opener | 2.5.5 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace |

## MPL-2.0 の推移的依存 (Tauri 実行系経由でリンク)

| クレート | バージョン | 経路 | ソース |
|---|---|---|---|
| cssparser | 0.36.0 | tauri-utils, wry → dom_query → cssparser | https://crates.io/crates/cssparser/0.36.0 |
| cssparser-macros | 0.6.1 | cssparser | https://crates.io/crates/cssparser-macros/0.6.1 |
| selectors | 0.36.1 | tauri-utils, wry → dom_query → selectors | https://crates.io/crates/selectors/0.36.1 |
| dtoa-short | 0.3.5 | cssparser | https://crates.io/crates/dtoa-short/0.3.5 |
| option-ext | 0.2.0 | tauri → dirs → dirs-sys | https://crates.io/crates/option-ext/0.2.0 |

MPL-2.0 全文: https://www.mozilla.org/MPL/2.0/
各クレートのソースは上記 crates.io (表示バージョン固定) から取得できます。

## ライセンス本文

### MIT License

```
MIT License

Copyright (c) <respective authors of each package listed above>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0

```
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by
the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all
other entities that control, are controlled by, or are under common
control with that entity. For the purposes of this definition,
"control" means (i) the power, direct or indirect, to cause the
direction or management of such entity, whether by contract or
otherwise, or (ii) ownership of fifty percent (50%) or more of the
outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity
exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation
source, and configuration files.

"Object" form shall mean any form resulting from mechanical
transformation or translation of a Source form, including but
not limited to compiled object code, generated documentation,
and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or
Object form, made available under the License, as indicated by a
copyright notice that is included in or attached to the work
(an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object
form, that is based on (or derived from) the Work and for which the
editorial revisions, annotations, elaborations, or other modifications
represent, as a whole, an original work of authorship. For the purposes
of this License, Derivative Works shall not include works that remain
separable from, or merely link (or bind by name) to the interfaces of,
the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including
the original version of the Work and any modifications or additions
to that Work or Derivative Works thereof, that is intentionally
submitted to Licensor for inclusion in the Work by the copyright owner
or by an individual or Legal Entity authorized to submit on behalf of
the copyright owner. For the purposes of this definition, "submitted"
means any form of electronic, verbal, or written communication sent
to the Licensor or its representatives, including but not limited to
communication on electronic mailing lists, source code control systems,
and issue tracking systems that are managed by, or on behalf of, the
Licensor for the purpose of discussing and improving the Work, but
excluding communication that is conspicuously marked or otherwise
designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity
on behalf of whom a Contribution has been received by Licensor and
subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
copyright license to reproduce, prepare Derivative Works of,
publicly display, publicly perform, sublicense, and distribute the
Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
(except as stated in this section) patent license to make, have made,
use, offer to sell, sell, import, and otherwise transfer the Work,
where such license applies only to those patent claims licensable
by such Contributor that are necessarily infringed by their
Contribution(s) alone or by combination of their Contribution(s)
with the Work to which such Contribution(s) was submitted. If You
institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work
or a Contribution incorporated within the Work constitutes direct
or contributory patent infringement, then any patent licenses
granted to You under this License for that Work shall terminate
as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
Work or Derivative Works thereof in any medium, with or without
modifications, and in Source or Object form, provided that You
meet the following conditions:

(a) You must give any other recipients of the Work or
Derivative Works a copy of this License; and

(b) You must cause any modified files to carry prominent notices
stating that You changed the files; and

(c) You must retain, in the Source form of any Derivative Works
that You distribute, all copyright, patent, trademark, and
attribution notices from the Source form of the Work,
excluding those notices that do not pertain to any part of
the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its
distribution, then any Derivative Works that You distribute must
include a readable copy of the attribution notices contained
within such NOTICE file, excluding those notices that do not
pertain to any part of the Derivative Works, in at least one
of the following places: within a NOTICE text file distributed
as part of the Derivative Works; within the Source form or
documentation, if provided along with the Derivative Works; or,
within a display generated by the Derivative Works, if and
wherever such third-party notices normally appear. The contents
of the NOTICE file are for informational purposes only and
do not modify the License. You may add Your own attribution
notices within Derivative Works that You distribute, alongside
or as an addendum to the NOTICE text from the Work, provided
that such additional attribution notices cannot be construed
as modifying the License.

You may add Your own copyright statement to Your modifications and
may provide additional or different license terms and conditions
for use, reproduction, or distribution of Your modifications, or
for any such Derivative Works as a whole, provided Your use,
reproduction, and distribution of the Work otherwise complies with
the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
any Contribution intentionally submitted for inclusion in the Work
by You to the Licensor shall be under the terms and conditions of
this License, without any additional terms or conditions.
Notwithstanding the above, nothing herein shall supersede or modify
the terms of any separate license agreement you may have executed
with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor,
except as required for reasonable and customary use in describing the
origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
agreed to in writing, Licensor provides the Work (and each
Contributor provides its Contributions) on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied, including, without limitation, any warranties or conditions
of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
PARTICULAR PURPOSE. You are solely responsible for determining the
appropriateness of using or redistributing the Work and assume any
risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
whether in tort (including negligence), contract, or otherwise,
unless required by applicable law (such as deliberate and grossly
negligent acts) or agreed to in writing, shall any Contributor be
liable to You for damages, including any direct, indirect, special,
incidental, or consequential damages of any character arising as a
result of this License or out of the use or inability to use the
Work (including but not limited to damages for loss of goodwill,
work stoppage, computer failure or malfunction, or any and all
other commercial damages or losses), even if such Contributor
has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
the Work or Derivative Works thereof, You may choose to offer,
and charge a fee for, acceptance of support, warranty, indemnity,
or other liability obligations and/or rights consistent with this
License. However, in accepting such obligations, You may act only
on Your own behalf and on Your sole responsibility, not on behalf
of any other Contributor, and only if You agree to indemnify,
defend, and hold each Contributor harmless for any liability
incurred by, or claims asserted against, such Contributor by reason
of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```
