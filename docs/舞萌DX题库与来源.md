# 舞萌 DX 英文曲名题库

`maimai-1-en` 是一套英文曲名填字题，横向、纵向各 11 题。界面及线索支持简体中文、英文和日语，答案只使用歌曲原始英文曲名，不提供片假名关卡。

## 数据来源

- [落雪咖啡屋舞萌 DX API 文档](https://maimai.lxns.net/docs/api/maimai)：公共接口，不需要玩家账号或 API 密钥。
- `GET https://maimai.lxns.net/api/v0/maimai/song/list?version=25500`：曲名 `title`、曲师 `artist`、BPM、收录版本、标准/DX 谱面等级。
- `GET https://maimai.lxns.net/api/v0/maimai/alias/list`：使用 `song_id` 关联歌曲 `id`，保留返回的社区别名。别名不是官方译名。

2026-10-15（UTC+8）获取的快照包含 1,344 首歌曲与 1,067 条别名记录。`data/sources/maimai-api.json` 保存所有歌曲的相关元数据、合并别名、版本表、请求 URL、抓取时间和原始响应 SHA-256；不保存谱面物量、玩家资料或音频。版本 25500 对应舞萌 DX 2026；这不是其他地区 maimai DX 的实时完整曲库。歌曲首次出现版本保留 API 的原始数值。

网页只加载 `data/maimai.json` 中经审核的 22 首歌曲，不会在游玩时访问外部 API。`artist` 按 API 原文展示，可能包含歌手或版权说明，不擅自拆分成作曲人；未使用谱师字段代替曲师。

## 选曲与出题

采用「英文曲名 + 至少一张 13–15 级标准或 DX 谱面」作为首版筛选规则，包含 13+、14+。等级用 `level_value >= 13 && level_value < 16` 判断，线索展示 API 返回的 `level`，并区分 STD/DX 与 MASTER/Re:MASTER 等难度。每首只出一题，不按多个谱面重复出题，宴会场不参与筛选。

22 首均符合等级条件，包括 ECHO、Brain Power、Bad Apple!! feat.nomico、Tell Your World、conflict、Glorious Crown、Credits、ENERGY SYNERGY MATRIX、PANDORA PARADOXXX、INTERNET OVERDOSE 等。按用户后续提出的等级条件选曲；没有建立或声称建立 YouTube 全曲播放量排行榜。

`src/songs.js` 的审核清单固定歌曲 ID、英文曲名和一条审核用别名。实际线索及引用的别名独立维护在 `data/maimai-clues.json`。ASCII 正则只能判断可输入字符，不能判断语言，因此不自动把日语罗马字标题纳入，也不翻译日文或中文曲名。普通英文词、专名和 `feat.nomico` 这类参与者标记保留原题名。含数字的曲名首版不纳入，避免现有 A–Z 归一化删除数字。

22 道题的中英日线索逐题独立编写，参考原赛马娘题库的短句写法，从曲名含义、玩家绰号、曲师署名或等级选择不同切入点，没有共用的文案模板，也不固定拼接 BPM 和谱面列表。例如 Fragrance 使用“香水”与“斜塔”两个绰号，Credits 使用片尾名单与学分的双关，PANDORA PARADOXXX 使用“新手教程”绰号与 15 级白谱的反差。意象和双关依据题名或别名表达；昵称的英文/日文释义是线索写作的一部分，原始昵称仍保存在词典中，不作为官方曲名译文。

`maimai-clues.json` 的每条记录含 `songId`、三语 `clues` 与 `sourceFacts`：引用的原曲名、曲师、别名，以及确实在文案中用到的 BPM 或谱面等级。校验会检查引用是否仍与 API 快照一致。线索作为完整文本读取，不进行占位符替换。答案及查询结果展示完整原曲名、曲师和所有 API 别名；查询支持曲名片段、曲师与别名。舞萌查询限于这 22 首歌曲，赛马娘查询仍使用角色词典。

输入沿用大写 A–Z、忽略大小写/空格/标点的规则，`Bad Apple!! feat.nomico` 需填 `BADAPPLEFEATNOMICO`。不移除 `feat.` 后的人名，原始曲名完整展示；归一化后重名会被校验拒绝。原角色关卡继续使用 `characterId`，舞萌关卡使用整数 `songId`，禁止混用。

## 更新与验证

```sh
npm run sync:maimai
npm run check:data
npm test
npm run build
npm run build:worker
```

联网同步显式请求版本 25500，先合并 API 数据，再验证审核清单、别名、等级范围与人工线索引用的事实，全部通过后更新快照、词典，并把人工线索原文复制到关卡。同步不会改写 `maimai-clues.json`。HTTP 错误、非预期返回格式、已审核曲名/别名变化、禁用歌曲、等级不再满足条件，或文案引用的曲师/BPM/谱面等级变化时，会中止更新，等待人工复核。`npm run sync:maimai -- --snapshot` 可离线重建，`--from songs.json aliases.json` 可导入这两个接口的已下载响应。

盘面坐标显式维护，同步不自动重新排盘。新增歌曲时需要审核英文题名，在 `maimai-clues.json` 独立编写三语线索并记录引用事实，更新排盘及测试。修改文案后运行离线重建、数据校验、测试及 `build:worker`，让关卡和统计 revision 同步更新。新增关卡还需在 `data/levels/index.json` 登记；合并后维护者仍需按现有流程部署统计 Worker，静态构建不会自动部署云端服务。

校验涵盖 API 快照与词典一致性、答案与歌曲关联、三语线索、等级范围、交叉字、连通性、编号及白格覆盖。测试还覆盖曲名/曲师/别名搜索、查询配额、辅助与挑战反馈、揭示答案、通关和提前结束，以及原角色关卡回归。
